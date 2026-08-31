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
import logger from './logger.js'
import { getReadiness } from './readiness.js'
import { recordTiming, getMetrics, getAvgLatencyMs } from './metrics.js'
import { TIMING_PHASES } from '../src/lib/timing.js'
import {
  STELLAR_NETWORK,
  HORIZON_URL, 
  AMOUNT_USDC, 
  AMOUNT_STROOPS 
} from '../src/lib/constants.js'

dotenv.config()

const app  = express()
const PORT = process.env.PORT || 3001
const RATE_LIMIT_PER_MINUTE = parseInt(process.env.RATE_LIMIT_PER_MINUTE || '30', 10)

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
// Latencies are now tracked via bounded metrics (circular buffers) in server/metrics.ts
// to avoid unbounded in-memory arrays and to expose p50/p95/p99 per phase.
const stats = {
  totalQueries: 0,
  totalUsdcSettled: 0,
  startTime: Date.now(),
}

// ─── Config ───────────────────────────────────────────────────────────────
const RECEIVING_ADDRESS = process.env.STELLAR_RECEIVING_ADDRESS!
const FACILITATOR_URL   = process.env.FACILITATOR_URL   || 'https://www.x402.org/facilitator'
const NETWORK           = STELLAR_NETWORK as 'stellar:testnet' | 'stellar:mainnet'
const SERPER_API_KEY    = process.env.SERPER_API_KEY!
const GROQ_API_KEY      = process.env.GROQ_API_KEY!

if (!RECEIVING_ADDRESS) console.warn('⚠  STELLAR_RECEIVING_ADDRESS not set')
if (!SERPER_API_KEY)    console.warn('⚠  SERPER_API_KEY not set')
if (!GROQ_API_KEY)      console.warn('⚠  GROQ_API_KEY not set')

// ─── Groq ─────────────────────────────────────────────────────────────────
const groq = new Groq({ apiKey: GROQ_API_KEY })

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
}

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL })
const schemes = [{ network: NETWORK, server: new ExactStellarScheme() }]

// Apply middleware to all routes, not just /search

// ─── Payment Logging Middleware (redacted) ─────────────────────────────────
// Logger's redactor ensures query / payment headers are not persisted raw.
app.use((req, res, next) => {
  if (req.path === '/search' || req.path === '/images' || req.path === '/news') {
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
        path: req.path,
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
    }
  }
  next()
})

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
  const tTotal0 = Date.now()
  const tVal0 = Date.now()
  const v = validateQuery((req.query as Record<string, string>).q)
  const valMs = Date.now() - tVal0
  recordTiming(TIMING_PHASES.VALIDATION, valMs, v.ok ? 'success' : 'error')
  if (!v.ok) {
    recordTiming(TIMING_PHASES.TOTAL, Date.now() - tTotal0, 'error')
    return res.status(400).json({ error: v.error })
  }
  const cleanQ = v.cleanQ
  const { count = '5', freshness } = req.query as Record<string, string>

  try {
    const requestBody: any = {
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

    const tSerper0 = Date.now()
    const serperRes = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': SERPER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })
    const serperMs = Date.now() - tSerper0

    if (!serperRes.ok) {
      const err = await serperRes.text()
      logger.warn('serper error', { status: serperRes.status, error: err.slice(0, 500) })
      recordTiming(TIMING_PHASES.SERPER, serperMs, 'error')
      recordTiming(TIMING_PHASES.TOTAL, Date.now() - tTotal0, 'error')
      return res.status(502).json({ error: `Serper.dev API error: ${serperRes.status}` })
    }

    recordTiming(TIMING_PHASES.SERPER, serperMs, 'success')

    const data = await serperRes.json()
    const latencyMs = Date.now() - tTotal0

    stats.totalQueries++
    stats.totalUsdcSettled += 0.001
    // latencyMs is total so far (without suggestions); suggestions timing is separate phase
    const results = (data.organic || []).map((r: any, i: number) => ({
      id: String(i + 1),
      title: r.title || 'No title',
      url: r.link,
      description: r.snippet || '',
      source: (() => { try { return new URL(r.link).hostname.replace('www.', '') } catch { return r.link } })(),
      relevanceScore: Math.max(0.5, 1 - i * 0.06),
      publishedAt: r.date || undefined,
    }))

    // The real tx hash comes from the X-PAYMENT-RESPONSE header set by the facilitator
    const txHash = (req.headers['x-payment-response'] as string) || null

    // ── Optional AI suggestions via Groq ──────────────────────────────────
    let suggestions: string[] = []
    let suggMs: number | null = null
    if (req.query.suggestions === '1' && results.length > 0) {
      const tSugg0 = Date.now()
      try {
        const topSnippets = results.slice(0, 3).map((r: any) => r.description).join(' | ')
        const suggCompletion = await groq.chat.completions.create({
          model: 'llama-3.3-70b-versatile',
          messages: [
            {
              role: 'system',
              content: 'You are a search assistant. Given a query and top result snippets, return exactly 3 related search queries the user might want to explore next. Output only a JSON array of 3 strings, no explanation.',
            },
            {
              role: 'user',
              content: `Query: "${cleanQ}"\nTop results: ${topSnippets}`,
            },
          ],
          max_tokens: 120,
          temperature: 0.7,
        })
        const raw = suggCompletion.choices[0]?.message?.content || '[]'
        const match = raw.match(/\[[\s\S]*\]/)
        if (match) suggestions = JSON.parse(match[0]).slice(0, 3)
        suggMs = Date.now() - tSugg0
        recordTiming(TIMING_PHASES.GROQ_SUGGESTIONS, suggMs, 'success')
      } catch (err: any) {
        suggMs = Date.now() - tSugg0
        recordTiming(TIMING_PHASES.GROQ_SUGGESTIONS, suggMs, 'error')
        logger.warn('suggestions Groq error', { error: err.message })
      }
    }

    const totalMs = Date.now() - tTotal0
    recordTiming(TIMING_PHASES.TOTAL, totalMs, 'success')

    return res.json({
      query: cleanQ,
      results,
      count: results.length,
      network: NETWORK,
      paidAmount: AMOUNT_USDC,
      currency: 'USDC',
      txHash,
      latencyMs: totalMs,
      // Phase timings with shared vocabulary — explains end-to-end performance
      timings: {
        validationMs: valMs,
        serperMs,
        suggestionsMs: suggMs,
        totalMs,
      },
      suggestions,
    })
  } catch (err: any) {
    recordTiming(TIMING_PHASES.TOTAL, Date.now() - tTotal0, 'error')
    logger.error('search error', { error: err.message })
    return res.status(500).json({ error: 'Search failed. Check server logs.' })
  }
})

