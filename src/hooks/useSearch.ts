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
import { signAuthEntry, getNetworkDetails }    from '@stellar/freighter-api'
import { Networks }                            from '@stellar/stellar-sdk'
import { Buffer }                              from 'buffer'
import { HORIZON_URL, IS_MAINNET, EXPECTED_WALLET_NETWORK, explorerTxUrl } from '../lib/stellar'
import { TIMING_PHASES } from '../lib/timing'
import { redact } from '../lib/redactor'

const SERVER_URL = (import.meta as any).env?.VITE_SERVER_URL ?? (
  typeof window !== 'undefined' && window.location.origin.includes('vercel.app') 
    ? `${window.location.origin}/api`
    : 'http://localhost:3001'
)

// Soroban RPC URLs
const SOROBAN_RPC_TESTNET = 'https://soroban-testnet.stellar.org'
const SOROBAN_RPC_MAINNET = 'https://soroban-rpc.mainnet.stellar.org' // Or another public RPC
const SOROBAN_RPC_URL = IS_MAINNET ? SOROBAN_RPC_MAINNET : SOROBAN_RPC_TESTNET

export interface SearchReceipt {
  txHash: string
  query: string
  amount: string
  timestamp: string
  network: string
}

export interface SearchResult {
  id: string
  title: string
  url: string
  description: string
  source: string
  relevanceScore: number
  publishedAt?: string
}

// x402 flow steps, per the official x402 quickstart:
//   1 Request   2 402 Received   3 Sign Auth   4 Retry   5 Facilitate   6 Result
export type PaymentStep = 1 | 2 | 3 | 4 | 5 | 6

export interface SearchSession {
  query: string
  results: SearchResult[]
  txHash: string | null
  paidAmount: string | null
  status: 'idle' | 'searching' | 'complete' | 'error'
  step?: PaymentStep
  error?: string
  durationMs?: number
  // Phase timings with shared vocabulary — explains end-to-end performance (mirrors server/metrics.ts)
  timings?: Record<string, { durationMs: number; outcome: string }>
  suggestions: string[]
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
      const phaseTimings: Record<string, { durationMs: number; outcome: string }> = {}
      const recordPhase = (phase: string, durationMs: number, outcome: string) => {
        phaseTimings[phase] = { durationMs, outcome }
      }
      const params = new URLSearchParams({
        q: query,
        count: String(count),
        suggestions: '1',
      })
      if (freshness) {
        params.set('freshness', freshness)
      }

    const advance = (step: PaymentStep) =>
      setSession(prev => ({ ...prev, step }))

    try {
      if (!walletAddress) throw new Error('Connect your Freighter wallet first.')

      // Use redactor for logging to avoid capturing wallet addresses
      console.log('🔍 Starting search', redact({ walletAddress: walletAddress.slice(0, 6) + '…' }))

      // Step 1 — verify Freighter is on correct network
      const tValidation0 = Date.now()
      const net = await getNetworkDetails()
      if (net.error) {
        recordPhase(TIMING_PHASES.VALIDATION, Date.now() - tValidation0, 'error')
        throw new Error(net.error.message)
      }
      if (net.network !== EXPECTED_WALLET_NETWORK) {
        recordPhase(TIMING_PHASES.VALIDATION, Date.now() - tValidation0, 'error')
        throw new Error(`Switch Freighter to ${EXPECTED_WALLET_NETWORK}. Currently: ${net.network}`)
      }
      recordPhase(TIMING_PHASES.VALIDATION, Date.now() - tValidation0, 'success')
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
      const tFetch0 = Date.now()
      const firstRes = await fetch(`${SERVER_URL}/search?${params}`)
      recordPhase(TIMING_PHASES.BROWSER_FETCH, Date.now() - tFetch0, firstRes.status === 402 ? 'success' : firstRes.ok ? 'success' : 'error')

      if (firstRes.status !== 402) {
        if (!firstRes.ok) throw new Error(`Server error ${firstRes.status}`)
        const data = await firstRes.json()
        recordPhase(TIMING_PHASES.TOTAL, Date.now() - t0, 'success')
        // Merge server timings if available
        const serverTimings = (data as any).timings
        if (serverTimings) {
          for (const [k, v] of Object.entries(serverTimings)) {
            if (typeof v === 'number') recordPhase(`server_${k}`, v, 'success')
          }
        }
        return setSession({
          query, results: data.results ?? [], txHash: null,
          paidAmount: null, status: 'complete', step: 6, durationMs: Date.now() - t0, timings: { ...phaseTimings }, suggestions: data.suggestions ?? [],
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
      const tSign0 = Date.now()
      const paymentPayload = await client.createPaymentPayload(paymentRequired)
      recordPhase(TIMING_PHASES.WALLET_SIGN, Date.now() - tSign0, 'success')

      const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload)

      // Flow step 4 — retry with X-PAYMENT header
      advance(4)
      const tPaidFetch0 = Date.now()
      const paidResPromise = fetch(`${SERVER_URL}/search?${params}`, {
        headers: paymentHeaders,
      })

      // Flow step 5 — facilitator settles on Stellar while the retry is in flight
      advance(5)
      const paidRes = await paidResPromise
      recordPhase(TIMING_PHASES.X402, Date.now() - tPaidFetch0, paidRes.ok ? 'success' : 'error')

      if (!paidRes.ok) {
        const text = await paidRes.text()
        throw new Error(`Payment failed: server returned ${paidRes.status} — ${text}`)
      }

      const data = await paidRes.json()
      // Merge server phase timings into browser timings for end-to-end explanation
      const srvTimings: Record<string, number> = (data as any).timings ?? {}
      for (const [k, v] of Object.entries(srvTimings)) {
        if (typeof v === 'number') recordPhase(`server_${k}`, v, 'success')
      }
      recordPhase(TIMING_PHASES.TOTAL, Date.now() - t0, 'success')
      recordPhase(TIMING_PHASES.BROWSER_FETCH, Date.now() - tFetch0 + (Date.now() - tPaidFetch0), 'success')

      // Flow step 6 — result received and rendered
      setSession({
        query,
        results:     data.results    ?? [],
        txHash:      data.txHash     ?? null,
        paidAmount:  data.paidAmount ?? null,
        status:      'complete',
        step:        6,
        durationMs:  Date.now() - t0,
        timings: { ...phaseTimings },
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
      recordPhase(TIMING_PHASES.TOTAL, Date.now() - t0, 'error')
      console.error('❌ Search failed:', redact({ error: err.message || String(err) }))
      const msg = err.message || 'Search failed.'
      toast.error('Search Payment Failed', { description: msg })
      setSession(prev => ({
        ...prev,
        status: 'error',
        error:  msg,
        timings: { ...phaseTimings },
      }))
    }
  }, [walletAddress])

  const reset = useCallback(() => {
    setSession({ query: '', results: [], txHash: null, paidAmount: null, status: 'idle', suggestions: [] })
  }, [])

  return { session, search, reset }
}