/**
 * StellarSearch Server
 * Real x402 payment middleware + Serper.dev Search + Groq AI
 *
 * Uses the CORRECT API per official Stellar x402 quickstart:
 *   paymentMiddlewareFromConfig() instead of paymentMiddleware()
 *   This is what the official docs and x402-stellar repo use.
 *
 * Packages:
 *   @x402/express  — paymentMiddlewareFromConfig
 *   @x402/stellar  — ExactStellarScheme (server)
 *   @x402/core     — HTTPFacilitatorClient
 *   groq-sdk       — Groq AI (Llama 3)
 */

import express, { Request, Response } from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { buildCorsOptions, getCorsStartupMessage } from './corsConfig.js'
import Groq from 'groq-sdk'
import { paymentMiddlewareFromConfig } from '@x402/express'
import { ExactStellarScheme } from '@x402/stellar/exact/server'
import { HTTPFacilitatorClient } from '@x402/core/server'
import logger from './logger'
import crypto, { randomUUID } from 'crypto'
import {
  STELLAR_NETWORK,
  AMOUNT_USDC,
  AMOUNT_STROOPS,
  USDC_CONTRACT
} from '../src/lib/constants'
import { consumePaymentPayload, extractPaymentIdentifier } from '../src/lib/paymentIntegrity'
import { formatConfigurationError, readServerConfig } from '../src/lib/config'
import {
  normalizeOrganicResults,
  normalizeImageResults,
  normalizeNewsResults,
  normalizeQueryMetadata,
} from '../src/lib/serperNormalizer.js'
import type {
  SearchResponse,
  ImageSearchResponse,
  NewsSearchResponse,
  ApiErrorResponse,
  BatchJsonlEvent,
  BatchJsonlQuoteEvent,
  BatchJsonlSettlementEvent,
  BatchJsonlResultEvent,
  BatchJsonlErrorEvent,
  BatchJsonlDoneEvent,
  SearchJob,
  JobStatus,
} from '../src/types/index.js'
import { buildReconciliationRecord, type ReconciliationRoute } from '../src/lib/reconciliation.js'
import { appendReconciliationRecord } from './reconciliationStore.js'

dotenv.config()

let config
try {
  config = readServerConfig()
} catch (error) {
  console.error(formatConfigurationError(error))
  throw error
}

const app  = express()
const PORT = config.port
const RATE_LIMIT_PER_MINUTE = config.rateLimitPerMinute

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: RATE_LIMIT_PER_MINUTE,
  standardHeaders: true,
  legacyHeaders: true,
  handler: (_req: Request, res: Response) => {
    res.setHeader('Retry-After', '60')
    res.status(429).json({ error: 'Too many requests, please try again later.' })
  },
})

// ─── Security Headers & Middleware ────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: [
          "'self'",
          'https://horizon-testnet.stellar.org',
          'https://horizon.stellar.org',
          'https://soroban-testnet.stellar.org',
          'https://soroban-rpc.mainnet.stellar.org',
          'https://google.serper.dev',
          'https://www.x402.org',
          'https://channels.openzeppelin.com',
          'http://localhost:*',
          'ws://localhost:*',
        ],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
)
app.use(cors(buildCorsOptions()))
app.use(express.json())
app.use(limiter)

// ─── In-memory stats ──────────────────────────────────────────────────────
const stats = {
  totalQueries: 0,
  totalUsdcSettled: 0,
  latencies: [] as number[],
  startTime: Date.now(),
}

// ─── Batch idempotency & async job stores (issues #324, #325) ────────────
export const MAX_BATCH_SIZE = 10
export const MAX_BATCH_TOTAL_USDC = 0.01
export const MAX_JOB_WEBHOOK_ATTEMPTS = 5
export const WEBHOOK_RETRY_BASE_MS = 1000

// Batch idempotency cache: key -> { expiresAt, resultSummary }
export const batchIdempotencyStore = new Map<string, { expiresAt: number; requestId: string }>()
// Job store: jobId -> SearchJob
export const jobStore = new Map<string, SearchJob>()
// Job idempotency: key -> jobId
export const jobIdempotencyStore = new Map<string, { jobId: string; expiresAt: number }>()
// Recent receipts for MCP resources (opted-in, in-memory capped at 50)
export const recentReceipts: Array<{ id: string; query: string; txHash: string | null; amount: string; currency: string; network: string; timestamp: string; latencyMs: number; count: number }> = []

export function resetBatchJobStores(): void {
  batchIdempotencyStore.clear()
  jobStore.clear()
  jobIdempotencyStore.clear()
  recentReceipts.length = 0
}

export function addRecentReceipt(receipt: typeof recentReceipts[number]): void {
  recentReceipts.unshift(receipt)
  if (recentReceipts.length > 50) recentReceipts.pop()
}

function cleanupBatchIdempotency(now = Date.now()): void {
  for (const [k, v] of batchIdempotencyStore.entries()) if (v.expiresAt <= now) batchIdempotencyStore.delete(k)
  for (const [k, v] of jobIdempotencyStore.entries()) if (v.expiresAt <= now) jobIdempotencyStore.delete(k)
}

// ─── Webhook SSRF protection & signing (issue #324) ─────────────────────
const BLOCKED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'])

