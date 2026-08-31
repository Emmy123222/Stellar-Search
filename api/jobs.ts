import type { VercelRequest, VercelResponse } from '@vercel/node'
import { STELLAR_NETWORK, USDC_CONTRACT, AMOUNT_STROOPS, AMOUNT_USDC } from '../src/lib/constants'
import { consumePaymentPayload } from '../src/lib/paymentIntegrity'
import { normalizeOrganicResults } from '../src/lib/serperNormalizer'
import crypto from 'crypto'

const RECEIVING_ADDRESS = process.env.STELLAR_RECEIVING_ADDRESS!
const NETWORK = STELLAR_NETWORK as 'stellar:testnet' | 'stellar:mainnet'
const SERPER_API_KEY = process.env.SERPER_API_KEY!
const WEBHOOK_RETRY_BASE_MS = 1000
const MAX_JOB_WEBHOOK_ATTEMPTS = 5

// In-memory stores for serverless (per-instance, best-effort)
export const jobStore = new Map<string, any>()
export const jobIdempotencyStore = new Map<string, { jobId: string; expiresAt: number }>()

function validateQuery(q: unknown): { ok: true; cleanQ: string } | { ok: false; error: string } {
  if (typeof q !== 'string' || !q.trim()) return { ok: false, error: 'Missing required parameter: q' }
  if (q.length > 256) return { ok: false, error: `Query too long. Maximum 256 characters.` }
  const cleanQ = q.replace(/[\x00-\x1F\x7F]/g, '').trim()
  if (!cleanQ) return { ok: false, error: 'Query contains no valid characters.' }
  return { ok: true, cleanQ }
}

function isPrivateIp(hostname: string): boolean {
  const blocked = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'])
  if (blocked.has(hostname.toLowerCase())) return true
  if (/^10\.\d+\.\d+\.\d+$/.test(hostname)) return true
  if (/^192\.168\.\d+\.\d+$/.test(hostname)) return true
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(hostname)) return true
  if (/^169\.254\.\d+\.\d+$/.test(hostname)) return true
  if (hostname.includes(':') && (/^fc/i.test(hostname) || /^fd/i.test(hostname) || /^fe80/i.test(hostname))) return true
  return false
}

export function validateWebhookUrl(urlStr: string): { ok: true } | { ok: false; error: string } {
  let parsed: URL
  try { parsed = new URL(urlStr) } catch { return { ok: false, error: 'Invalid webhook URL' } }
  if (parsed.protocol !== 'https:') return { ok: false, error: 'Webhook URL must be https' }
  if (isPrivateIp(parsed.hostname)) return { ok: false, error: 'Webhook URL points to private or blocked host (SSRF protection)' }
  if (parsed.username || parsed.password) return { ok: false, error: 'Webhook URL must not contain credentials' }
  return { ok: true }
}

export function signWebhookPayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex')
}

async function deliverWebhookWithRetry(job: any, maxAttempts = MAX_JOB_WEBHOOK_ATTEMPTS): Promise<void> {
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
      if (res.status >= 400 && res.status < 500 && res.status !== 429) return
    } catch {}
    if (attempt < maxAttempts) {
      const backoff = WEBHOOK_RETRY_BASE_MS * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 200)
      await new Promise((r) => setTimeout(r, backoff))
    }
  }
}

function cleanupIdempotency(): void {
  const now = Date.now()
  for (const [k, v] of jobIdempotencyStore.entries()) if (v.expiresAt <= now) jobIdempotencyStore.delete(k)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', ['Content-Type', 'Authorization', 'X-Payment', 'payment-signature', 'x-payment', 'X-PAYMENT', 'Idempotency-Key', 'idempotency-key'].join(', '))
  res.setHeader('Access-Control-Expose-Headers', ['PAYMENT-REQUIRED', 'X-Payment-Response'].join(', '))

  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method === 'GET') {
    const jobs = Array.from(jobStore.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 50)
    return res.json({ jobs, count: jobs.length })
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  cleanupIdempotency()
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

  const { query, count = '5', freshness, webhookUrl, webhookSecret } = (req.body || {}) as any

  const v = validateQuery(query)
  if (!v.ok) return res.status(400).json({ error: v.error })
  const cleanQ = v.cleanQ
  const safeCount = Math.min(Math.max(parseInt(String(count)) || 5, 1), 20)

  if (webhookUrl) {
    const chk = validateWebhookUrl(webhookUrl)
    if (!chk.ok) return res.status(400).json({ error: chk.error })
    if (!webhookSecret || webhookSecret.length < 16) return res.status(400).json({ error: 'webhookSecret required (min 16 chars) when webhookUrl is set' })
  }

  const paymentHeader = (req.headers['payment-signature'] || req.headers['x-payment'] || req.headers['X-PAYMENT']) as string | undefined
  if (!paymentHeader) {
    const paymentRequired = {
      x402Version: 2,
      error: 'Payment required for async job',
      resource: { url: `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['host']}${req.url}`, description: `Async search job: ${AMOUNT_USDC} USDC on Stellar`, mimeType: 'application/json' },
      accepts: [{ scheme: 'exact', network: NETWORK, amount: AMOUNT_STROOPS, asset: USDC_CONTRACT, payTo: RECEIVING_ADDRESS, maxTimeoutSeconds: 300, extra: { areFeesSponsored: true } }],
    }
    res.setHeader('PAYMENT-REQUIRED', Buffer.from(JSON.stringify(paymentRequired)).toString('base64'))
    return res.status(402).json({ error: 'Payment required', hint: 'Retry with X-Payment header containing signed Soroban auth' })
  }

  const consumption = consumePaymentPayload(paymentHeader)
  if (!consumption.ok) return res.status(402).json({ error: consumption.error })
  const paymentId = consumption.paymentId
  let txHash: string | null = null
  try {
    const decoded = Buffer.from(paymentHeader as string, 'base64').toString('utf8')
    const parsed = JSON.parse(decoded)
    txHash = parsed.transactionHash || parsed.txHash || null
  } catch {}

  const jobId = crypto.randomUUID()
  const now = new Date().toISOString()
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https'
  const host = req.headers['host'] as string
  const statusUrl = `${proto}://${host}/api/jobs/${jobId}`

  const job: any = {
    id: jobId,
    query: cleanQ,
    count: safeCount,
    freshness,
    status: 'running',
    createdAt: now,
    updatedAt: now,
    paymentId,
    txHash,
    verified: true,
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

  res.status(202).json({ jobId, statusUrl, paymentVerified: true, paymentId, txHash, status: job.status })

  // async execution
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
      if (!serperRes.ok) throw new Error(`Serper.dev API error: ${serperRes.status}`)
      const data: unknown = await serperRes.json()
      const latencyMs = Date.now() - t0
      const results = normalizeOrganicResults(data)
      const responseBody = { query: cleanQ, results, count: results.length, network: NETWORK, paidAmount: AMOUNT_USDC, currency: 'USDC', txHash, latencyMs }
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
    if (job.webhookUrl && job.webhookSecret) await deliverWebhookWithRetry(job)
  })()
}
