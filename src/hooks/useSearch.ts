import { resolveApiUrl } from '../lib/config'
/**
 * useSearch.ts
 * Fixed x402 + Freighter payment flow.
 *
 * KEY INSIGHT from Stellar docs:
 * Freighter's signAuthEntry() returns a BUFFER (raw bytes of the signed hash).
 * ExactStellarScheme expects signedAuthEntry as a base64 string of those raw bytes.
 * The previous code was calling .toString() which gives "[object Buffer]" — 9 chars —
 * hence "signature of length 64 expected, got 9".
 * Fix: convert Buffer → base64 string using Buffer.from(result).toString('base64')
 */

import { useState, useCallback, useRef }       from 'react'
import { toast }                               from 'sonner'
import { x402Client, x402HTTPClient }          from '@x402/fetch'
import { ExactStellarScheme }                  from '@x402/stellar/exact/client'
import { signAuthEntry, getNetworkDetails, getPublicKey } from '@stellar/freighter-api'
import { Networks, Horizon, StrKey }           from '@stellar/stellar-sdk'
import { Buffer }                              from 'buffer'
import { IS_MAINNET, EXPECTED_WALLET_NETWORK, explorerTxUrl, STELLAR_NETWORK } from '../lib/stellar'

let paymentDepsPromise: Promise<{
  x402Client: typeof import('@x402/fetch').x402Client
  x402HTTPClient: typeof import('@x402/fetch').x402HTTPClient
  ExactStellarScheme: typeof import('@x402/stellar/exact/client').ExactStellarScheme
  signAuthEntry: typeof import('@stellar/freighter-api').signAuthEntry
  getNetworkDetails: typeof import('@stellar/freighter-api').getNetworkDetails
  Networks: typeof import('@stellar/stellar-sdk').Networks
}> | null = null

function loadPaymentDeps() {
  if (!paymentDepsPromise) {
    paymentDepsPromise = Promise.all([
      import('@x402/fetch'),
      import('@x402/stellar/exact/client'),
      import('@stellar/freighter-api'),
      import('@stellar/stellar-sdk'),
    ]).then(([fetchMod, schemeMod, freighterMod, stellarMod]) => ({
      x402Client: fetchMod.x402Client,
      x402HTTPClient: fetchMod.x402HTTPClient,
      ExactStellarScheme: schemeMod.ExactStellarScheme,
      signAuthEntry: freighterMod.signAuthEntry,
      getNetworkDetails: freighterMod.getNetworkDetails,
      Networks: stellarMod.Networks,
    }))
  }
  return paymentDepsPromise
}

const SERVER_URL = (path: string) => resolveApiUrl(path)

// Soroban RPC URLs
const SOROBAN_RPC_TESTNET = "https://soroban-testnet.stellar.org";
const SOROBAN_RPC_MAINNET = "https://soroban-rpc.mainnet.stellar.org"; // Or another public RPC
const SOROBAN_RPC_URL = IS_MAINNET ? SOROBAN_RPC_MAINNET : SOROBAN_RPC_TESTNET;

import type { SearchResult, SearchReceipt, SearchResponse, PaymentStep, SearchSession, SearchMode } from '../types'
import { classifySearchError } from '../types'

export type {
  SearchResult,
  SearchReceipt,
  PaymentStep,
  SearchSession,
  SearchParamsOptions,
};

// Cross-tab / cross-event-race search mutex.
//
// Component-local `isSearching` state is not enough to block duplicate paid
// retries: it is set asynchronously (a double Enter/double click can both
// fire before React re-renders), and it is scoped to a single tab/window, so
// two tabs of the same app can independently pass the same wallet through the
// x402 payment flow at once. This lock is a synchronous, cross-tab guard on
// top of that state.
const SEARCH_LOCK_KEY = 'stellarsearch_search_lock'
// Generous upper bound on a full 402 → sign → paid-retry round trip. If a
// lock is older than this it is treated as abandoned (e.g. tab crashed
// mid-flow) so a stuck lock can never permanently block searching.
const SEARCH_LOCK_TTL_MS = 20_000