export function isPrivateIp(hostname: string): boolean {
  if (BLOCKED_HOSTNAMES.has(hostname.toLowerCase())) return true
  // 10.0.0.0/8
  if (/^10\.\d+\.\d+\.\d+$/.test(hostname)) return true
  // 192.168.0.0/16
  if (/^192\.168\.\d+\.\d+$/.test(hostname)) return true
  // 172.16.0.0/12
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(hostname)) return true
  // 169.254.0.0/16 link-local
  if (/^169\.254\.\d+\.\d+$/.test(hostname)) return true
  // fc00::/7 private, fe80::/10 link-local
  if (hostname.includes(':') && (/^fc/i.test(hostname) || /^fd/i.test(hostname) || /^fe80/i.test(hostname))) return true
  return false
}

export function validateWebhookUrl(urlStr: string): { ok: true } | { ok: false; error: string } {
  let parsed: URL
  try {
    parsed = new URL(urlStr)
  } catch {
    return { ok: false, error: 'Invalid webhook URL' }
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'Webhook URL must be https' }
  }
  if (isPrivateIp(parsed.hostname)) {
    return { ok: false, error: 'Webhook URL points to private or blocked host (SSRF protection)' }
  }
  if (parsed.username || parsed.password) return { ok: false, error: 'Webhook URL must not contain credentials' }
  return { ok: true }
}

export function signWebhookPayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex')
}

export function verifyWebhookSignature(payload: string, signature: string, secret: string, maxAgeMs = 5 * 60 * 1000, timestampHeader?: string): boolean {
  const expected = signWebhookPayload(payload, secret)
  // timing-safe compare
  if (expected.length !== signature.length) return false
  try {
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return false
  } catch { return false }
  if (timestampHeader) {
    const ts = parseInt(timestampHeader, 10)
    if (!Number.isFinite(ts)) return false
    const age = Date.now() - ts
    if (age < 0 || age > maxAgeMs) return false
  }
  return true
}

async function deliverWebhookWithRetry(job: SearchJob, maxAttempts = MAX_JOB_WEBHOOK_ATTEMPTS): Promise<void> {
  if (!job.webhookUrl || !job.webhookSecret) return
  const payloadObj = {
    event: 'job.completed',
    jobId: job.id,
    status: job.status,
    query: job.query,
    result: job.result ?? null,
    error: job.error ?? null,
    txHash: job.txHash,
    paymentVerified: job.verified,
    timestamp: new Date().toISOString(),
    nonce: crypto.randomUUID(),
  }
  const payload = JSON.stringify(payloadObj)
  const timestamp = String(Date.now())
  const signature = signWebhookPayload(`${timestamp}.${payload}`, job.webhookSecret)

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      const res = await fetch(job.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Timestamp': timestamp,
          'X-Webhook-Attempt': String(attempt),
          'X-Job-Id': job.id,
          'User-Agent': 'StellarSearch-Webhook/1.0',
        },
        body: payload,
        signal: controller.signal,
      })
      clearTimeout(timeout)
      if (res.ok) return
      // 4xx except 429 should not retry
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        console.warn(`[webhook] non-retryable ${res.status} for job ${job.id}`)
        return
      }
    } catch (err: any) {
      console.warn(`[webhook] attempt ${attempt} failed for job ${job.id}: ${err.message}`)
    }
    if (attempt < maxAttempts) {
      const backoff = WEBHOOK_RETRY_BASE_MS * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 200)
      await new Promise((r) => setTimeout(r, backoff))
    }
  }
  console.error(`[webhook] exhausted retries for job ${job.id}`)
}

// ─── Config ───────────────────────────────────────────────────────────────
const RECEIVING_ADDRESS = config.receivingAddress
const FACILITATOR_URL   = config.facilitatorUrl
const NETWORK           = config.stellarNetwork
const SERPER_API_KEY    = config.serperApiKey
const GROQ_API_KEY      = config.groqApiKey
const AMOUNT_USDC       = config.amountUsdc
const AMOUNT_STROOPS    = config.amountStroops

// ─── Groq ─────────────────────────────────────────────────────────────────
const groq = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : undefined

// ─── x402 payment guard on /search ───────────────────────────────────────
// paymentMiddlewareFromConfig is the recommended API per official Stellar docs.
// It uses the Coinbase public facilitator (no API key needed for testnet).
const x402Accepts = [{
  scheme:  'exact',
  price:   parseFloat(AMOUNT_USDC),
  amount:  AMOUNT_STROOPS,
  network: NETWORK,
  payTo:   RECEIVING_ADDRESS,
}]

const x402Routes = {
  'GET /search': {
    accepts: x402Accepts,
    description: `StellarSearch: pay-per-query web search — ${AMOUNT_USDC} USDC on Stellar`,
  },
  'GET /images': {
    accepts: x402Accepts,
    description: `StellarSearch: pay-per-query image search — ${AMOUNT_USDC} USDC on Stellar`,
  },
  'GET /news': {
    accepts: x402Accepts,
    description: `StellarSearch: pay-per-query news search — ${AMOUNT_USDC} USDC on Stellar`,
  },
  'POST /search/batch': {
    accepts: [{
      scheme: 'exact',
      price: parseFloat(AMOUNT_USDC) * MAX_BATCH_SIZE,
      amount: String(parseInt(AMOUNT_STROOPS) * MAX_BATCH_SIZE),
      network: NETWORK,
      payTo: RECEIVING_ADDRESS,
    }],
    description: `StellarSearch: batch web search (up to ${MAX_BATCH_SIZE}) — ${AMOUNT_USDC} USDC per query on Stellar, JSONL streaming`,
  },
  'POST /jobs': {
    accepts: x402Accepts,
    description: `StellarSearch: async paid search job — ${AMOUNT_USDC} USDC on Stellar, webhook callback`,
  },
}

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL })
const schemes = [{ network: NETWORK, server: new ExactStellarScheme() }]

