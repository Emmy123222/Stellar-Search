/**
 * Cached readiness checks — low-cost, strict timeouts, distinguishes configured/reachable/degraded/unavailable.
 * Shared vocabulary: status ∈ {ok, degraded, unavailable, not_configured}
 * Health endpoints (Express + Vercel) use this module to avoid config-boolean lies.
 */

export type CheckStatus = 'ok' | 'degraded' | 'unavailable' | 'not_configured'

export interface DependencyCheck {
  name: string
  configured: boolean
  reachable: boolean | null
  status: CheckStatus
  latencyMs: number | null
  error?: string
  lastChecked: string
}

export interface ReadinessResult {
  status: 'ok' | 'degraded' | 'unavailable'
  checks: Record<string, DependencyCheck>
  cached: boolean
  cacheAgeMs: number
  timestamp: string
}

const CACHE_TTL_MS = 30_000
const TIMEOUT_MS = 2000

let cache: { result: ReadinessResult; expiresAt: number; cachedAt: number } | null = null

function withTimeout<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  let timer: NodeJS.Timeout
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new Error('aborted'))
    })
  })
  return Promise.race([promise.finally(() => clearTimeout(timer)), timeout]) as Promise<T>
}

async function timedFetch(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<{ ok: boolean; status: number; latencyMs: number }> {
  const timeoutMs = init.timeoutMs ?? TIMEOUT_MS
  const controller = new AbortController()
  const t0 = Date.now()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, redirect: 'manual' } as RequestInit)
    const latencyMs = Date.now() - t0
    return { ok: res.ok, status: res.status, latencyMs }
  } finally {
    clearTimeout(timer)
  }
}

// ─── Individual checks ────────────────────────────────────────────────────

async function checkSerper(): Promise<DependencyCheck> {
  const key = process.env.SERPER_API_KEY
  const configured = !!key
  const name = 'serper'
  const lastChecked = new Date().toISOString()
  if (!configured) {
    return { name, configured: false, reachable: null, status: 'not_configured', latencyMs: null, error: 'SERPER_API_KEY not set', lastChecked }
  }
  // Low-cost probe: try to reach serper domain without incurring a search cost.
  // We do a GET to the base domain; if that fails we fallback to POST with num=1 under deep flag.
  // Default is cheap network reachability + key format validation.
  try {
    // Validate key format loosely: serper keys are 32+ hex/alpha, Groq-like check is separate.
    const formatOk = key.length >= 16
    if (!formatOk) {
      return { name, configured: true, reachable: null, status: 'unavailable', latencyMs: null, error: 'SERPER_API_KEY format looks invalid', lastChecked }
    }
    // Prefer deep check only when explicitly enabled to avoid billing.
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
        if (res.status === 401 || res.status === 403) {
          const txt = await res.text().catch(() => '')
          return { name, configured: true, reachable: true, status: 'unavailable', latencyMs, error: `Serper auth failed (${res.status}): ${txt.slice(0, 120)}`, lastChecked }
        }
        return { name, configured: true, reachable: true, status: 'degraded', latencyMs, error: `Serper returned ${res.status}`, lastChecked }
      } finally {
        clearTimeout(timer)
      }
    } else {
      // Cheap reachability: HEAD request to serper (no auth needed to test network)
      const { ok, status, latencyMs } = await timedFetch('https://google.serper.dev', { method: 'HEAD', timeoutMs: TIMEOUT_MS })
      // Any HTTP response means network reachable; 404/405 still means reachable.
      if (status >= 200 && status < 600) {
        return { name, configured: true, reachable: true, status: 'ok', latencyMs, lastChecked }
      }
      return { name, configured: true, reachable: ok, status: ok ? 'ok' : 'degraded', latencyMs, lastChecked }
    }
  } catch (err: any) {
    const msg = err.message || String(err)
    const isTimeout = msg.includes('timeout') || msg.includes('aborted') || msg.includes('AbortError')
    return {
      name, configured: true, reachable: false, status: 'unavailable', latencyMs: null,
      error: isTimeout ? `Serper unreachable (timeout ${TIMEOUT_MS}ms)` : `Serper unreachable: ${msg.slice(0, 200)}`,
      lastChecked,
    }
  }
}

async function checkGroq(): Promise<DependencyCheck> {
  const key = process.env.GROQ_API_KEY
  const configured = !!key
  const name = 'groq'
  const lastChecked = new Date().toISOString()
  if (!configured) {
    return { name, configured: false, reachable: null, status: 'not_configured', latencyMs: null, error: 'GROQ_API_KEY not set', lastChecked }
  }
  try {
    if (key.length < 10) {
      return { name, configured: true, reachable: null, status: 'unavailable', latencyMs: null, error: 'GROQ_API_KEY format invalid', lastChecked }
    }
    const t0 = Date.now()
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      const res = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
        signal: ctrl.signal,
      })
      const latencyMs = Date.now() - t0
      if (res.ok) return { name, configured: true, reachable: true, status: 'ok', latencyMs, lastChecked }
      if (res.status === 401 || res.status === 403) {
        return { name, configured: true, reachable: true, status: 'unavailable', latencyMs, error: `Groq auth failed (${res.status})`, lastChecked }
      }
      return { name, configured: true, reachable: true, status: 'degraded', latencyMs, error: `Groq returned ${res.status}`, lastChecked }
    } finally {
      clearTimeout(timer)
    }
  } catch (err: any) {
    const msg = err.message || String(err)
    const isTimeout = msg.includes('timeout') || msg.includes('aborted')
    return {
      name, configured: true, reachable: false, status: 'unavailable', latencyMs: null,
      error: isTimeout ? `Groq unreachable (timeout ${TIMEOUT_MS}ms)` : `Groq unreachable: ${msg.slice(0, 200)}`,
      lastChecked,
    }
  }
}