interface SearchLock {
  id: string
  ts: number
}

function readSearchLock(): SearchLock | null {
  try {
    const raw = localStorage.getItem(SEARCH_LOCK_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed.id === 'string' && typeof parsed.ts === 'number') {
      return parsed as SearchLock
    }
    return null
  } catch {
    return null
  }
}

/** Attempts to acquire the search mutex. Returns false if another search (in this tab or another) already holds it. */
function acquireSearchLock(id: string): boolean {
  try {
    const existing = readSearchLock()
    if (existing && Date.now() - existing.ts < SEARCH_LOCK_TTL_MS) {
      return false
    }
    localStorage.setItem(SEARCH_LOCK_KEY, JSON.stringify({ id, ts: Date.now() } satisfies SearchLock))
    return true
  } catch {
    // localStorage unavailable (e.g. private mode) — fail open rather than
    // block the user from ever searching.
    return true
  }
}

/** Releases the search mutex, but only if it is still held by `id` (avoids releasing a lock acquired by another tab after this one's TTL expired). */
function releaseSearchLock(id: string): void {
  try {
    const existing = readSearchLock()
    if (existing && existing.id === id) {
      localStorage.removeItem(SEARCH_LOCK_KEY)
    }
  } catch {
    // ignore
  }
}

/**
 * Advanced search operator supported by the visual builder.
 */
export type AdvancedSearchOperator =
  | { type: 'exclude'; value: string }
  | { type: 'exact'; value: string }
  | { type: 'filetype'; value: string }
  | { type: 'site'; value: string }

export interface AdvancedSearchQuery {
  terms: string[]
  operators: AdvancedSearchOperator[]
}

/**
 * Maximum generated query length. The visual builder validates against this
 * so composing operators never silently changes the query or payment amount.
 */
export const ADVANCED_QUERY_MAX_LENGTH = 500

/**
 * Compose structured advanced search operators into a visible editable query.
 * The returned string is validated against ADVANCED_QUERY_MAX_LENGTH before use.
 */
export function composeAdvancedSearchQuery(query: AdvancedSearchQuery): string {
  const parts = [...query.terms]
  for (const op of query.operators) {
    if (op.type === 'exclude') parts.push(`-${op.value}`)
    else if (op.type === 'exact') parts.push(`"${op.value}"`)
    else if (op.type === 'filetype') parts.push(`filetype:${op.value}`)
    else if (op.type === 'site') parts.push(`site:${op.value}`)
  }
  const generated = parts.filter(Boolean).join(' ').trim()
  if (generated.length > ADVANCED_QUERY_MAX_LENGTH) {
    throw new Error(`Advanced query length ${generated.length} exceeds maximum ${ADVANCED_QUERY_MAX_LENGTH}`)
  }
  return generated
}

