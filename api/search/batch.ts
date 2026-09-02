import type { VercelRequest, VercelResponse } from '@vercel/node'
import { STELLAR_NETWORK, USDC_CONTRACT, AMOUNT_STROOPS, AMOUNT_USDC } from '../../src/lib/constants'
import { consumePaymentPayload } from '../../src/lib/paymentIntegrity'
import { normalizeOrganicResults, normalizeQueryMetadata } from '../../src/lib/serperNormalizer'
import crypto from 'crypto'

const RECEIVING_ADDRESS = process.env.STELLAR_RECEIVING_ADDRESS!
const NETWORK = STELLAR_NETWORK as 'stellar:testnet' | 'stellar:mainnet'
const SERPER_API_KEY = process.env.SERPER_API_KEY!

export const MAX_BATCH_SIZE = 10
export const MAX_BATCH_TOTAL_USDC = 0.01

function validateQuery(q: unknown): { ok: true; cleanQ: string } | { ok: false; error: string } {
  if (typeof q !== 'string' || !q.trim()) return { ok: false, error: 'Missing required parameter: q' }
  if (q.length > 256) return { ok: false, error: `Query too long. Maximum 256 characters.` }
  const cleanQ = q.replace(/[\x00-\x1F\x7F]/g, '').trim()
  if (!cleanQ) return { ok: false, error: 'Query contains no valid characters.' }
  return { ok: true, cleanQ }
}

// Simple in-memory idempotency for serverless (per-instance, best-effort)
const batchIdempotencyStore = new Map<string, { expiresAt: number; requestId: string }>()

