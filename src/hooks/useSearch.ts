import { readBrowserConfig } from '../lib/config'
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

import { useState, useCallback }              from 'react'
import { toast }                               from 'sonner'
import { Buffer }                              from 'buffer'
import { IS_MAINNET, EXPECTED_WALLET_NETWORK, explorerTxUrl } from '../lib/stellar'

const SERVER_URL = readBrowserConfig().apiBaseUrl

// Soroban RPC URLs
const SOROBAN_RPC_TESTNET = "https://soroban-testnet.stellar.org";
const SOROBAN_RPC_MAINNET = "https://soroban-rpc.mainnet.stellar.org"; // Or another public RPC
const SOROBAN_RPC_URL = IS_MAINNET ? SOROBAN_RPC_MAINNET : SOROBAN_RPC_TESTNET;

import type {
  SearchResult,
  SearchReceipt,
  SearchResponse,
  PaymentStep,
  SearchSession,
  SearchParamsOptions,
} from "../types";

export type {
  SearchResult,
  SearchReceipt,
  PaymentStep,
  SearchSession,
  SearchParamsOptions,
};

/**
 * Custom React hook for executing x402-metered search queries via Stellar/Freighter payment authorization.
 *
 * @param walletAddress - The Stellar public key address of the connected wallet, or `null` if unauthenticated.
 * @returns Object containing search session state (`session`), search execution function (`search`), and session reset function (`reset`).
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

  const search = useCallback(
    async (
      query: string,
      freshnessOrCount?: string | number,
      countOverride = 5,
      localeOptions: SearchParamsOptions = {},
    ) => {
      if (!query.trim()) return;

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
        suggestions: [],
      });

      const t0 = Date.now();
      const params = new URLSearchParams({
        q: query,
        count: String(count),
        suggestions: "1",
        locale,
        country,
        language,
      });
      if (freshness) {
        params.set('freshness', freshness)
      }

    const advance = (step: PaymentStep) =>
      setSession((prev: SearchSession) => ({ ...prev, step }))

    try {
      if (!walletAddress) throw new Error('Connect your Freighter wallet first.')

      console.log('🔍 Starting search with wallet:', walletAddress)

      const {
        x402Client, x402HTTPClient, ExactStellarScheme,
        signAuthEntry, getNetworkDetails, Networks,
      } = await loadPaymentDeps()

      // Step 1 — verify Freighter is on correct network
      const net = await getNetworkDetails()
      if (net.error)              throw new Error(net.error.message)
      if (net.network !== EXPECTED_WALLET_NETWORK) {
        throw new Error(`Switch Freighter to ${EXPECTED_WALLET_NETWORK}. Currently: ${net.network}`)
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
      console.log('🚀 Initial request:', `${SERVER_URL}/search?${params}`)
      const firstRes = await fetch(`${SERVER_URL}/search?${params}`)
      console.log('📡 Status:', firstRes.status)

      if (firstRes.status !== 402) {
        if (!firstRes.ok) throw new Error(`Server error ${firstRes.status}`)
        const data = (await firstRes.json()) as SearchResponse
        return setSession({
          query: data.executedQuery ?? data.query ?? query,
          originalQuery: data.originalQuery ?? query,
          executedQuery: data.executedQuery ?? data.query ?? query,
          suggestedQuery: data.suggestedQuery,
          isCorrected: data.isCorrected ?? false,
          results: data.results ?? [],
          txHash: null,
          paidAmount: null,
          status: 'complete',
          step: 6,
          durationMs: Date.now() - t0,
          suggestions: data.suggestions ?? [],
        })
      }

      // Flow step 2 — parse the PAYMENT-REQUIRED header
      advance(2)
      console.log('💰 402 received, parsing payment requirements...')
      const paymentRequired = httpClient.getPaymentRequiredResponse(
        (name) => firstRes.headers.get(name)
      )
      console.log('💰 Payment requirements:', paymentRequired)

      // Flow step 3 — createPaymentPayload() triggers the Freighter popup (signs auth entry)
      advance(3)
      console.log('🔐 Triggering Freighter popup via createPaymentPayload...')
      const paymentPayload = await client.createPaymentPayload(paymentRequired)
      console.log('✅ Freighter approved, payload created')

      const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload)
      console.log('✅ Payment headers encoded')

      // Flow step 4 — retry with X-PAYMENT header
      advance(4)
      console.log('🔄 Retrying with payment...')
      const paidResPromise = fetch(`${SERVER_URL}/search?${params}`, {
        headers: paymentHeaders,
      })

      // Flow step 5 — facilitator settles on Stellar while the retry is in flight
      advance(5)
      const paidRes = await paidResPromise
      console.log('📡 Paid response status:', paidRes.status)

      if (!paidRes.ok) {
        const text = await paidRes.text()
        throw new Error(`Payment failed: server returned ${paidRes.status} — ${text}`)
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

      // Flow step 6 — result received and rendered
      setSession({
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

      if (data.txHash) {
        const settledTxHash = data.txHash
        toast.success(`Payment settled: ${data.paidAmount || '0.001'} USDC`, {
          description: 'View transaction on Stellar network',
          action: {
            label: 'Explorer',
            onClick: () => window.open(explorerTxUrl(settledTxHash), '_blank')
          }
        })
      }

        // Persist receipt
        if (data.txHash) {
          try {
            const receiptsRaw = localStorage.getItem("stellarsearch_receipts");
            const receipts: SearchReceipt[] = receiptsRaw
              ? JSON.parse(receiptsRaw)
              : [];

            const newReceipt: SearchReceipt = {
              txHash: data.txHash,
              query: query.trim(),
              amount: data.paidAmount || "0.001",
              timestamp: new Date().toISOString(),
              network: data.network || "stellar:testnet",
            };

            // Keep only last 50 receipts
            const updated = [newReceipt, ...receipts].slice(0, 50);
            localStorage.setItem(
              "stellarsearch_receipts",
              JSON.stringify(updated),
            );
            console.log("📄 Receipt persisted");
          } catch (e) {
            console.warn("Failed to persist receipt:", e);
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
    },
    [walletAddress],
  );

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
