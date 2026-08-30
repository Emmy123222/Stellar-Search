import type { VercelRequest, VercelResponse } from '@vercel/node'

// Inline readiness logic for Vercel (mirrors server/readiness.ts) to keep Express/Vercel aligned.
// We keep it lightweight to avoid cold-start bundling issues while preserving strict timeouts and caching.

type CheckStatus = 'ok' | 'degraded' | 'unavailable' | 'not_configured'

interface DependencyCheck {
  name: string
  configured: boolean
  reachable: boolean | null
  status: CheckStatus
  latencyMs: number | null
  error?: string
  lastChecked: string
}

const CACHE_TTL_MS = 30_000
const TIMEOUT_MS = 2000

let cache: { result: any; expiresAt: number; cachedAt: number } | null = null

async function timedFetch(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<{ ok: boolean; status: number; latencyMs: number }> {
  const timeoutMs = init.timeoutMs ?? TIMEOUT_MS
  const controller = new AbortController()
  const t0 = Date.now()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal } as RequestInit)
    return { ok: res.ok, status: res.status, latencyMs: Date.now() - t0 }
  } finally {
    clearTimeout(timer)
  }
}

async function checkSerper(): Promise<DependencyCheck> {
  const key = process.env.SERPER_API_KEY
  const configured = !!key
  const name = 'serper'
  const lastChecked = new Date().toISOString()
  if (!configured) return { name, configured: false, reachable: null, status: 'not_configured', latencyMs: null, error: 'SERPER_API_KEY not set', lastChecked }
  try {
    if (key.length < 16) return { name, configured: true, reachable: null, status: 'unavailable', latencyMs: null, error: 'SERPER_API_KEY format invalid', lastChecked }
    if (process.env.HEALTH_CHECK_SERPER_DEEP === 'true') {
      const t0 = Date.now()
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
      try {
        const res = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: 'healthcheck', num: 1 }),
          signal: ctrl.signal,
        })
        const latencyMs = Date.now() - t0
        if (res.ok) return { name, configured: true, reachable: true, status: 'ok', latencyMs, lastChecked }
        if (res.status === 401 || res.status === 403) return { name, configured: true, reachable: true, status: 'unavailable', latencyMs, error: `Serper auth failed (${res.status})`, lastChecked }
        return { name, configured: true, reachable: true, status: 'degraded', latencyMs, error: `Serper returned ${res.status}`, lastChecked }
      } finally { clearTimeout(timer) }
    } else {
      const { status, latencyMs } = await timedFetch('https://google.serper.dev', { method: 'HEAD', timeoutMs: TIMEOUT_MS })
      if (status >= 200 && status < 600) return { name, configured: true, reachable: true, status: 'ok', latencyMs, lastChecked }
      return { name, configured: true, reachable: false, status: 'degraded', latencyMs, lastChecked }
    }
  } catch (err: any) {
    const msg = err.message || String(err)
    const isTimeout = msg.includes('timeout') || msg.includes('aborted')
    return { name, configured: true, reachable: false, status: 'unavailable', latencyMs: null, error: isTimeout ? `Serper unreachable (timeout ${TIMEOUT_MS}ms)` : `Serper unreachable: ${msg.slice(0, 200)}`, lastChecked }
  }
}

