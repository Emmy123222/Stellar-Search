/**
 * Shared Serper.dev HTTP client, wrapped in a circuit breaker and a bounded
 * retry loop (issue #118).
 *
 * Used by every runtime that calls Serper directly (Express `server/index.ts`
 * and the Vercel functions under `api/`). The browser and MCP server never
 * call Serper directly — they call these runtimes' `/search`, `/images`,
 * `/news` endpoints — so protecting the two direct callers protects every
 * surface transitively.
 *
 * Two independent mechanisms, deliberately layered:
 *
 *   1. **Retry** — a single 429/5xx or connection reset used to fail an
 *      already-settled search immediately. Transient failures are now retried
 *      with jitter under a strict attempt budget, honouring `Retry-After`.
 *      Permanent 4xx responses are never retried: Serper answered, a retry
 *      would fail the same way. Client cancellation (`init.signal`) aborts
 *      immediately and is never retried.
 *   2. **Circuit breaker** — repeated *upstream* trouble (5xx / 429) opens the
 *      breaker so we fail fast instead of queueing retries against a provider
 *      that is already down. A 4xx from a malformed request still means Serper
 *      answered, so it does not indicate the dependency is unhealthy.
 *
 * The retry loop runs *inside* the breaker so one logical request (including
 * its retries) counts as a single breaker outcome.
 *
 * Serper's search/images/news endpoints are POSTs but are read operations:
 * re-issuing one after a 429/5xx/connection reset cannot double-apply a
 * mutation, which is what makes the retry safe.
 */
import { CircuitBreaker, CircuitOpenError, type CircuitBreakerSnapshot } from './circuitBreaker'

const SERPER_BASE_URL = 'https://google.serper.dev'

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export const serperBreaker = new CircuitBreaker({
  name: 'serper',
  failureThreshold: envInt('SERPER_BREAKER_FAILURE_THRESHOLD', 5),
  openDurationMs: envInt('SERPER_BREAKER_OPEN_MS', 30_000),
  halfOpenMaxProbes: envInt('SERPER_BREAKER_HALF_OPEN_PROBES', 1),
})

export { CircuitOpenError }
export type { CircuitBreakerSnapshot }

export function getSerperBreakerState(): CircuitBreakerSnapshot {
  return serperBreaker.getSnapshot()
}

function isUpstreamFailure(res: Response): boolean {
  return res.status >= 500 || res.status === 429
}

// ─── Retry policy ─────────────────────────────────────────────────────────

export interface SerperRetryPolicy {
  /** Total attempts, including the first. `1` disables retries. */
  attempts: number
  /** Base of the exponential backoff, in milliseconds. */
  baseDelayMs: number
  /** Upper bound for any single backoff delay, in milliseconds. */
  maxDelayMs: number
  /** Upper bound applied to a server-provided `Retry-After`, in milliseconds. */
  maxRetryAfterMs: number
}

export const DEFAULT_SERPER_RETRY_POLICY: SerperRetryPolicy = {
  attempts: 3,
  baseDelayMs: 200,
  maxDelayMs: 2_000,
  maxRetryAfterMs: 5_000,
}

/** Reads the retry policy from env, falling back to the defaults above. */
export function readSerperRetryPolicy(): SerperRetryPolicy {
  return {
    attempts: envInt('SERPER_RETRY_ATTEMPTS', DEFAULT_SERPER_RETRY_POLICY.attempts),
    baseDelayMs: envInt('SERPER_RETRY_BASE_MS', DEFAULT_SERPER_RETRY_POLICY.baseDelayMs),
    maxDelayMs: envInt('SERPER_RETRY_MAX_MS', DEFAULT_SERPER_RETRY_POLICY.maxDelayMs),
    maxRetryAfterMs: envInt('SERPER_RETRY_AFTER_MAX_MS', DEFAULT_SERPER_RETRY_POLICY.maxRetryAfterMs),
  }
}

/**
 * Transient statuses worth retrying: rate limiting and server-side failures.
 * 501 (not implemented) is treated as permanent — retrying cannot help.
 */
export function isRetryableStatus(status: number): boolean {
  if (status === 408 || status === 425 || status === 429) return true
  return status >= 500 && status !== 501
}

const RETRYABLE_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'EPIPE',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
])