// Apply middleware to all routes, not just /search

// ─── Payment Logging Middleware ──────────────────────────────────────────
app.use((req, res, next) => {
  if (req.path === '/search') {
    const { q } = req.query as Record<string, string>;
    const truncatedQ = q ? String(q).substring(0, 50) : '';

    res.on('finish', () => {
      let paymentStatus = 'error';
      if (res.statusCode === 200) paymentStatus = 'paid';
      else if (res.statusCode === 402) paymentStatus = '402';

      logger.info('Payment attempt', {
        timestamp: new Date().toISOString(),
        ip: req.ip,
        query: truncatedQ,
        paymentStatus: paymentStatus,
      });
    });
  }
  next();
});

app.use(paymentMiddlewareFromConfig(x402Routes, facilitatorClient, schemes))

// ─── Payment Replay Protection Middleware ─────────────────────────────────
app.use((req, res, next) => {
  const paidRoutes = ['/search', '/images', '/news']
  if (paidRoutes.includes(req.path)) {
    const paymentHeader =
      req.headers['payment-signature'] ||
      req.headers['x-payment'] ||
      req.headers['X-PAYMENT'] ||
      req.headers['x-payment-response'] ||
      req.headers['authorization']

    if (paymentHeader) {
      const consumption = consumePaymentPayload(paymentHeader)
      if (!consumption.ok) {
        return res.status(402).json({ error: consumption.error })
      }
      // Captured for reconciliation — links this request to the settled
      // payment identifier without ever touching query content.
      ;(req as any).paymentId = consumption.paymentId
    }
  }
  next()
})

// Builds and persists a ReconciliationRecord for a paid route. Never throws —
// a logging failure must not affect the response already sent to the client.
function recordReconciliation(params: {
  req: Request
  route: ReconciliationRoute
  requestId: string
  providerDelivered: boolean
  resultCount: number
  txHash: string | null
}): void {
  try {
    const idempotencyKey = (params.req as any).paymentId ?? null
    // Nothing to reconcile: no payment was captured and nothing was
    // delivered (e.g. a bad `q` rejected before any payment attempt).
    if (idempotencyKey === null && !params.providerDelivered) return

    const record = buildReconciliationRecord({
      requestId: params.requestId,
      idempotencyKey,
      route: params.route,
      receiptTxHash: params.txHash,
      providerDelivered: params.providerDelivered,
      resultCount: params.resultCount,
    })
    appendReconciliationRecord(record)
  } catch (err: any) {
    console.error('[reconciliation] failed to record:', err.message)
  }
}

export const MAX_QUERY_LENGTH = 256

// Validate and sanitize the user-supplied `q` parameter. Returns either the
// cleaned string or a 400 response body to send back. Centralised so /search
// and /images share the same rules.
export function validateQuery(
  q: unknown,
): { ok: true; cleanQ: string } | { ok: false; error: string } {
  if (typeof q !== 'string' || !q.trim()) {
    return { ok: false, error: 'Missing required parameter: q' }
  }
  if (q.length > MAX_QUERY_LENGTH) {
    return { ok: false, error: `Query too long. Maximum ${MAX_QUERY_LENGTH} characters.` }
  }
  // Strip null bytes and ASCII control characters (C0 + DEL) to prevent
  // log injection and odd Serper behavior.
  const cleanQ = q.replace(/[\x00-\x1F\x7F]/g, '').trim()
  if (!cleanQ) {
    return { ok: false, error: 'Query contains no valid characters.' }
  }
  return { ok: true, cleanQ }
}