async function preflightStellarAccount(
  address: string,
  requiredAmount?: string,
  expectedNetwork = EXPECTED_WALLET_NETWORK
) {
  if (!StrKey.isValidEd25519PublicKey(address)) {
    throw new Error('Invalid Stellar account. Reconnect your Freighter wallet.')
  }
  if (typeof signAuthEntry !== 'function') {
    throw new Error('Freighter signer unavailable. Install Freighter and try again.')
  }

  const net = await getNetworkDetails()
  if (net.error) {
    throw new Error(net.error.message)
  }
  if (net.network !== expectedNetwork) {
    throw new Error(`Switch Freighter to ${expectedNetwork}. Currently: ${net.network}`)
  }

  let activeAccount: string
  try {
    activeAccount = await getPublicKey()
  } catch {
    throw new Error('Freighter signer unavailable. Unlock Freighter and try again.')
  }
  if (activeAccount !== address) {
    throw new Error('Freighter active account changed. Reconnect the expected wallet.')
  }

  let account: any
  try {
    account = await new Horizon.Server(HORIZON_URL).loadAccount(address)
  } catch (err: any) {
    if (err?.response?.status === 404) {
      throw new Error('Account not found on Stellar network. Fund the connected address first.')
    }
    throw new Error('Unable to verify Stellar account. Reconnect Freighter and try again.')
  }

  const usdcBalance = account.balances?.find(
    (balance: any) =>
      balance.asset_type === 'credit_alphanum4' &&
      balance.asset_code === 'USDC' &&
      balance.asset_issuer === USDC_ISSUER
  )

  if (!usdcBalance) {
    throw new Error('No USDC trustline found. Add the USDC trustline to your wallet and try again.')
  }

  const spendableUsdc = Number(usdcBalance.balance) - Number(usdcBalance.selling_liabilities ?? 0)

  if (requiredAmount !== undefined) {
    const required = Number(requiredAmount)
    if (!Number.isFinite(required) || required <= 0) {
      throw new Error('Invalid payment amount from server. Retry the search.')
    }
    if (spendableUsdc < required) {
      throw new Error(`Insufficient USDC balance. Required: ${requiredAmount}, available: ${spendableUsdc}.`)
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Preflight timed out. Check your network connection.')), ms)
    ),
  ])
}

export interface SavedResultSet {
  id: string
  query: string
  timestamp: string
  txHash: string | null
  results: SearchResult[]
}

export interface MovedResult {
  result: SearchResult
  fromRank: number
  toRank: number
}

export interface ResultComparison {
  added: SearchResult[]
  removed: SearchResult[]
  moved: MovedResult[]
  unchanged: Array<{ result: SearchResult; rank: number }>
}

const RESULT_SETS_KEY = 'stellarsearch_result_sets'
const SELECTED_RESULT_SETS_KEY = 'stellarsearch_selected_result_sets'

const canonicalUrl = (result: SearchResult): string =>
  (result as SearchResult & { url?: string }).url ?? ''

const readResultSets = (): SavedResultSet[] => {
  try {
    const raw = localStorage.getItem(RESULT_SETS_KEY)
    return raw ? (JSON.parse(raw) as SavedResultSet[]) : []
  } catch {
    return []
  }
}

const writeResultSets = (sets: SavedResultSet[]) => {
  try {
    localStorage.setItem(RESULT_SETS_KEY, JSON.stringify(sets))
  } catch {
    // Ignore storage quota / privacy errors.
  }
}

