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
import { x402Client, x402HTTPClient }          from '@x402/fetch'
import { ExactStellarScheme }                  from '@x402/stellar/exact/client'
import { signAuthEntry, getNetworkDetails, getPublicKey } from '@stellar/freighter-api'
import { Networks, Horizon, StrKey }           from '@stellar/stellar-sdk'
import { Buffer }                              from 'buffer'
import { IS_MAINNET, EXPECTED_WALLET_NETWORK, explorerTxUrl } from '../lib/stellar'

const SERVER_URL = (import.meta as any).env?.VITE_SERVER_URL ?? (
  typeof window !== 'undefined' && window.location.origin.includes('vercel.app') 
    ? `${window.location.origin}/api`
    : 'http://localhost:3001'
)

// Soroban RPC URLs
const SOROBAN_RPC_TESTNET = 'https://soroban-testnet.stellar.org'
const SOROBAN_RPC_MAINNET = 'https://soroban-rpc.mainnet.stellar.org' // Or another public RPC
const SOROBAN_RPC_URL = IS_MAINNET ? SOROBAN_RPC_MAINNET : SOROBAN_RPC_TESTNET

const HORIZON_URL = IS_MAINNET ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org'

const PREFLIGHT_TIMEOUT_MS = 8000
const USDC_ISSUER = IS_MAINNET
  ? 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZP'
  : 'GBBD47IF6LWK7P7MDEVSCWR7DPUWVKGNY3DGQPCACV4BYN6JFCEDUKW3'

import type { SearchResult, SearchReceipt, SearchResponse, PaymentStep, SearchSession } from '../types'

export type { SearchResult, SearchReceipt, PaymentStep, SearchSession }

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

/**
 * Custom React hook for executing x402-metered search queries via Stellar/Freighter payment authorization.
 *
 * @param walletAddress - The Stellar public key address of the connected wallet, or `null` if unauthenticated.
 * @returns Object containing search session state (`session`), search execution function (`search`), and session reset function (`reset`).
 */
export function useSearch(walletAddress: string | null = null) {
  const [session, setSession] = useState<SearchSession>({
    query: '', results: [], txHash: null, paidAmount: null, status: 'idle', suggestions: [],
  })

  const search = useCallback(
    async (
      query: string,
      freshnessOrCount?: string | number,
      countOverride = 5
    ) => {
      if (!query.trim()) return

      let freshness = ''
      let count = countOverride

      if (typeof freshnessOrCount === 'string') {
        freshness = freshnessOrCount
      } else if (typeof freshnessOrCount === 'number') {
        count = freshnessOrCount
      }

      setSession({
        query,
        results: [],
        txHash: null,
        paidAmount: null,
        status: 'searching',
        step: 1,
        suggestions: [],
      })

      const t0 = Date.now()
      const params = new URLSearchParams({
        q: query,
        count: String(count),
        suggestions: '1',
      })
      if (freshness) {
        params.set('freshness', freshness)
      }

    const advance = (step: PaymentStep) =>
      setSession((prev: SearchSession) => ({ ...prev, step }))

    try {
      if (!walletAddress) throw new Error('Connect your Freighter wallet first.')

      console.log('🔍 Starting search with wallet:', walletAddress)

      // Step 1 — verify Freighter is on correct network
      const net = await withTimeout(getNetworkDetails(), PREFLIGHT_TIMEOUT_MS)
      if (net.error)              throw new Error(net.error.message)
      if (net.network !== EXPECTED_WALLET_NETWORK) {
        throw new Error(`Switch Freighter to ${EXPECTED_WALLET_NETWORK}. Currently: ${net.network}`)
      }
      console.log('✅ Network verified:', net.network)

      // Step 2 — build the signer
      const passphrase = IS_MAINNET ? Networks.PUBLIC : Networks.TESTNET
      const signer = {
        address: walletAddress,
        signAuthEntry: async (
          xdr: string,
          opts?: { networkPassphrase?: string }
        ): Promise<{ signedAuthEntry: string; signerAddress: string }> => {
          console.log('🔑 Calling Freighter signAuthEntry...')

          const result = await signAuthEntry(xdr, {
            networkPassphrase: opts?.networkPassphrase ?? passphrase,
          })

          if (result.error) throw new Error(result.error.message)
          if (!result.signedAuthEntry) throw new Error('Freighter returned no signedAuthEntry')

          console.log('✅ Freighter signed. Type:', typeof result.signedAuthEntry)

          const raw = result.signedAuthEntry
          const signedAuthEntry = typeof raw === 'string'
            ? raw
            : Buffer.from(raw as unknown as Uint8Array).toString('base64')

          console.log('✅ signedAuthEntry base64 length:', signedAuthEntry.length)

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
          query, results: data.results ?? [], txHash: null,
          paidAmount: null, status: 'complete', step: 6, durationMs: Date.now() - t0, suggestions: data.suggestions ?? [],
        })
      }

      // Flow step 2 — parse the PAYMENT-REQUIRED header
      advance(2)
      console.log('💰 402 received, parsing payment requirements...')
      const paymentRequired = httpClient.getPaymentRequiredResponse(
        (name) => firstRes.headers.get(name)
      )
      console.log('💰 Payment requirements:', paymentRequired)

      // Preflight — verify account, expected network (checked above), USDC trustline,
      // spendable amount, and signer availability before triggering the Freighter signing popup.
      const requiredAmount = paymentRequired.amount != null ? String(paymentRequired.amount) : undefined
      await withTimeout(
        preflightStellarAccount(walletAddress, requiredAmount),
        PREFLIGHT_TIMEOUT_MS
      )

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

      const data = (await paidRes.json()) as SearchResponse
      console.log('✅ Search complete!')

      // Flow step 6 — result received and rendered
      setSession({
        query,
        results:     data.results    ?? [],
        txHash:      data.txHash     ?? null,
        paidAmount:  data.paidAmount ?? null,
        status:      'complete',
        step:        6,
        durationMs:  Date.now() - t0,
        suggestions: data.suggestions ?? [],
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
          const receiptsRaw = localStorage.getItem('stellarsearch_receipts')
          const receipts: SearchReceipt[] = receiptsRaw ? JSON.parse(receiptsRaw) : []
          
          const newReceipt: SearchReceipt = {
            txHash: data.txHash,
            query: query.trim(),
            amount: data.paidAmount || '0.001',
            timestamp: new Date().toISOString(),
            network: data.network || 'stellar:testnet',
          }

          // Keep only last 50 receipts
          const updated = [newReceipt, ...receipts].slice(0, 50)
          localStorage.setItem('stellarsearch_receipts', JSON.stringify(updated))
          console.log('📄 Receipt persisted')
        } catch (e) {
          console.warn('Failed to persist receipt:', e)
        }
      }

    } catch (err: any) {
      console.error('❌ Search failed:', err)
      const msg = err.message || 'Search failed.'
      toast.error('Search Payment Failed', { description: msg })
      setSession((prev: SearchSession) => ({
        ...prev,
        status: 'error',
        error:  msg,
      }))
    }
  }, [walletAddress])

  const reset = useCallback(() => {
    setSession({ query: '', results: [], txHash: null, paidAmount: null, status: 'idle', suggestions: [] })
  }, [])

  return { session, search, reset }
}