// ─── GET /search ──────────────────────────────────────────────────────────
app.get('/search', async (req: Request, res: Response) => {
  const requestId = randomUUID()
  let providerDelivered = false
  let resultCount = 0
  let txHash: string | null = null

  try {
    const { q, count = '5', freshness } = req.query as Record<string, string>

    const v = validateQuery(q)
    if (!v.ok) {
      const errorBody: ApiErrorResponse = { error: v.error }
      return res.status(400).json(errorBody)
    }
    const cleanQ = v.cleanQ

    const t0 = Date.now()

    const requestBody: Record<string, unknown> = {
      q: cleanQ,
      num: Math.min(parseInt(count) || 5, 20),
    }

    // Add freshness filter if provided (Serper supports date filters)
    if (freshness) {
      const dateFilters: Record<string, string> = {
        'pd': 'qdr:d',  // past day
        'pw': 'qdr:w',  // past week
        'pm': 'qdr:m',  // past month
      }
      if (dateFilters[freshness]) {
        requestBody.tbs = dateFilters[freshness]
      }
    }

    const serperRes = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': SERPER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    if (!serperRes.ok) {
      const err = await serperRes.text()
      console.error('[serper]', serperRes.status, err)
      const errorBody: ApiErrorResponse = { error: `Serper.dev API error: ${serperRes.status}` }
      return res.status(502).json(errorBody)
    }

    const data: unknown = await serperRes.json()
    const latencyMs = Date.now() - t0

    stats.totalQueries++
    stats.totalUsdcSettled += 0.001
    stats.latencies.push(latencyMs)
    if (stats.latencies.length > 200) stats.latencies.shift()

    const results = normalizeOrganicResults(data)
    const queryMeta = normalizeQueryMetadata(data, cleanQ)

    // The real tx hash comes from the X-PAYMENT-RESPONSE header set by the facilitator
    txHash = (req.headers['x-payment-response'] as string) || null

    // ── Optional AI suggestions via Groq ──────────────────────────────────
    let suggestions: string[] = []
    if (req.query.suggestions === '1' && results.length > 0) {
      try {
        const topSnippets = results.slice(0, 3).map((r) => r.description).join(' | ')
        const suggCompletion = await groq.chat.completions.create({
          model: 'llama-3.3-70b-versatile',
          messages: [
            {
              role: 'system',
              content: 'You are a search assistant. Given a query and top result snippets, return exactly 3 related search queries the user might want to explore next. Output only a JSON array of 3 strings, no explanation.',
            },
            {
              role: 'user',
              content: `Query: "${queryMeta.executedQuery}"\nTop results: ${topSnippets}`,
            },
          ],
          max_tokens: 120,
          temperature: 0.7,
        })
        const raw = suggCompletion.choices[0]?.message?.content || '[]'
        const match = raw.match(/\[[\s\S]*\]/)
        if (match) {
          const parsed = JSON.parse(match[0])
          if (Array.isArray(parsed)) {
            suggestions = parsed
              .filter((s: unknown): s is string => typeof s === 'string' && s.trim().length > 0)
              .map((s: string) => s.trim())
              .slice(0, 3)
          }
        }
      } catch (err: any) {
        console.warn('[suggestions] Groq error:', err.message)
      }
    }

    const responseBody: SearchResponse = {
      query: queryMeta.executedQuery,
      originalQuery: queryMeta.originalQuery,
      executedQuery: queryMeta.executedQuery,
      suggestedQuery: queryMeta.suggestedQuery,
      isCorrected: queryMeta.isCorrected,
      results,
      count: results.length,
      network: NETWORK,
      paidAmount: AMOUNT_USDC,
      currency: 'USDC',
      txHash,
      latencyMs,
      suggestions,
    }

    // Record opted-in receipt (cap 50, in-memory)
    try {
      addRecentReceipt({ id: txHash || `local-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, query: queryMeta.originalQuery, txHash, amount: AMOUNT_USDC, currency: 'USDC', network: NETWORK, timestamp: new Date().toISOString(), latencyMs, count: results.length })
    } catch {
      // ignore receipt recording failure
    }

    providerDelivered = true
    resultCount = results.length
    return res.json(responseBody)
  } catch (err: any) {
    console.error('[search error]', err.message)
    const errorBody: ApiErrorResponse = { error: 'Search failed. Check server logs.' }
    return res.status(500).json(errorBody)
  } finally {
    recordReconciliation({ req, route: '/search', requestId, providerDelivered, resultCount, txHash })
  }
})

// ─── GET /images ──────────────────────────────────────────────────────────
app.get('/images', async (req: Request, res: Response) => {
  const requestId = randomUUID()
  let providerDelivered = false
  let resultCount = 0
  let txHash: string | null = null

  try {
    const { q, count = '10' } = req.query as Record<string, string>

    const v = validateQuery(q)
    if (!v.ok) {
      const errorBody: ApiErrorResponse = { error: v.error }
      return res.status(400).json(errorBody)
    }
    const cleanQ = v.cleanQ

    const t0 = Date.now()

    const serperRes = await fetch('https://google.serper.dev/images', {
      method: 'POST',
      headers: {
        'X-API-KEY': SERPER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: cleanQ,
        num: Math.min(parseInt(count) || 10, 10),
      }),
    })

    if (!serperRes.ok) {
      const err = await serperRes.text()
      console.error('[serper images]', serperRes.status, err)
      const errorBody: ApiErrorResponse = { error: `Serper.dev API error: ${serperRes.status}` }
      return res.status(502).json(errorBody)
    }

    const data: unknown = await serperRes.json()
    const latencyMs = Date.now() - t0

    stats.totalQueries++
    stats.totalUsdcSettled += parseFloat(AMOUNT_USDC)
    stats.latencies.push(latencyMs)
    if (stats.latencies.length > 200) stats.latencies.shift()

    const results = normalizeImageResults(data)

    txHash = (req.headers['x-payment-response'] as string) || null

    const responseBody: ImageSearchResponse = {
      query: cleanQ,
      results,
      count: results.length,
      network: NETWORK,
      paidAmount: AMOUNT_USDC,
      currency: 'USDC',
      txHash,
      latencyMs,
    }

    providerDelivered = true
    resultCount = results.length
    return res.json(responseBody)
  } catch (err: any) {
    console.error('[images error]', err.message)
    const errorBody: ApiErrorResponse = { error: 'Image search failed. Check server logs.' }
    return res.status(500).json(errorBody)
  } finally {
    recordReconciliation({ req, route: '/images', requestId, providerDelivered, resultCount, txHash })
  }
})

// ─── GET /news ────────────────────────────────────────────────────────────
app.get('/news', async (req: Request, res: Response) => {
  const requestId = randomUUID()
  let providerDelivered = false
  let resultCount = 0
  let txHash: string | null = null

  try {
    const { q, count = '10', freshness } = req.query as Record<string, string>

    const v = validateQuery(q)
    if (!v.ok) {
      const errorBody: ApiErrorResponse = { error: v.error }
      return res.status(400).json(errorBody)
    }
    const cleanQ = v.cleanQ

    const t0 = Date.now()

    const requestBody: Record<string, unknown> = {
      q: cleanQ,
      num: Math.min(parseInt(count) || 10, 20),
    }

    if (freshness) {
      const dateFilters: Record<string, string> = {
        'pd': 'qdr:d',
        'pw': 'qdr:w',
        'pm': 'qdr:m',
      }
      if (dateFilters[freshness]) {
        requestBody.tbs = dateFilters[freshness]
      }
    }

    const serperRes = await fetch('https://google.serper.dev/news', {
      method: 'POST',
      headers: {
        'X-API-KEY': SERPER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    if (!serperRes.ok) {
      const err = await serperRes.text()
      console.error('[serper news]', serperRes.status, err)
      const errorBody: ApiErrorResponse = { error: `Serper.dev API error: ${serperRes.status}` }
      return res.status(502).json(errorBody)
    }

    const data: unknown = await serperRes.json()
    const latencyMs = Date.now() - t0

    stats.totalQueries++
    stats.totalUsdcSettled += parseFloat(AMOUNT_USDC)
    stats.latencies.push(latencyMs)
    if (stats.latencies.length > 200) stats.latencies.shift()

    const results = normalizeNewsResults(data)

    txHash = (req.headers['x-payment-response'] as string) || null

    const responseBody: NewsSearchResponse = {
      query: cleanQ,
      results,
      count: results.length,
      network: NETWORK,
      paidAmount: AMOUNT_USDC,
      currency: 'USDC',
      txHash,
      latencyMs,
    }

    providerDelivered = true
    resultCount = results.length
    return res.json(responseBody)
  } catch (err: any) {
    console.error('[news error]', err.message)
    const errorBody: ApiErrorResponse = { error: 'News search failed. Check server logs.' }
    return res.status(500).json(errorBody)
  } finally {
    recordReconciliation({ req, route: '/news', requestId, providerDelivered, resultCount, txHash })
  }
})

// ─── POST /search/batch — JSON Lines streaming (issue #325) ───────────────
// Bounded batch endpoint: versioned JSONL events (quote, settlement, result, error, done)
// Handles idempotency, aggregate spending limits, disconnect abort, partial completion.
app.post('/search/batch', async (req: Request, res: Response) => {
  const requestId = crypto.randomUUID()
  const tBatchStart = Date.now()

  // Idempotency: header or body key, valid for 24h
  const idempotencyKey = (req.headers['idempotency-key'] as string) || (req.body as any)?.idempotencyKey
  if (idempotencyKey) {
    cleanupBatchIdempotency()
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

  const paymentHeader = (req.headers['payment-signature'] || req.headers['x-payment'] || req.headers['X-PAYMENT'] || req.headers['x-payment-response'] || req.headers['authorization']) as string | undefined
  if (!paymentHeader) {
    res.setHeader('PAYMENT-REQUIRED', Buffer.from(JSON.stringify({
      x402Version: 2,
      error: 'Payment required for batch',
      resource: { url: `${req.protocol}://${req.get('host')}${req.originalUrl}`, description: `Batch search ${cleanQueries.length} x ${AMOUNT_USDC} USDC`, mimeType: 'application/x-ndjson' },
      accepts: [{ scheme: 'exact', network: NETWORK, amount: String(parseInt(AMOUNT_STROOPS) * cleanQueries.length), asset: USDC_CONTRACT, payTo: RECEIVING_ADDRESS, maxTimeoutSeconds: 300, extra: { areFeesSponsored: true } }],
    })).toString('base64'))
    return res.status(402).json({ error: 'Payment required' })
  }

  const consumption = consumePaymentPayload(paymentHeader)
  if (!consumption.ok) {
    return res.status(402).json({ error: consumption.error })
  }
  const paymentId = consumption.paymentId
  const verified = true
  let txHash: string | null = (req.headers['x-payment-response'] as string) || null
  try {
    const decoded = Buffer.from(paymentHeader, 'base64').toString('utf8')
    const parsed = JSON.parse(decoded)
    txHash = parsed.transactionHash || parsed.txHash || txHash
  } catch {
    // ignore header parse error
  }

  if (idempotencyKey) {
    batchIdempotencyStore.set(idempotencyKey, { requestId, expiresAt: Date.now() + 24 * 3600 * 1000 })
  }

  // Prepare JSONL streaming response
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.setHeader('X-Request-Id', requestId)
  res.flushHeaders?.()

  let clientAborted = false
  const abortController = new AbortController()
  req.on('close', () => {
    if (!res.writableEnded) {
      clientAborted = true
      abortController.abort()
    }
  })

  const writeEvent = (evt: BatchJsonlEvent) => {
    if (clientAborted || res.writableEnded) return false
    try {
      res.write(JSON.stringify(evt) + '\n')
      return true
    } catch { return false }
  }

  // Emit settlement event immediately after payment verification
  const settlementEvent: BatchJsonlSettlementEvent = { v: 1, type: 'settlement', requestId, paymentId, txHash, verified, settledAt: new Date().toISOString() }
  writeEvent(settlementEvent)

  let succeeded = 0
  let failed = 0

  for (let i = 0; i < cleanQueries.length; i++) {
    if (clientAborted || abortController.signal.aborted) {
      const errEvt: BatchJsonlErrorEvent = { v: 1, type: 'error', requestId, index: i, query: cleanQueries[i], error: 'Client disconnected', code: 'CLIENT_DISCONNECT' }
      writeEvent(errEvt)
      failed++
      // remaining items marked skipped
      for (let j = i + 1; j < cleanQueries.length; j++) {
        const skipEvt: BatchJsonlErrorEvent = { v: 1, type: 'error', requestId, index: j, query: cleanQueries[j], error: 'Skipped due to client disconnect', code: 'SKIPPED' }
        writeEvent(skipEvt)
        failed++
      }
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
        signal: abortController.signal as any,
      })
      if (!serperRes.ok) {
        const errText = await serperRes.text().catch(() => '')
        console.error('[serper batch]', serperRes.status, errText)
        const evt: BatchJsonlErrorEvent = { v: 1, type: 'error', requestId, index: i, query: q, error: `Serper.dev API error: ${serperRes.status}`, code: 'UPSTREAM_ERROR' }
        writeEvent(evt)
        failed++
        continue
      }
      const data: unknown = await serperRes.json()
      const latencyMs = Date.now() - t0
      stats.totalQueries++
      stats.totalUsdcSettled += parseFloat(AMOUNT_USDC)
      stats.latencies.push(latencyMs)
      if (stats.latencies.length > 200) stats.latencies.shift()
      const results = normalizeOrganicResults(data)
      const queryMeta = normalizeQueryMetadata(data, q)
      addRecentReceipt({ id: txHash || `${requestId}-${i}`, query: queryMeta.originalQuery, txHash, amount: AMOUNT_USDC, currency: 'USDC', network: NETWORK, timestamp: new Date().toISOString(), latencyMs, count: results.length })
      const evt: BatchJsonlResultEvent = {
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
      }
      writeEvent(evt)
      succeeded++
    } catch (err: any) {
      if (err?.name === 'AbortError' || abortController.signal.aborted) {
        const evt: BatchJsonlErrorEvent = { v: 1, type: 'error', requestId, index: i, query: q, error: 'Aborted due to client disconnect', code: 'ABORTED' }
        writeEvent(evt)
        failed++
        // mark remaining as skipped
        for (let j = i + 1; j < cleanQueries.length; j++) {
          const skip: BatchJsonlErrorEvent = { v: 1, type: 'error', requestId, index: j, query: cleanQueries[j], error: 'Skipped due to abort', code: 'SKIPPED' }
          writeEvent(skip); failed++
        }
        break
      }
      const evt: BatchJsonlErrorEvent = { v: 1, type: 'error', requestId, index: i, query: q, error: err.message || 'Search failed', code: 'SEARCH_FAILED' }
      writeEvent(evt)
      failed++
    }
  }

  const doneEvent: BatchJsonlDoneEvent = {
    v: 1, type: 'done', requestId, succeeded, failed,
    totalUsdcSpent: (succeeded * parseFloat(AMOUNT_USDC)).toFixed(3),
    aggregateLatencyMs: Date.now() - tBatchStart,
    completedAt: new Date().toISOString(),
  }
  if (!clientAborted) writeEvent(doneEvent)
  res.end()
})