const readSelectedResultSetIds = (): string[] => {
  try {
    const raw = localStorage.getItem(SELECTED_RESULT_SETS_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

const writeSelectedResultSetIds = (ids: string[]) => {
  try {
    localStorage.setItem(SELECTED_RESULT_SETS_KEY, JSON.stringify(ids))
  } catch {
    // Ignore storage quota / privacy errors.
  }
}

/**
 * Compares two paid result sets by canonical URL.
 * Results present only in `current` are added; only in `previous` are removed;
 * present in both but at different ranks are moved; otherwise unchanged.
 */
export function compareResultSets(
  previous: SearchResult[],
  current: SearchResult[]
): ResultComparison {
  const previousByUrl = new Map<string, { result: SearchResult; rank: number }>()
  const currentByUrl = new Map<string, { result: SearchResult; rank: number }>()

  previous.forEach((result, index) => {
    const url = canonicalUrl(result)
    if (!previousByUrl.has(url)) previousByUrl.set(url, { result, rank: index + 1 })
  })
  current.forEach((result, index) => {
    const url = canonicalUrl(result)
    if (!currentByUrl.has(url)) currentByUrl.set(url, { result, rank: index + 1 })
  })

  const added: SearchResult[] = []
  const removed: SearchResult[] = []
  const moved: MovedResult[] = []
  const unchanged: Array<{ result: SearchResult; rank: number }> = []

  currentByUrl.forEach((entry, url) => {
    const prev = previousByUrl.get(url)
    if (!prev) {
      added.push(entry.result)
    } else if (prev.rank !== entry.rank) {
      moved.push({ result: entry.result, fromRank: prev.rank, toRank: entry.rank })
    } else {
      unchanged.push({ result: entry.result, rank: entry.rank })
    }
  })

  previousByUrl.forEach((entry, url) => {
    if (!currentByUrl.has(url)) removed.push(entry.result)
  })

  return { added, removed, moved, unchanged }
}

const EXPORT_VERSION = 1

function escapeCsv(value: unknown): string {
  const str = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) ?? '' : String(value)
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}

function toCsv(results: SearchResult[], metadata: Record<string, unknown>): string {
  const headers = Array.from(new Set(results.flatMap((result) => Object.keys(result))))
  const lines = [
    `# ${JSON.stringify(metadata)}`,
    headers.map(escapeCsv).join(','),
    ...results.map((result) =>
      headers.map((header) => escapeCsv(result[header as keyof SearchResult])).join(',')
    ),
  ]
  return lines.join('\n')
}

/**
 * Custom React hook for executing x402-metered search queries via Stellar/Freighter payment authorization.
 *
 * @param walletAddress - The Stellar public key address of the connected wallet, or `null` if unauthenticated.
 * @returns Object containing search session, payment/export helpers, and selection controls (`session`, `search`, `reset`,
 *          `selectedResults`, `toggleResult`, `toggleAllResults`, `clearSelection`, `isResultSelected`, `isAllSelected`,
 *          and `exportSelectedResults`). Selection callbacks are intended for keyboard-accessible controls; exports
 *          include a versioned metadata envelope (query, filters, network, receipt reference, export timestamp).
 */
export function useSearch(walletAddress: string | null = null) {
  const [session, setSession] = useState<SearchSession>({
    query: "",
    results: [],
    txHash: null,
    paidAmount: null,
    status: "idle",
    suggestions: [],
  });

  // Synchronous same-tab guard. React state (`session.status`) updates are
  // batched/async, so a double Enter or double click can both pass the
  // `status === 'searching'` check before the first render flushes. This ref
  // flips immediately, in the same tick as the first call.
  const inFlightRef = useRef(false)

  const search = useCallback(
    async (
      inputQuery: string | AdvancedSearchQuery,
      freshnessOrCount?: string | number,
      countOverride = 5,
      mode: SearchMode = 'web'
    ) => {
      let query: string
      try {
        query = typeof inputQuery === 'string' ? inputQuery : composeAdvancedSearchQuery(inputQuery)
      } catch (err: any) {
        toast.error('Invalid Advanced Query', { description: err.message })
        setSession(prev => ({ ...prev, status: 'error', error: err.message }))
        return
      }
      if (!query.trim()) return
      if (inFlightRef.current) return

      const lockId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      if (!acquireSearchLock(lockId)) {
        toast.info('Search already in progress', {
          description: 'A payment is being processed for a previous search — please wait for it to finish.',
        })
        return
      }
      inFlightRef.current = true

      let freshness = "";
      let count = countOverride;

      if (typeof freshnessOrCount === "string") {
        freshness = freshnessOrCount;
      } else if (typeof freshnessOrCount === "number") {
        count = freshnessOrCount;
      }

      const locale = localeOptions.locale || "en-US";
      const country = localeOptions.country || "us";
      const language = localeOptions.language || "en";

      setSession({
        query,
        originalQuery: query,
        executedQuery: query,
        suggestedQuery: undefined,
        isCorrected: false,
        results: [],
        txHash: null,
        paidAmount: null,
        status: "searching",
        step: 1,
        activePhase: "challenge",
        completedPhases: [],
        timings: { ...EMPTY_TIMINGS },
        currentStep: 1,
        suggestions: [],
      });

      const t0 = Date.now()
      const phaseTimings: Record<string, { durationMs: number; outcome: string }> = {}
      const recordPhase = (phase: string, durationMs: number, outcome: string) => {
        phaseTimings[phase] = { durationMs, outcome }
      }
      const params = new URLSearchParams({
        q: query,
        count: String(defaultCount),
        suggestions: mode === 'web' ? '1' : '0',
      })
      if (freshness) {
        params.set("freshness", freshness);
      }
      if (safeSearch) {
        params.set('safeSearch', safeSearch)
      }

    const advance = (step: PaymentStep) =>
      setSession((prev: SearchSession) => ({ ...prev, step }))

    try {
      if (!walletAddress) throw new Error('Connect your Freighter wallet first.')

      // Guard — run before any payment SDK loads or Freighter prompt opens.
      // A blocked search reserves nothing, so no release is needed.
      const spendCheck = recordSearchStart(AMOUNT_USDC)
      if (!spendCheck.allowed) {
        const isSession = spendCheck.kind === 'session'
        const cap = isSession ? spendCheck.sessionCap : spendCheck.dailyCap
        const msg = `Spending limit reached: ${isSession ? 'session' : 'daily'} cap (${cap} USDC). Raise it on the Dashboard.`
        console.warn('🛑 Search blocked by spending limit:', spendCheck)
        toast.error('Search Blocked by Spending Limit', { description: msg })
        setSession((prev: SearchSession) => ({ ...prev, status: 'error', error: msg }))
        return
      }

      console.log('🔍 Starting search with wallet:', walletAddress)

      const {
        x402Client, x402HTTPClient, ExactStellarScheme,
        signAuthEntry, getNetworkDetails, Networks,
      } = await loadPaymentDeps()

      // Step 1 — verify Freighter is on correct network
      if (!(typeof window !== 'undefined' && window.__STELLAR_SEARCH_E2E_WALLET__)) {
        const net = await getNetworkDetails()
        if (net.error)              throw new Error(net.error.message)
        if (net.network !== EXPECTED_WALLET_NETWORK) {
          throw new Error(`Switch Freighter to ${EXPECTED_WALLET_NETWORK}. Currently: ${net.network}`)
        }
        console.log('✅ Network verified:', net.network)
      }

      const advance = (step: PaymentStep) =>
        setSession((prev: SearchSession) => ({ ...prev, step }));

      try {
        if (!walletAddress)
          throw new Error("Connect your Freighter wallet first.");

        console.log("🔍 Starting search with wallet:", walletAddress);

          return { signedAuthEntry, signerAddress: walletAddress }
        },
      }

      // Step 3 — build the x402 client with correct .register() chain
      const client     = new x402Client().register(
        'stellar:*',
        new ExactStellarScheme(signer, { url: SOROBAN_RPC_URL })
      )
      const httpClient = new x402HTTPClient(client)
      console.log('✅ x402 client built')

      // Flow step 1 — initial request, expect 402
      advance(1)
      console.log('🚀 Initial request:', `${SERVER_URL(endpoint)}?${params}`)
      const firstRes = await fetch(`${SERVER_URL(endpoint)}?${params}`)
      console.log('📡 Status:', firstRes.status)

      if (firstRes.status !== 402) {
        if (!firstRes.ok) throw new Error(`Server error ${firstRes.status}`)
        // Free response (no payment required) — nothing was settled.
        recordSearchSettled(AMOUNT_USDC, null)
        const data = (await firstRes.json()) as SearchResponse
        setNetwork(data.network ?? null)
        return setSession({
          query, results: data.results ?? [], txHash: null,
          paidAmount: null, status: 'complete', step: 6, durationMs: Date.now() - t0, suggestions: data.suggestions ?? [],
          diagnostics: data.diagnostics,
        })
      }

        // Step 1 — verify Freighter is on correct network
        const net = await getNetworkDetails();
        if (net.error) throw new Error(net.error.message);
        if (net.network !== EXPECTED_WALLET_NETWORK) {
          throw new Error(
            `Switch Freighter to ${EXPECTED_WALLET_NETWORK}. Currently: ${net.network}`,
          );
        }
        console.log("✅ Network verified:", net.network);

      // Preflight — verify account, expected network (checked above), USDC trustline,
      // spendable amount, and signer availability before triggering the Freighter signing popup.
      const requiredAmount = paymentRequired.amount != null ? String(paymentRequired.amount) : undefined
      await withTimeout(
        preflightStellarAccount(walletAddress, requiredAmount),
        PREFLIGHT_TIMEOUT_MS
      )

          return {
            ...prev,
            activePhase: phaseState.activePhase,
            completedPhases: phaseState.completedPhases,
            timings: phaseState.timings,
            currentStep: phaseState.currentStep,
            durationMs: phaseState.durationMs,
            step: Math.min(phaseState.currentStep, 6) as PaymentStep,
          };
        });
      };

            const result = await signAuthEntry(xdr, {
              networkPassphrase: opts?.networkPassphrase ?? passphrase,
            });

      // Flow step 4 — retry with X-PAYMENT header
      advance(4)
      console.log('🔄 Retrying with payment...')
      const paidResPromise = fetch(`${SERVER_URL('/search')}?${params}`, {
        headers: paymentHeaders,
      })

            console.log(
              "✅ Freighter signed. Type:",
              typeof result.signedAuthEntry,
            );

            const raw = result.signedAuthEntry;
            const signedAuthEntry =
              typeof raw === "string"
                ? raw
                : Buffer.from(raw as unknown as Uint8Array).toString("base64");

            console.log(
              "✅ signedAuthEntry base64 length:",
              signedAuthEntry.length,
            );

            return { signedAuthEntry, signerAddress: walletAddress };
          },
        };

        // Step 3 — build the x402 client with correct .register() chain
        const client = new x402Client().register(
          "stellar:*",
          new ExactStellarScheme(signer, { url: SOROBAN_RPC_URL }),
        );
        const httpClient = new x402HTTPClient(client);
        console.log("✅ x402 client built");

        // Flow step 1 — initial request, expect 402
        advance(1);
        console.log("🚀 Initial request:", `${SERVER_URL}/search?${params}`);
        const firstRes = await fetch(`${SERVER_URL}/search?${params}`, {
          headers: {
            "X-Idempotency-Key": idempotencyKey,
            "x-wallet-address": walletAddress,
          },
        });
        console.log("📡 Status:", firstRes.status);

        if (firstRes.status !== 402) {
          if (!firstRes.ok) throw new Error(`Server error ${firstRes.status}`);
          const data = await firstRes.json();
          return setSession({
            query,
            results: data.results ?? [],
            txHash: null,
            paidAmount: null,
            status: "complete",
            step: 6,
            durationMs: Date.now() - t0,
            suggestions: data.suggestions ?? [],
          });
        }

        // Flow step 2 — parse the PAYMENT-REQUIRED header
        advance(2);
        console.log("💰 402 received, parsing payment requirements...");
        const paymentRequired = httpClient.getPaymentRequiredResponse((name) =>
          firstRes.headers.get(name),
        );
        console.log("💰 Payment requirements:", paymentRequired);

        // Flow step 3 — createPaymentPayload() triggers the Freighter popup (signs auth entry)
        advance(3);
        console.log(
          "🔐 Triggering Freighter popup via createPaymentPayload...",
        );
        const paymentPayload =
          await client.createPaymentPayload(paymentRequired);
        console.log("✅ Freighter approved, payload created");

        const paymentHeaders =
          httpClient.encodePaymentSignatureHeader(paymentPayload);
        console.log("✅ Payment headers encoded");

        // Flow step 4 — retry with X-PAYMENT header
        advance(4);
        console.log("🔄 Retrying with payment...");
        const paidResPromise = fetch(`${SERVER_URL}/search?${params}`, {
          headers: paymentHeaders,
        });

        // Flow step 5 — facilitator settles on Stellar while the retry is in flight
        advance(5);
        const paidRes = await paidResPromise;
        console.log("📡 Paid response status:", paidRes.status);

        if (!paidRes.ok) {
          const text = await paidRes.text();
          throw new Error(
            `Payment failed: server returned ${paidRes.status} — ${text}`,
          );
        }

      const validTxHash = isValidTxHash(data.txHash) ? data.txHash : null

      // Flow step 6 — result received and rendered
      setSession({
        query,
        results:     data.results    ?? [],
        txHash:      validTxHash,
        paidAmount:  data.paidAmount ?? null,
        status:      'complete',
        step:        6,
        durationMs:  Date.now() - t0,
        suggestions: data.suggestions ?? [],
        query:        data.executedQuery ?? data.query ?? query,
        originalQuery: data.originalQuery ?? query,
        executedQuery: data.executedQuery ?? data.query ?? query,
        suggestedQuery: data.suggestedQuery,
        isCorrected:  data.isCorrected ?? false,
        results:      data.results    ?? [],
        txHash:       data.txHash     ?? null,
        paidAmount:   data.paidAmount ?? null,
        status:       'complete',
        step:         6,
        durationMs:   Date.now() - t0,
        suggestions:  data.suggestions ?? [],
      })

      if (validTxHash) {
        toast.success(`Payment settled: ${data.paidAmount || '0.001'} USDC`, {
          description: 'View transaction on Stellar network',
          action: {
            label: 'Explorer',
            onClick: () => window.open(explorerTxUrl(validTxHash), '_blank')
          }
        })
      }

      // Settle the spending ledger only for a verified payment (txHash).
      // Without a txHash the search was free or unverified — release the
      // reservation instead of counting it against the caps (#313).
      recordSearchSettled(data.paidAmount || AMOUNT_USDC, data.txHash)

      // Persist receipt
      if (validTxHash) {
        try {
          const receiptsRaw = localStorage.getItem('stellarsearch_receipts')
          const receipts: SearchReceipt[] = receiptsRaw ? JSON.parse(receiptsRaw) : []
          
          const destination =
            data.destination ||
            data.payTo ||
            (paymentRequired?.accepts?.[0] as any)?.payTo ||
            ''

          const newReceipt: SearchReceipt = {
            txHash: validTxHash,
            query: query.trim(),
            amount: data.paidAmount || '0.001',
            asset: data.currency || 'USDC',
            destination: destination || undefined,
            timestamp: new Date().toISOString(),
            network: data.network || STELLAR_NETWORK || 'stellar:testnet',
            status: 'unverified',
          }
        }
      } catch (err: any) {
        console.error("❌ Search failed:", err);
        const msg = err.message || "Search failed.";
        toast.error("Search Payment Failed", { description: msg });
        setSession((prev: SearchSession) => ({
          ...prev,
          status: "error",
          error: msg,
        }));
      }

    } catch (err: any) {
      console.error('❌ Search failed:', err)
      // Release the in-flight reservation — nothing was settled.
      recordSearchSettled(AMOUNT_USDC, null)
      const msg = err.message || 'Search failed.'
      toast.error('Search Payment Failed', { description: msg })
      setSession((prev: SearchSession) => ({
        ...prev,
        status: 'error',
        error:  msg,
        errorCode: classifySearchError(err),
      }))
    } finally {
      inFlightRef.current = false
      releaseSearchLock(lockId)
    }
  }, [walletAddress, recordSearchStart, recordSearchSettled])

  const reset = useCallback(() => {
    setSession({
      query: '',
      originalQuery: '',
      executedQuery: '',
      suggestedQuery: undefined,
      isCorrected: false,
      results: [],
      txHash: null,
      paidAmount: null,
      status: 'idle',
      suggestions: [],
    })
  }, [])

  return { session, search, reset }
}