function cleanupExpired(): void {
  const now = Date.now()
  for (const [k, v] of batchIdempotencyStore.entries()) if (v.expiresAt <= now) batchIdempotencyStore.delete(k)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', ['Content-Type', 'Authorization', 'X-Payment', 'payment-signature', 'x-payment', 'X-PAYMENT', 'Idempotency-Key', 'idempotency-key'].join(', '))
  res.setHeader('Access-Control-Expose-Headers', ['PAYMENT-REQUIRED', 'X-Payment-Response', 'X-Request-Id'].join(', '))

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const requestId = crypto.randomUUID()
  const tBatchStart = Date.now()

  const idempotencyKey = (req.headers['idempotency-key'] as string) || (req.body as any)?.idempotencyKey
  if (idempotencyKey) {
    cleanupExpired()
    const existing = batchIdempotencyStore.get(idempotencyKey)
    if (existing && existing.expiresAt > Date.now()) {
      return res.status(409).json({ error: 'Idempotent batch already processed', requestId: existing.requestId, idempotencyKey })
    }
  }

  const { queries, count: rawCount, freshness } = (req.body || {}) as { queries?: unknown; count?: unknown; freshness?: string }

  if (!Array.isArray(queries) || queries.length === 0) {
    return res.status(400).json({ error: 'queries array required (1..10)' })
  }
  if (queries.length > MAX_BATCH_SIZE) {
    return res.status(400).json({ error: `Batch too large: max ${MAX_BATCH_SIZE} queries, got ${queries.length}` })
  }
  const totalAmount = (parseFloat(AMOUNT_USDC) * queries.length).toFixed(3)
  if (parseFloat(totalAmount) > MAX_BATCH_TOTAL_USDC) {
    return res.status(400).json({ error: `Aggregate spending limit exceeded: ${totalAmount} USDC > ${MAX_BATCH_TOTAL_USDC} USDC` })
  }
  const cleanQueries: string[] = []
  for (const q of queries) {
    const v = validateQuery(q)
    if (!v.ok) return res.status(400).json({ error: `Invalid query "${String(q).slice(0, 30)}": ${v.error}`, index: queries.indexOf(q) })
    cleanQueries.push(v.cleanQ)
  }
  const parsedCount = Math.min(Math.max(parseInt(String(rawCount ?? '5')) || 5, 1), 20)

  const paymentHeader = (req.headers['payment-signature'] || req.headers['x-payment'] || req.headers['X-PAYMENT']) as string | undefined
  if (!paymentHeader) {
    const quoteEvent = {
      v: 1, type: 'quote', requestId, totalQueries: cleanQueries.length,
      pricePerQuery: AMOUNT_USDC, totalAmount, currency: 'USDC', network: NETWORK, payTo: RECEIVING_ADDRESS, idempotencyKey,
    }
    res.setHeader('PAYMENT-REQUIRED', Buffer.from(JSON.stringify({
      x402Version: 2,
      error: 'Payment required for batch',
      resource: { url: `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['host']}${req.url}`, description: `Batch search ${cleanQueries.length} x ${AMOUNT_USDC} USDC`, mimeType: 'application/x-ndjson' },
      accepts: [{ scheme: 'exact', network: NETWORK, amount: String(parseInt(AMOUNT_STROOPS) * cleanQueries.length), asset: USDC_CONTRACT, payTo: RECEIVING_ADDRESS, maxTimeoutSeconds: 300, extra: { areFeesSponsored: true } }],
    })).toString('base64'))
    return res.status(402).json({ error: 'Payment required', quote: quoteEvent })
  }

  const consumption = consumePaymentPayload(paymentHeader)
  if (!consumption.ok) return res.status(402).json({ error: consumption.error })
  const paymentId = consumption.paymentId
  const verified = true
  let txHash: string | null = null
  try {
    const decoded = Buffer.from(paymentHeader as string, 'base64').toString('utf8')
    const parsed = JSON.parse(decoded)
    txHash = parsed.transactionHash || parsed.txHash || null
  } catch {
    // ignore parse error
  }

  if (idempotencyKey) {
    batchIdempotencyStore.set(idempotencyKey, { requestId, expiresAt: Date.now() + 24 * 3600 * 1000 })
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.setHeader('X-Request-Id', requestId)

  let clientAborted = false
  const controller = new AbortController()
  // @ts-ignore Vercel req.on exists
  if (typeof (req as any).on === 'function') (req as any).on('close', () => { clientAborted = true; controller.abort() })

  const writeEvent = (evt: any) => {
    if (clientAborted || (res as any).writableEnded) return false
    try { (res as any).write(JSON.stringify(evt) + '\n'); return true } catch { return false }
  }

  writeEvent({ v: 1, type: 'settlement', requestId, paymentId, txHash, verified, settledAt: new Date().toISOString() })

  let succeeded = 0
  let failed = 0

  for (let i = 0; i < cleanQueries.length; i++) {
    if (clientAborted || controller.signal.aborted) {
      writeEvent({ v: 1, type: 'error', requestId, index: i, query: cleanQueries[i], error: 'Client disconnected', code: 'CLIENT_DISCONNECT' })
      failed++
      for (let j = i + 1; j < cleanQueries.length; j++) { writeEvent({ v: 1, type: 'error', requestId, index: j, query: cleanQueries[j], error: 'Skipped due to client disconnect', code: 'SKIPPED' }); failed++ }
      break
    }
    const q = cleanQueries[i]
    const t0 = Date.now()
    try {
      const requestBody: Record<string, unknown> = { q, num: parsedCount }
      if (freshness) {
        const dateFilters: Record<string, string> = { 'pd': 'qdr:d', 'pw': 'qdr:w', 'pm': 'qdr:m' }
        if (dateFilters[freshness]) requestBody.tbs = dateFilters[freshness]
      }
      const serperRes = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal as any,
      })
      if (!serperRes.ok) {
        const errText = await serperRes.text().catch(() => '')
        console.error('[serper batch vercel]', serperRes.status, errText)
        writeEvent({ v: 1, type: 'error', requestId, index: i, query: q, error: `Serper.dev API error: ${serperRes.status}`, code: 'UPSTREAM_ERROR' })
        failed++
        continue
      }
      const data: unknown = await serperRes.json()
      const latencyMs = Date.now() - t0
      const results = normalizeOrganicResults(data)
      const queryMeta = normalizeQueryMetadata(data, q)
      writeEvent({
        v: 1,
        type: 'result',
        requestId,
        index: i,
        query: queryMeta.executedQuery,
        originalQuery: queryMeta.originalQuery,
        executedQuery: queryMeta.executedQuery,
        suggestedQuery: queryMeta.suggestedQuery,
        isCorrected: queryMeta.isCorrected,
        results,
        count: results.length,
        latencyMs,
        paidAmount: AMOUNT_USDC,
        currency: 'USDC',
        network: NETWORK,
        txHash,
      })
      succeeded++
    } catch (err: any) {
      if (err?.name === 'AbortError' || controller.signal.aborted) {
        writeEvent({ v: 1, type: 'error', requestId, index: i, query: q, error: 'Aborted due to client disconnect', code: 'ABORTED' })
        failed++
        for (let j = i + 1; j < cleanQueries.length; j++) { writeEvent({ v: 1, type: 'error', requestId, index: j, query: cleanQueries[j], error: 'Skipped due to abort', code: 'SKIPPED' }); failed++ }
        break
      }
      writeEvent({ v: 1, type: 'error', requestId, index: i, query: q, error: err.message || 'Search failed', code: 'SEARCH_FAILED' })
      failed++
    }
  }

  const doneEvent = { v: 1, type: 'done', requestId, succeeded, failed, totalUsdcSpent: (succeeded * parseFloat(AMOUNT_USDC)).toFixed(3), aggregateLatencyMs: Date.now() - tBatchStart, completedAt: new Date().toISOString() }
  if (!clientAborted) writeEvent(doneEvent)
  return (res as any).end()
}