// ─── Async paid search jobs with webhooks (issue #324) ─────────────────
app.post('/jobs', async (req: Request, res: Response) => {
  cleanupBatchIdempotency()
  const idempotencyKey = (req.headers['idempotency-key'] as string) || (req.body as any)?.idempotencyKey
  if (idempotencyKey) {
    const existing = jobIdempotencyStore.get(idempotencyKey)
    if (existing && existing.expiresAt > Date.now()) {
      const existingJob = jobStore.get(existing.jobId)
      if (existingJob) {
        return res.status(200).json({ jobId: existingJob.id, statusUrl: existingJob.statusUrl, paymentVerified: existingJob.verified, job: existingJob })
      }
    }
  }

  const { query, count = '5', freshness, webhookUrl, webhookSecret } = (req.body || {}) as { query?: unknown; count?: unknown; freshness?: string; webhookUrl?: string; webhookSecret?: string }

  const v = validateQuery(query)
  if (!v.ok) return res.status(400).json({ error: v.error })
  const cleanQ = v.cleanQ
  const safeCount = Math.min(Math.max(parseInt(String(count)) || 5, 1), 20)

  // Webhook validation (SSRF + https)
  if (webhookUrl) {
    const chk = validateWebhookUrl(webhookUrl)
    if (!chk.ok) return res.status(400).json({ error: chk.error })
    if (!webhookSecret || webhookSecret.length < 16) return res.status(400).json({ error: 'webhookSecret required (min 16 chars) when webhookUrl is set' })
  }

  // Payment verification via x402 header
  const paymentHeader = (req.headers['payment-signature'] || req.headers['x-payment'] || req.headers['X-PAYMENT'] || req.headers['x-payment-response'] || req.headers['authorization']) as string | undefined
  if (!paymentHeader) {
    // Return 402 with payment requirements and statusUrl hint
    const paymentRequired = {
      x402Version: 2,
      error: 'Payment required for async job',
      resource: { url: `${req.protocol}://${req.get('host')}${req.originalUrl}`, description: `Async search job: ${AMOUNT_USDC} USDC on Stellar`, mimeType: 'application/json' },
      accepts: [{ scheme: 'exact', network: NETWORK, amount: AMOUNT_STROOPS, asset: USDC_CONTRACT, payTo: RECEIVING_ADDRESS, maxTimeoutSeconds: 300, extra: { areFeesSponsored: true } }],
    }
    res.setHeader('PAYMENT-REQUIRED', Buffer.from(JSON.stringify(paymentRequired)).toString('base64'))
    return res.status(402).json({ error: 'Payment required', hint: 'Retry with X-Payment header containing signed Soroban auth' })
  }
  const consumption = consumePaymentPayload(paymentHeader)
  if (!consumption.ok) return res.status(402).json({ error: consumption.error })
  const paymentId = consumption.paymentId
  const verified = true
  let txHash: string | null = (req.headers['x-payment-response'] as string) || null
  try {
    const decoded = Buffer.from(paymentHeader, 'base64').toString('utf8')
    const parsed = JSON.parse(decoded)
    txHash = parsed.transactionHash || parsed.txHash || txHash
  } catch {
    // ignore parse error
  }

  const jobId = crypto.randomUUID()
  const now = new Date().toISOString()
  const statusUrl = `${req.protocol}://${req.get('host')}/jobs/${jobId}`

  const job: SearchJob = {
    id: jobId,
    query: cleanQ,
    count: safeCount,
    freshness,
    status: 'running' as JobStatus,
    createdAt: now,
    updatedAt: now,
    paymentId,
    txHash,
    verified,
    paidAmount: AMOUNT_USDC,
    currency: 'USDC',
    network: NETWORK,
    webhookUrl,
    webhookSecret,
    idempotencyKey,
    attempts: 0,
    statusUrl,
  }
  jobStore.set(jobId, job)
  if (idempotencyKey) jobIdempotencyStore.set(idempotencyKey, { jobId, expiresAt: Date.now() + 24 * 3600 * 1000 })

  // Immediate 202 response with statusUrl + verified payment state
  res.status(202).json({ jobId, statusUrl, paymentVerified: verified, paymentId, txHash, status: job.status })

  // Fire-and-forget execution (preserves verified x402 settlement, does not block 202)
  ;(async () => {
    const t0 = Date.now()
    try {
      const requestBody: Record<string, unknown> = { q: cleanQ, num: safeCount }
      if (freshness) {
        const dateFilters: Record<string, string> = { 'pd': 'qdr:d', 'pw': 'qdr:w', 'pm': 'qdr:m' }
        if (dateFilters[freshness]) requestBody.tbs = dateFilters[freshness]
      }
      const serperRes = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })
      if (!serperRes.ok) {
        const errText = await serperRes.text().catch(() => '')
        throw new Error(`Serper.dev API error: ${serperRes.status} ${errText}`)
      }
      const data: unknown = await serperRes.json()
      const latencyMs = Date.now() - t0
      stats.totalQueries++
      stats.totalUsdcSettled += parseFloat(AMOUNT_USDC)
      stats.latencies.push(latencyMs)
      if (stats.latencies.length > 200) stats.latencies.shift()
      const results = normalizeOrganicResults(data)
      const queryMeta = normalizeQueryMetadata(data, cleanQ)
      addRecentReceipt({ id: txHash || jobId, query: queryMeta.originalQuery, txHash, amount: AMOUNT_USDC, currency: 'USDC', network: NETWORK, timestamp: new Date().toISOString(), latencyMs, count: results.length })
      const responseBody: SearchResponse = {
        query: queryMeta.executedQuery,
        originalQuery: queryMeta.originalQuery,
        executedQuery: queryMeta.executedQuery,
        suggestedQuery: queryMeta.suggestedQuery,
        isCorrected: queryMeta.isCorrected,
        results,
        count: results.length,
        network: NETWORK,
        paidAmount: AMOUNT_USDC,
        currency: 'USDC',
        txHash,
        latencyMs,
      }
      job.result = responseBody
      job.status = 'completed'
      job.updatedAt = new Date().toISOString()
      jobStore.set(jobId, job)
    } catch (err: any) {
      job.error = err.message || 'Search failed'
      job.status = 'failed'
      job.updatedAt = new Date().toISOString()
      jobStore.set(jobId, job)
    }
    // Webhook delivery with retries, signed, replay-protected
    if (job.webhookUrl && job.webhookSecret) {
      await deliverWebhookWithRetry(job)
    }
  })()
})