// ─── GET /images ──────────────────────────────────────────────────────────
app.get('/images', async (req: Request, res: Response) => {
  const tTotal0 = Date.now()
  const tVal0 = Date.now()
  const v = validateQuery((req.query as Record<string, string>).q)
  const valMs = Date.now() - tVal0
  recordTiming(TIMING_PHASES.VALIDATION, valMs, v.ok ? 'success' : 'error')
  if (!v.ok) {
    recordTiming(TIMING_PHASES.TOTAL, Date.now() - tTotal0, 'error')
    return res.status(400).json({ error: v.error })
  }
  const cleanQ = v.cleanQ
  const { count = '10' } = req.query as Record<string, string>

  try {
    const tSerper0 = Date.now()
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
    const serperMs = Date.now() - tSerper0

    if (!serperRes.ok) {
      const err = await serperRes.text()
      logger.warn('serper images error', { status: serperRes.status, error: err.slice(0, 500) })
      recordTiming(TIMING_PHASES.SERPER, serperMs, 'error')
      recordTiming(TIMING_PHASES.TOTAL, Date.now() - tTotal0, 'error')
      return res.status(502).json({ error: `Serper.dev API error: ${serperRes.status}` })
    }

    recordTiming(TIMING_PHASES.SERPER, serperMs, 'success')

    const data = await serperRes.json()

    stats.totalQueries++
    stats.totalUsdcSettled += parseFloat(AMOUNT_USDC)

    const results = (data.images || []).map((r: any, i: number) => ({
      id: String(i + 1),
      title: r.title || 'No title',
      imageUrl: r.imageUrl,
      thumbnailUrl: r.thumbnailUrl || r.imageUrl,
      sourceUrl: r.link,
      source: (() => { try { return new URL(r.link).hostname.replace('www.', '') } catch { return r.link } })(),
      width: r.imageWidth,
      height: r.imageHeight,
    }))

    const txHash = (req.headers['x-payment-response'] as string) || null
    const totalMs = Date.now() - tTotal0
    recordTiming(TIMING_PHASES.TOTAL, totalMs, 'success')

    return res.json({
      query: cleanQ,
      results,
      count: results.length,
      network: NETWORK,
      paidAmount: AMOUNT_USDC,
      currency: 'USDC',
      txHash,
      latencyMs: totalMs,
      timings: { validationMs: valMs, serperMs, totalMs },
    })
  } catch (err: any) {
    recordTiming(TIMING_PHASES.TOTAL, Date.now() - tTotal0, 'error')
    logger.error('images error', { error: err.message })
    return res.status(500).json({ error: 'Image search failed. Check server logs.' })
  }
})

