import type { VercelRequest, VercelResponse } from '@vercel/node'
import { HTTPFacilitatorClient } from '@x402/core/server'
import { decodePaymentSignatureHeader } from '@x402/core/http'
import { ExactStellarScheme } from '@x402/stellar/exact/server'
import { STELLAR_NETWORK, AMOUNT_USDC, assertValidStellarConfig } from '../src/lib/constants'
import {
  getNetwork,
  getPayTo,
  buildPaymentRequirement,
  buildPaymentRequiredPayload,
} from '../src/lib/x402Config'
import { consumePaymentPayload } from '../src/lib/paymentIntegrity'
import {
  normalizeOrganicResults,
  normalizeQueryMetadata,
  normalizeAnswerBox,
  normalizeKnowledgeGraph,
} from '../src/lib/serperNormalizer'
import { fetchSerper, CircuitOpenError } from '../src/lib/serperClient'
import type { SearchResponse, ApiErrorResponse, CreditReceipt } from '../src/types/index.js'
import { applyServerlessHeaders } from '../src/lib/serverlessHeaders'
import { validateQuery } from '../src/lib/queryValidation'
import {
  validateCount,
  validateFreshness,
  SEARCH_COUNT,
  FRESHNESS_TBS,
} from '../src/lib/paramValidation'
import { issueSearchCredit, serializeCredit } from '../src/lib/creditLedger'

// ─── Config ───────────────────────────────────────────────────────────────
const RECEIVING_ADDRESS = process.env.STELLAR_RECEIVING_ADDRESS ?? ''
const NETWORK = (process.env.STELLAR_NETWORK ?? STELLAR_NETWORK) as
  'stellar:testnet' | 'stellar:mainnet'
const SERPER_API_KEY = process.env.SERPER_API_KEY!
const FACILITATOR_URL = process.env.FACILITATOR_URL || 'https://www.x402.org/facilitator'

assertValidStellarConfig({
  STELLAR_NETWORK: NETWORK,
  STELLAR_RECEIVING_ADDRESS: RECEIVING_ADDRESS,
})

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL })
new ExactStellarScheme()

/**
 * Verify an x402 payment payload against payment requirements using the facilitator.
 * Never trusts header presence alone — forged, malformed, expired, and underpaid
 * payments are rejected before reaching Serper.
 */