app.get('/jobs/:id', (req: Request, res: Response) => {
  const job = jobStore.get(req.params.id)
  if (!job) return res.status(404).json({ error: 'Job not found' })
  return res.json({ job, paymentVerified: job.verified, statusUrl: job.statusUrl })
})

app.get('/jobs', (_req: Request, res: Response) => {
  const jobs = Array.from(jobStore.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 50)
  return res.json({ jobs, count: jobs.length })
})

// ─── GET /health ──────────────────────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  const avg = stats.latencies.length
    ? Math.round(stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length)
    : 0

  const up = Math.floor((Date.now() - stats.startTime) / 1000)
  const uptime = up < 60 ? `${up}s` : up < 3600 ? `${Math.floor(up / 60)}m` : `${Math.floor(up / 3600)}h`

  res.json({
    status:                    'ok',
    network:                   NETWORK,
    pricePerQuery:             '0.001 USDC',
    protocol:                  'x402',
    facilitator:               FACILITATOR_URL,
    totalQueries:              stats.totalQueries,
    totalUsdcSettled:          stats.totalUsdcSettled.toFixed(4),
    avgLatencyMs:              avg,
    uptime,
    serperApiConfigured:       !!SERPER_API_KEY,
    groqApiConfigured:         !!GROQ_API_KEY,
    receivingAddressConfigured: !!RECEIVING_ADDRESS,
  })
})