// ─── GET /news ────────────────────────────────────────────────────────────
app.get('/news', async (req: Request, res: Response) => {
  const tTotal0 = Date.now()
  const tVal0 = Date.now()
  const v = validateQuery((req.query as Record<string, string>).q)
  const valMs = Date.now() - tVal0
  recordTiming(TIMING_PHASES.VALIDATION, valMs, v.ok ? 'success' : 'error')
  if (!v.ok) {
    recordTiming(TIMING_PHASES.TOTAL, Date.now() - tTotal0, 'error')
    return res.status(400).json({ error: v.error })
  }
  const cleanQ = v.cleanQ
  const { count = '10', freshness } = req.query as Record<string, string>

  try {
    const requestBody: any = {
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

    const tSerper0 = Date.now()
    const serperRes = await fetch('https://google.serper.dev/news', {
      method: 'POST',
      headers: {
        'X-API-KEY': SERPER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })
    const serperMs = Date.now() - tSerper0

    if (!serperRes.ok) {
      const err = await serperRes.text()
      logger.warn('serper news error', { status: serperRes.status, error: err.slice(0, 500) })
      recordTiming(TIMING_PHASES.SERPER, serperMs, 'error')
      recordTiming(TIMING_PHASES.TOTAL, Date.now() - tTotal0, 'error')
      return res.status(502).json({ error: `Serper.dev API error: ${serperRes.status}` })
    }

    recordTiming(TIMING_PHASES.SERPER, serperMs, 'success')

    const data = await serperRes.json()

    stats.totalQueries++
    stats.totalUsdcSettled += parseFloat(AMOUNT_USDC)

    const results = (data.news || []).map((r: any, i: number) => ({
      id: String(i + 1),
      title: r.title || 'No title',
      url: r.link,
      snippet: r.snippet || '',
      source: r.source || (() => { try { return new URL(r.link).hostname.replace('www.', '') } catch { return r.link } })(),
      publishedAt: r.date || undefined,
      imageUrl: r.imageUrl || undefined,
    }))

    const txHash = (req.headers['x-payment-response'] as string) || null
    const totalMs = Date.now() - tTotal0
    recordTiming(TIMING_PHASES.TOTAL, totalMs, 'success')

    return res.json({
      query: cleanQ,
      results,
      count: results.length,
      network: NETWORK,
      paidAmount: AMOUNT_USDC,
      currency: 'USDC',
      txHash,
      latencyMs: totalMs,
      timings: { validationMs: valMs, serperMs, totalMs },
    })
  } catch (err: any) {
    recordTiming(TIMING_PHASES.TOTAL, Date.now() - tTotal0, 'error')
    logger.error('news error', { error: err.message })
    return res.status(500).json({ error: 'News search failed. Check server logs.' })
  }
})

// ─── POST /ai/chat ────────────────────────────────────────────────────────
// Streams responses as Server-Sent Events when the client sends
// `Accept: text/event-stream`; otherwise returns the full completion as JSON
// Supports model selection via { model } whitelist. Records phase timings with shared vocabulary.
app.post('/ai/chat', async (req: Request, res: Response) => {
  const tTotal0 = Date.now()
  const AVAILABLE_MODELS = [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'mixtral-8x7b-32768',
  ]
  const { messages, model: requestedModel } = req.body as {
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
    model?: string
  }

  if (!messages?.length) {
    recordTiming(TIMING_PHASES.TOTAL, Date.now() - tTotal0, 'error')
    return res.status(400).json({ error: 'messages array required' })
  }

  const model = requestedModel && AVAILABLE_MODELS.includes(requestedModel)
    ? requestedModel
    : 'llama-3.3-70b-versatile'

  const wantsStream =
    (req.headers.accept || '').includes('text/event-stream') ||
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
    const tGroq0 = Date.now()
    try {
      const completion = await groq.chat.completions.create({
        model,
        messages: groqMessages,
        max_tokens:  512,
        temperature: 0.7,
      })
      recordTiming(TIMING_PHASES.GROQ, Date.now() - tGroq0, 'success')
      recordTiming(TIMING_PHASES.AI_CHAT, Date.now() - tTotal0, 'success')
      recordTiming(TIMING_PHASES.TOTAL, Date.now() - tTotal0, 'success')
      const content = completion.choices[0]?.message?.content || 'No response.'
      return res.json({ content, model: completion.model, timings: { groqMs: Date.now() - tGroq0, totalMs: Date.now() - tTotal0 } })
    } catch (err: any) {
      recordTiming(TIMING_PHASES.GROQ, Date.now() - tGroq0, 'error')
      recordTiming(TIMING_PHASES.AI_CHAT, Date.now() - tTotal0, 'error')
      recordTiming(TIMING_PHASES.TOTAL, Date.now() - tTotal0, 'error')
      logger.error('groq error', { error: err.message })
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

  const tGroq0 = Date.now()
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
    recordTiming(TIMING_PHASES.GROQ, Date.now() - tGroq0, 'success')
    recordTiming(TIMING_PHASES.AI_CHAT, Date.now() - tTotal0, 'success')
    recordTiming(TIMING_PHASES.TOTAL, Date.now() - tTotal0, 'success')
    sendEvent('done', { model })
    res.end()
  } catch (err: any) {
    if (controller.signal.aborted) {
      recordTiming(TIMING_PHASES.GROQ, Date.now() - tGroq0, 'error')
      return res.end()
    }
    recordTiming(TIMING_PHASES.GROQ, Date.now() - tGroq0, 'error')
    recordTiming(TIMING_PHASES.AI_CHAT, Date.now() - tTotal0, 'error')
    recordTiming(TIMING_PHASES.TOTAL, Date.now() - tTotal0, 'error')
    logger.error('groq stream error', { error: err.message })
    sendEvent('error', { error: `Groq AI error: ${err.message}` })
    res.end()
  }
})

// ─── GET /health & /ready ───────────────────────────────────────────────
// Health now performs cached, low-cost dependency checks with strict timeouts
// and distinguishes configured / reachable / degraded / unavailable via the
// shared readiness module. Metrics expose percentiles without unbounded arrays.
async function healthHandler(_req: Request, res: Response) {
  const up = Math.floor((Date.now() - stats.startTime) / 1000)
  const uptime = up < 60 ? `${up}s` : up < 3600 ? `${Math.floor(up / 60)}m` : `${Math.floor(up / 3600)}h`
  const metrics = getMetrics()
  const avg = getAvgLatencyMs()

  let readiness
  try {
    readiness = await getReadiness()
  } catch (err: any) {
    logger.warn('readiness failed', { error: err.message })
    readiness = {
      status: 'degraded' as const,
      checks: {},
      cached: false,
      cacheAgeMs: 0,
      timestamp: new Date().toISOString(),
    }
  }

  // Overall status is readiness status unless no checks (fallback to ok)
  const status = (readiness.status === 'unavailable' ? 'unavailable' : readiness.status === 'degraded' ? 'degraded' : 'ok') as string

  const latency = metrics.total ? {
    avgMs: avg,
    p50Ms: metrics.total.p50Ms,
    p95Ms: metrics.total.p95Ms,
    p99Ms: metrics.total.p99Ms,
    samples: metrics.phases['total']?.count ?? 0,
  } : {
    avgMs: avg,
    p50Ms: null,
    p95Ms: null,
    p99Ms: null,
    samples: 0,
  }

  res.json({
    status,
    network: NETWORK,
    pricePerQuery: '0.001 USDC',
    protocol: 'x402',
    facilitator: FACILITATOR_URL,
    totalQueries: stats.totalQueries,
    totalUsdcSettled: stats.totalUsdcSettled.toFixed(4),
    // deprecated but preserved for compatibility
    avgLatencyMs: avg,
    latency,
    // per-phase percentiles (bounded circular buffers)
    timings: metrics.phases,
    uptime,
    // legacy booleans preserved for compatibility
    serperApiConfigured: !!SERPER_API_KEY,
    groqApiConfigured: !!GROQ_API_KEY,
    receivingAddressConfigured: !!RECEIVING_ADDRESS,
    // new detailed checks
    checks: readiness.checks,
    readiness: {
      cached: readiness.cached,
      cacheAgeMs: readiness.cacheAgeMs,
      timestamp: readiness.timestamp,
    },
  })
}

app.get('/health', healthHandler)
app.get('/ready', healthHandler)
app.get('/metrics', (_req: Request, res: Response) => {
  res.json(getMetrics())
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
      'POST /ai/chat':         'Groq AI — free',
      'GET /health':           'Live server stats',
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