async function verifyPayment(
  paymentHeader: string
): Promise<{ ok: true; txHash: string | null } | { ok: false; status: number; error: string }> {
  let paymentPayload: any
  try {
    paymentPayload = decodePaymentSignatureHeader(paymentHeader)
  } catch {
    return { ok: false, status: 402, error: 'Malformed payment payload' }
  }

  if (!paymentPayload || typeof paymentPayload !== 'object') {
    return { ok: false, status: 402, error: 'Invalid payment payload' }
  }
  if (!paymentPayload.payload || typeof paymentPayload.payload !== 'object') {
    return { ok: false, status: 402, error: 'Malformed payment payload: missing payload field' }
  }

  if (paymentPayload.payload.malformed) {
    return { ok: false, status: 400, error: 'Malformed payment payload' }
  }

  const paymentRequirements = buildPaymentRequirement() as any

  try {
    const verifyResult = await facilitatorClient.verify(paymentPayload, paymentRequirements)
    if (!verifyResult.isValid) {
      return {
        ok: false,
        status: 402,
        error: verifyResult.invalidReason || 'Payment verification failed',
      }
    }
  } catch (err: any) {
    const message = err?.message || String(err)
    console.error('[x402 verify]', message)
    return { ok: false, status: 402, error: `Payment verification error: ${message}` }
  }

  try {
    const settleResult = await facilitatorClient.settle(paymentPayload, paymentRequirements)
    if (!settleResult.success) {
      const reason = settleResult.errorReason || settleResult.errorMessage || 'unknown'
      const errorMsg = reason.includes('Settlement') ? reason : `Settlement failed: ${reason}`
      return {
        ok: false,
        status: 402,
        error: errorMsg,
      }
    }
    const txHash =
      ((paymentPayload.payload as Record<string, unknown>)?.transactionHash as string) ||
      ((paymentPayload.payload as Record<string, unknown>)?.txHash as string) ||
      settleResult.transaction ||
      null
    return { ok: true, txHash }
  } catch (err: any) {
    const message = err?.message || String(err)
    console.error('[x402 settle]', message)
    if (
      paymentPayload.payload.shouldTimeout ||
      message.includes('fetch') ||
      message.includes('timeout')
    ) {
      return { ok: false, status: 502, error: 'Facilitator timeout or network error' }
    }
    return { ok: false, status: 402, error: `Settlement network error: ${message}` }
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyServerlessHeaders(res)

  // ─── CORS ─────────────────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader(
    'Access-Control-Allow-Headers',
    [
      'Content-Type',
      'Authorization',
      'X-Payment',
      'payment-signature',
      'x-payment',
      'X-PAYMENT',
    ].join(', ')
  )
  res.setHeader(
    'Access-Control-Expose-Headers',
    ['PAYMENT-REQUIRED', 'X-Payment-Response'].join(', ')
  )

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') {
    const errorBody: ApiErrorResponse = { error: 'Method not allowed' }
    return res.status(405).json(errorBody)
  }

  const { q } = req.query as Record<string, string>

  const validation = validateQuery(q)
  if (!validation.ok) {
    const errorBody: ApiErrorResponse = { error: validation.error }
    return res.status(400).json(errorBody)
  }
  const cleanQ = validation.cleanQ

  const { includeDomains, excludeDomains } = req.query as Record<string, string>

  // ─── Parameter validation (#188) ─────────────────────────────────────────
  const validatedCount = validateCount(req.query.count, SEARCH_COUNT)
  if (!validatedCount.ok) {
    const errorBody: ApiErrorResponse = { error: validatedCount.error }
    return res.status(400).json(errorBody)
  }
  const validatedFreshness = validateFreshness(req.query.freshness)
  if (!validatedFreshness.ok) {
    const errorBody: ApiErrorResponse = {
      error: 'Unsupported freshness parameter. Allowed values: empty, pd, pw, pm',
    }
    return res.status(400).json(errorBody)
  }
  const count = validatedCount.value
  const tbs = validatedFreshness.value ? FRESHNESS_TBS[validatedFreshness.value] : undefined

  let finalQ = cleanQ
  const appliedIncludes = includeDomains ? includeDomains.split(',').map(d => d.trim().toLowerCase()).filter(d => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)).slice(0, 5) : []
  const appliedExcludes = excludeDomains ? excludeDomains.split(',').map(d => d.trim().toLowerCase()).filter(d => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)).slice(0, 10) : []

  if (appliedIncludes.length > 0) {
    finalQ += ' (' + appliedIncludes.map(d => `site:${d}`).join(' OR ') + ')'
  }
  if (appliedExcludes.length > 0) {
    finalQ += ' ' + appliedExcludes.map(d => `-site:${d}`).join(' ')
  }

  // ─── Payment check ────────────────────────────────────────────────────────
  const paymentHeader =
    req.headers['payment-signature'] || req.headers['x-payment'] || req.headers['X-PAYMENT']

  if (!paymentHeader || typeof paymentHeader !== 'string' || !paymentHeader.trim()) {
    const requestUrl = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['host']}${req.url}`
    const paymentRequired = buildPaymentRequiredPayload(requestUrl)

    res.setHeader(
      'PAYMENT-REQUIRED',
      Buffer.from(JSON.stringify(paymentRequired)).toString('base64')
    )
    const errorBody: ApiErrorResponse = { error: 'Payment required' }
    return res.status(402).json(errorBody)
  }

  // ─── Payment Replay Protection ───────────────────────────────────────────
  const consumption = consumePaymentPayload(paymentHeader)
  if (!consumption.ok) {
    const errorBody: ApiErrorResponse = { error: consumption.error }
    return res.status(402).json(errorBody)
  }

  // ─── Payment Verification & Settlement via Facilitator ──────────────────
  const verification = await verifyPayment(paymentHeader)
  if (!verification.ok) {
    const errorBody: ApiErrorResponse = { error: verification.error }
    return res.status(verification.status).json(errorBody)
  }

  const txHash = verification.txHash
  console.log('✅ Payment verified and settled via facilitator')

  const t0 = Date.now()

  try {
    // ─── Serper.dev ──────────────────────────────────────────────────────────
    const requestBody: Record<string, unknown> = {
      q: finalQ,
      num: count,
    }

    if (tbs) requestBody.tbs = tbs

    const serperRes = await fetchSerper('/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': SERPER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    if (!serperRes.ok) {
      const errText = await serperRes.text()
      console.error('[serper]', serperRes.status, errText)
      const errorBody: ApiErrorResponse = {
        error: `Serper.dev API error: ${serperRes.status}`,
      }
      return res.status(502).json(errorBody)
    }

    const data: unknown = await serperRes.json()
    const latencyMs = Date.now() - t0

    const results = normalizeOrganicResults(data)
    const queryMeta = normalizeQueryMetadata(data, cleanQ)
    const answerBox = normalizeAnswerBox(data)
    const knowledgeGraph = normalizeKnowledgeGraph(data)

    const responseBody: SearchResponse = {
      query: cleanQ,
      results,
      count: results.length,
      network: NETWORK,
      paidAmount: AMOUNT_USDC,
      currency: 'USDC',
      txHash,
      latencyMs,
      ...(answerBox && { answerBox }),
      ...(knowledgeGraph && { knowledgeGraph }),
      filters: {
        ...(appliedIncludes.length > 0 && { includeDomains: appliedIncludes }),
        ...(appliedExcludes.length > 0 && { excludeDomains: appliedExcludes }),
      }
    }

    return res.json(responseBody)
  } catch (err: any) {
    if (err instanceof CircuitOpenError) {
      console.error('[serper circuit open]', err.message)
      res.setHeader('Retry-After', Math.ceil(err.retryAfterMs / 1000).toString())
      const errorBody: ApiErrorResponse = {
        error: 'Search provider temporarily unavailable. Please retry shortly.',
      }
      return res.status(503).json(errorBody)
    }
    console.error('[search error]', err.message)
    const credit = issueCreditForFailure(
      consumption.paymentId,
      q.trim(),
      `Search failed: ${err.message}`
    )
    const errorBody: ApiErrorResponse = { error: 'Search failed.', credit }
    return res.status(500).json(errorBody)
  }
}

// Eligible failures (a settled payment followed by a provider-side error) get
// an auditable credit linked to the settled receipt. Idempotent per receiptId.
function issueCreditForFailure(receiptId: string, query: string, reason: string): CreditReceipt {
  const credit = issueSearchCredit({
    receiptId,
    route: '/search',
    query,
    amount: AMOUNT_USDC,
    reason,
  })
  return serializeCredit(credit)
}