// ─── POST /ai/chat ────────────────────────────────────────────────────────
// Streams responses as Server-Sent Events when the client sends
// `Accept: text/event-stream`; otherwise returns the full completion as JSON
// (back-compat fallback for callers that don't support SSE).
app.post('/ai/chat', async (req: Request, res: Response) => {
  if (!groq) {
    return res.status(503).json({ error: 'AI assistant is not configured.' })
  }
  const { messages, model: requestedModel } = req.body as {
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
    model?: string
  }

  if (!messages?.length) {
    return res.status(400).json({ error: 'messages array required' })
  }

  // Available models whitelist
  const AVAILABLE_MODELS = [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'mixtral-8x7b-32768',
  ]
  
  // Use requested model if valid, otherwise fall back to default
  const model = requestedModel && AVAILABLE_MODELS.includes(requestedModel)
    ? requestedModel
    : 'llama-3.3-70b-versatile'

  const wantsStream =
    (req.headers.accept || '').includes('text/event-stream') ||
    (req.body as any)?.stream === true ||
    req.query.stream === '1'

  const groqMessages = [
    {
      role: 'system' as const,
      content:
        'You are StellarSearch AI, a concise research assistant. Help users craft better search queries and understand results. Keep responses under 200 words.',
    },
    ...messages,
  ]

  if (!wantsStream) {
    try {
      const completion = await groq.chat.completions.create({
        model,
        messages: groqMessages,
        max_tokens:  512,
        temperature: 0.7,
      })

      const content = completion.choices[0]?.message?.content || 'No response.'
      return res.json({ content, model: completion.model })
    } catch (err: any) {
      console.error('[groq error]', err.message)
      return res.status(500).json({ error: `Groq AI error: ${err.message}` })
    }
  }

  // SSE path
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  // Disable proxy buffering (e.g. nginx) so chunks flush immediately
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()

  const sendEvent = (event: string, data: Record<string, unknown>) => {
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  // Abort the Groq stream if the client disconnects mid-response.
  const controller = new AbortController()
  req.on('close', () => controller.abort())

  try {
    const stream = await groq.chat.completions.create(
      {
        model,
        messages: groqMessages,
        max_tokens:  512,
        temperature: 0.7,
        stream: true,
      },
      { signal: controller.signal },
    )

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content
      if (delta) sendEvent('delta', { content: delta })
    }
    sendEvent('done', { model })
    res.end()
  } catch (err: any) {
    if (controller.signal.aborted) return res.end()
    console.error('[groq stream error]', err.message)
    sendEvent('error', { error: `Groq AI error: ${err.message}` })
    res.end()
  }
})