/**
 * A thrown `fetch` failure is retryable when it looks like transport trouble
 * (reset/refused/timeout) rather than a cancellation or a programming error.
 * `AbortError` is never retried: the caller asked us to stop.
 */
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === 'AbortError') return false
  const code = (error as { code?: unknown }).code
  if (typeof code === 'string' && RETRYABLE_ERROR_CODES.has(code)) return true
  // undici surfaces connection resets as `TypeError: fetch failed`.
  return error.name === 'TypeError' && /fetch failed|network|socket|timeout/i.test(error.message)
}

/**
 * Parses an HTTP `Retry-After` header, which may be either delta-seconds or an
 * HTTP-date. Returns `null` when the header is absent or unparseable.
 */
export function parseRetryAfterMs(value: string | null | undefined, now = Date.now()): number | null {
  if (value === null || value === undefined) return null
  const trimmed = String(value).trim()
  if (!trimmed) return null

  // A negative delta-seconds value is not a legal Retry-After (and would
  // otherwise be parsed as a year, e.g. `-5`), so treat it as absent.
  if (/^-/.test(trimmed)) return null

  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000

  const asDate = Date.parse(trimmed)
  if (!Number.isNaN(asDate)) return Math.max(0, asDate - now)

  return null
}

/**
 * Exponential backoff with full jitter: uniform in `[0, min(maxDelayMs, base * 2^(attempt-1))]`.
 * Jitter keeps parallel callers from retrying in lockstep after a shared outage.
 */
export function computeBackoffMs(
  attempt: number,
  policy: SerperRetryPolicy = DEFAULT_SERPER_RETRY_POLICY,
  rng: () => number = Math.random,
): number {
  const exponential = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.max(0, attempt - 1))
  if (exponential <= 0) return 0
  return Math.floor(rng() * exponential)
}

function delayForAttempt(
  attempt: number,
  policy: SerperRetryPolicy,
  retryAfterMs: number | null,
  rng: () => number,
): number {
  if (retryAfterMs !== null) return Math.min(retryAfterMs, policy.maxRetryAfterMs)
  return computeBackoffMs(attempt, policy, rng)
}

/** Sleeps, resolving early (by rejecting with an AbortError) if `signal` fires. */
function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms))
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function abortError(): Error {
  return Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
}

export interface FetchSerperWithRetryOptions {
  policy?: SerperRetryPolicy
  /** Injectable for deterministic tests. */
  sleepFn?: (ms: number, signal?: AbortSignal | null) => Promise<void>
  rng?: () => number
  /** Observability hook, invoked before each backoff. Never throws into the flow. */
  onRetry?: (info: { attempt: number; delayMs: number; reason: 'status' | 'error'; status?: number }) => void
}

/**
 * Issues one Serper request, retrying only transient failures within a strict
 * attempt budget. Resolves with the final `Response` (successful or not) so
 * callers keep their existing status-code handling; rejects only when the last
 * attempt threw.
 */
export async function fetchSerperWithRetry(
  url: string,
  init: RequestInit,
  options: FetchSerperWithRetryOptions = {},
): Promise<Response> {
  const policy = options.policy ?? readSerperRetryPolicy()
  const sleepFn = options.sleepFn ?? sleep
  const rng = options.rng ?? Math.random
  const signal = init.signal ?? null
  const attempts = Math.max(1, policy.attempts)

  let lastError: unknown

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (signal?.aborted) throw abortError()

    try {
      const res = await fetch(url, init)

      if (!isRetryableStatus(res.status) || attempt === attempts) return res

      const retryAfterMs = parseRetryAfterMs(res.headers?.get?.('retry-after'))
      const delayMs = delayForAttempt(attempt, policy, retryAfterMs, rng)
      options.onRetry?.({ attempt, delayMs, reason: 'status', status: res.status })
      await sleepFn(delayMs, signal)
      continue
    } catch (error) {
      if (!isRetryableError(error) || attempt === attempts) throw error

      lastError = error
      const delayMs = delayForAttempt(attempt, policy, null, rng)
      options.onRetry?.({ attempt, delayMs, reason: 'error' })
      await sleepFn(delayMs, signal)
    }
  }

  throw lastError ?? new Error('Serper request failed')
}

/**
 * Drop-in replacement for `fetch(\`https://google.serper.dev${path}\`, init)`
 * that fails fast with CircuitOpenError instead of hitting the network once
 * the breaker is open, and retries transient upstream failures up to the
 * configured attempt budget.
 */
export async function fetchSerper(path: string, init: RequestInit): Promise<Response> {
  const url = `${SERPER_BASE_URL}${path}`
  return serperBreaker.execute(
    () => fetchSerperWithRetry(url, init),
    isUpstreamFailure,
  )
}