async function checkGroq(): Promise<DependencyCheck> {
  const key = process.env.GROQ_API_KEY
  const configured = !!key
  const name = 'groq'
  const lastChecked = new Date().toISOString()
  if (!configured) return { name, configured: false, reachable: null, status: 'not_configured', latencyMs: null, error: 'GROQ_API_KEY not set', lastChecked }
  try {
    if (key.length < 10) return { name, configured: true, reachable: null, status: 'unavailable', latencyMs: null, error: 'GROQ_API_KEY format invalid', lastChecked }
    const t0 = Date.now()
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      const res = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${key}` }, signal: ctrl.signal })
      const latencyMs = Date.now() - t0
      if (res.ok) return { name, configured: true, reachable: true, status: 'ok', latencyMs, lastChecked }
      if (res.status === 401 || res.status === 403) return { name, configured: true, reachable: true, status: 'unavailable', latencyMs, error: `Groq auth failed (${res.status})`, lastChecked }
      return { name, configured: true, reachable: true, status: 'degraded', latencyMs, error: `Groq returned ${res.status}`, lastChecked }
    } finally { clearTimeout(timer) }
  } catch (err: any) {
    const msg = err.message || String(err)
    const isTimeout = msg.includes('timeout') || msg.includes('aborted')
    return { name, configured: true, reachable: false, status: 'unavailable', latencyMs: null, error: isTimeout ? `Groq unreachable (timeout ${TIMEOUT_MS}ms)` : `Groq unreachable: ${msg.slice(0, 200)}`, lastChecked }
  }
}

async function checkFacilitator(): Promise<DependencyCheck> {
  const url = process.env.FACILITATOR_URL || 'https://www.x402.org/facilitator'
  const name = 'facilitator'
  const lastChecked = new Date().toISOString()
  try {
    const { status, latencyMs } = await timedFetch(url, { method: 'GET', timeoutMs: TIMEOUT_MS })
    const s: CheckStatus = status >= 500 ? 'degraded' : 'ok'
    return { name, configured: true, reachable: true, status: s, latencyMs, lastChecked, ...(s === 'degraded' ? { error: `Facilitator returned ${status}` } : {}) }
  } catch (err: any) {
    const msg = err.message || String(err)
    const isTimeout = msg.includes('timeout') || msg.includes('aborted')
    return { name, configured: true, reachable: false, status: 'unavailable', latencyMs: null, error: isTimeout ? `Facilitator unreachable (timeout ${TIMEOUT_MS}ms)` : `Facilitator unreachable: ${msg.slice(0, 200)}`, lastChecked }
  }
}

async function checkHorizon(): Promise<DependencyCheck> {
  const network = process.env.STELLAR_NETWORK || 'stellar:testnet'
  const url = network === 'stellar:mainnet' ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org'
  const name = 'horizon'
  const lastChecked = new Date().toISOString()
  try {
    const { status, latencyMs } = await timedFetch(url, { method: 'GET', timeoutMs: TIMEOUT_MS })
    const s: CheckStatus = status >= 500 ? 'degraded' : 'ok'
    return { name, configured: true, reachable: true, status: s, latencyMs, lastChecked, ...(s === 'degraded' ? { error: `Horizon returned ${status}` } : {}) }
  } catch (err: any) {
    const msg = err.message || String(err)
    const isTimeout = msg.includes('timeout') || msg.includes('aborted')
    return { name, configured: true, reachable: false, status: 'unavailable', latencyMs: null, error: isTimeout ? `Horizon unreachable (timeout ${TIMEOUT_MS}ms)` : `Horizon unreachable: ${msg.slice(0, 200)}`, lastChecked }
  }
}

function aggregateStatus(checks: DependencyCheck[]): 'ok' | 'degraded' | 'unavailable' {
  const statuses = checks.map(c => c.status)
  if (statuses.includes('unavailable')) {
    const cnt = statuses.filter(s => s === 'unavailable').length
    return cnt >= 2 ? 'unavailable' : 'degraded'
  }
  if (statuses.includes('degraded')) return 'degraded'
  if (statuses.includes('not_configured')) return 'degraded'
  return 'ok'
}

async function getReadiness(): Promise<any> {
  const now = Date.now()
  if (cache && now < cache.expiresAt) {
    return { ...cache.result, cached: true, cacheAgeMs: now - cache.cachedAt }
  }
  const checks = await Promise.all([checkSerper(), checkGroq(), checkFacilitator(), checkHorizon()])
  const status = aggregateStatus(checks)
  const result = {
    status,
    checks: Object.fromEntries(checks.map(c => [c.name, c])),
    cached: false,
    cacheAgeMs: 0,
    timestamp: new Date().toISOString(),
  }
  cache = { result, expiresAt: now + CACHE_TTL_MS, cachedAt: now }
  return result
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const NETWORK = process.env.STELLAR_NETWORK || 'stellar:testnet'
  const FACILITATOR_URL = process.env.FACILITATOR_URL || 'https://www.x402.org/facilitator'
  const SERPER_API_KEY = process.env.SERPER_API_KEY
  const GROQ_API_KEY = process.env.GROQ_API_KEY
  const RECEIVING_ADDRESS = process.env.STELLAR_RECEIVING_ADDRESS

  // Support ?fresh=1 to bypass cache for readiness
  const fresh = req.query.fresh === '1'

  let readiness
  try {
    if (fresh && cache) cache = null
    readiness = await getReadiness()
  } catch (err: any) {
    readiness = { status: 'degraded', checks: {}, cached: false, cacheAgeMs: 0, timestamp: new Date().toISOString(), error: err.message }
  }

  const status = readiness.status

  res.json({
    status,
    network: NETWORK,
    pricePerQuery: '0.001 USDC',
    protocol: 'x402',
    facilitator: FACILITATOR_URL,
    // legacy booleans
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
    timestamp: new Date().toISOString(),
  })
}