// ─── GET / ────────────────────────────────────────────────────────────────
app.get('/', (_req: Request, res: Response) => {
  res.json({
    name:        'StellarSearch',
    version:     '1.0.0',
    description: 'Pay-per-query web search for AI agents via x402 on Stellar',
    endpoints: {
      'GET /search?q=<query>': '0.001 USDC via x402',
      'GET /images?q=<query>': '0.001 USDC via x402 — image results',
      'GET /news?q=<query>':   '0.001 USDC via x402 — news articles',
      'POST /search/batch':    '0.001 USDC per query (max 10), JSONL streaming — versioned quote/settlement/result/error/done events, idempotency & aggregate limits',
      'POST /jobs':            '0.001 USDC via x402 — async job, returns 202 + statusUrl + verified payment state',
      'GET /jobs/:id':         'Job status + verified payment state (webhook signed, replay/SSRF protected)',
      'GET /jobs':             'List recent jobs (capped at 50)',
      'POST /ai/chat':         'Groq AI — free',
      'GET /health':           'Live server stats',
    },
    mcp: {
      resources: ['stellar-search://capabilities', 'stellar-search://schema/search', 'stellar-search://receipts/recent (opted-in)'],
      prompts: ['research_brief (no silent payment)', 'summarize_results', 'compare_sources'],
      progress: 'notifications/progress bounded to 4 phases (challenge→signing→settlement→search), cancellation/error terminates cleanly without false completion',
    },
  })
})

// ─── Start ────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`\n🚀 StellarSearch on http://localhost:${PORT}`)
    console.log(`   Network:     ${NETWORK}`)
    console.log(`   Facilitator: ${FACILITATOR_URL}`)
    console.log(`   Serper:      ${SERPER_API_KEY ? '✓' : '✗ MISSING'}`)
    console.log(`   Groq:        ${GROQ_API_KEY  ? '✓' : '✗ MISSING'}`)
    console.log(`   Receiving:   ${RECEIVING_ADDRESS || '✗ MISSING'}`)
    console.log(`   ${getCorsStartupMessage()}\n`)
  })
}

export default app