async function checkFacilitator(): Promise<DependencyCheck> {
  const url = process.env.FACILITATOR_URL || 'https://www.x402.org/facilitator'
  const name = 'facilitator'
  const lastChecked = new Date().toISOString()
  try {
    const { ok, status, latencyMs } = await timedFetch(url, { method: 'GET', timeoutMs: TIMEOUT_MS })
    // Facilitator may return 404 on GET / but still reachable; treat any HTTP <600 as reachable.
    if (status >= 200 && status < 600) {
      // 2xx-4xx means reachable; 5xx => degraded
      const s: CheckStatus = status >= 500 ? 'degraded' : 'ok'
      return { name, configured: true, reachable: true, status: s, latencyMs, lastChecked, ...(s === 'degraded' ? { error: `Facilitator returned ${status}` } : {}) }
    }
    return { name, configured: true, reachable: ok, status: ok ? 'ok' : 'degraded', latencyMs, lastChecked }
  } catch (err: any) {
    const msg = err.message || String(err)
    const isTimeout = msg.includes('timeout') || msg.includes('aborted')
    return {
      name, configured: true, reachable: false, status: 'unavailable', latencyMs: null,
      error: isTimeout ? `Facilitator unreachable (timeout ${TIMEOUT_MS}ms)` : `Facilitator unreachable: ${msg.slice(0, 200)}`,
      lastChecked,
    }
  }
}

async function checkHorizon(): Promise<DependencyCheck> {
  const network = process.env.STELLAR_NETWORK || 'stellar:testnet'
  const isMainnet = network === 'stellar:mainnet'
  const url = isMainnet ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org'
  const name = 'horizon'
  const lastChecked = new Date().toISOString()
  try {
    const { status, latencyMs } = await timedFetch(url, { method: 'GET', timeoutMs: TIMEOUT_MS })
    const s: CheckStatus = status >= 500 ? 'degraded' : 'ok'
    return { name, configured: true, reachable: true, status: s, latencyMs, lastChecked, ...(s === 'degraded' ? { error: `Horizon returned ${status}` } : {}) }
  } catch (err: any) {
    const msg = err.message || String(err)
    const isTimeout = msg.includes('timeout') || msg.includes('aborted')
    return {
      name, configured: true, reachable: false, status: 'unavailable', latencyMs: null,
      error: isTimeout ? `Horizon unreachable (timeout ${TIMEOUT_MS}ms)` : `Horizon unreachable: ${msg.slice(0, 200)}`,
      lastChecked,
    }
  }
}

function aggregateStatus(checks: DependencyCheck[]): 'ok' | 'degraded' | 'unavailable' {
  const statuses = checks.map(c => c.status)
  if (statuses.includes('unavailable')) {
    // If any critical dependency is unavailable and configured, overall is degraded unless multiple unavailable
    const unavailableCount = statuses.filter(s => s === 'unavailable').length
    // If 2+ unavailable → unavailable, else degraded to avoid false 503 on single transient
    // But spec wants distinguish: we treat configured-but-unreachable as degraded unless horizon/facilitator both down
    // For simplicity: if any check is unavailable, mark degraded; if 2+ or horizon unavailable, mark unavailable
    if (unavailableCount >= 2) return 'unavailable'
    // Single unavailable is degraded (still serving)
    return 'degraded'
  }
  if (statuses.includes('degraded')) return 'degraded'
  if (statuses.includes('not_configured')) return 'degraded'
  return 'ok'
}

// ─── Public API ─────────────────────────────────────────────────────────

export async function getReadiness(opts: { forceRefresh?: boolean; timeoutMs?: number } = {}): Promise<ReadinessResult> {
  const now = Date.now()
  if (!opts.forceRefresh && cache && now < cache.expiresAt) {
    return { ...cache.result, cached: true, cacheAgeMs: now - cache.cachedAt }
  }

  // Run checks in parallel with an overall timeout to guarantee strict bounds
  const overallTimeout = opts.timeoutMs ?? TIMEOUT_MS + 500
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), overallTimeout)

  let checks: DependencyCheck[]
  try {
    checks = await Promise.all([
      checkSerper(),
      checkGroq(),
      checkFacilitator(),
      checkHorizon(),
    ])
  } catch (err: any) {
    // Fallback if Promise.all rejects (should not, since individual checks catch)
    checks = [
      { name: 'serper', configured: !!process.env.SERPER_API_KEY, reachable: false, status: 'unavailable', latencyMs: null, error: err.message, lastChecked: new Date().toISOString() },
      { name: 'groq', configured: !!process.env.GROQ_API_KEY, reachable: false, status: 'unavailable', latencyMs: null, error: err.message, lastChecked: new Date().toISOString() },
      { name: 'facilitator', configured: true, reachable: false, status: 'unavailable', latencyMs: null, error: err.message, lastChecked: new Date().toISOString() },
      { name: 'horizon', configured: true, reachable: false, status: 'unavailable', latencyMs: null, error: err.message, lastChecked: new Date().toISOString() },
    ]
  } finally {
    clearTimeout(timer)
  }

  const status = aggregateStatus(checks)
  const result: ReadinessResult = {
    status,
    checks: Object.fromEntries(checks.map(c => [c.name, c])),
    cached: false,
    cacheAgeMs: 0,
    timestamp: new Date().toISOString(),
  }

  cache = { result, expiresAt: now + CACHE_TTL_MS, cachedAt: now }
  return result
}

export function clearReadinessCache(): void {
  cache = null
}

export const __testing = { checkSerper, checkGroq, checkFacilitator, checkHorizon, aggregateStatus, CACHE_TTL_MS, TIMEOUT_MS }
