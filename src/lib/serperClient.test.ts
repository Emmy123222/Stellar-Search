import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  DEFAULT_SERPER_RETRY_POLICY,
  computeBackoffMs,
  fetchSerperWithRetry,
  isRetryableError,
  isRetryableStatus,
  parseRetryAfterMs,
  type SerperRetryPolicy,
} from './serperClient'

describe('serperClient', () => {
  const originalEnv = { ...process.env }
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
    // Breaker assertions in this block count *network* calls; retries are
    // covered separately by the #118 suite below.
    process.env.SERPER_RETRY_ATTEMPTS = '1'
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('reads breaker thresholds from env vars', async () => {
    process.env.SERPER_BREAKER_FAILURE_THRESHOLD = '2'
    process.env.SERPER_BREAKER_OPEN_MS = '5000'
    process.env.SERPER_BREAKER_HALF_OPEN_PROBES = '3'

    const { getSerperBreakerState } = await import('./serperClient')
    const snap = getSerperBreakerState()
    expect(snap.failureThreshold).toBe(2)
    expect(snap.openDurationMs).toBe(5000)
    expect(snap.halfOpenMaxProbes).toBe(3)
  })

  it('falls back to defaults for invalid/missing env vars', async () => {
    delete process.env.SERPER_BREAKER_FAILURE_THRESHOLD
    process.env.SERPER_BREAKER_OPEN_MS = 'not-a-number'

    const { getSerperBreakerState } = await import('./serperClient')
    const snap = getSerperBreakerState()
    expect(snap.failureThreshold).toBe(5)
    expect(snap.openDurationMs).toBe(30_000)
  })

  it('fetchSerper calls the real Serper base URL with the given path', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    global.fetch = fetchMock as any

    const { fetchSerper } = await import('./serperClient')
    await fetchSerper('/search', { method: 'POST', headers: { 'X-API-KEY': 'k' } })

    expect(fetchMock).toHaveBeenCalledWith('https://google.serper.dev/search', { method: 'POST', headers: { 'X-API-KEY': 'k' } })
  })

  it('trips the breaker on repeated 5xx responses and then fails fast without calling fetch', async () => {
    process.env.SERPER_BREAKER_FAILURE_THRESHOLD = '2'
    const fetchMock = vi.fn(async () => new Response('boom', { status: 502 }))
    global.fetch = fetchMock as any

    const { fetchSerper, CircuitOpenError } = await import('./serperClient')

    await fetchSerper('/search', {})
    await fetchSerper('/search', {})
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await expect(fetchSerper('/search', {})).rejects.toBeInstanceOf(CircuitOpenError)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not trip the breaker on a 4xx (client-error) response', async () => {
    process.env.SERPER_BREAKER_FAILURE_THRESHOLD = '1'
    const fetchMock = vi.fn(async () => new Response('bad request', { status: 400 }))
    global.fetch = fetchMock as any

    const { fetchSerper, getSerperBreakerState } = await import('./serperClient')
    const res = await fetchSerper('/search', {})

    expect(res.status).toBe(400)
    expect(getSerperBreakerState().state).toBe('closed')
  })

  it('trips the breaker on a 429', async () => {
    process.env.SERPER_BREAKER_FAILURE_THRESHOLD = '1'
    const fetchMock = vi.fn(async () => new Response('rate limited', { status: 429 }))
    global.fetch = fetchMock as any

    const { fetchSerper, getSerperBreakerState } = await import('./serperClient')
    await fetchSerper('/search', {})

    expect(getSerperBreakerState().state).toBe('open')
  })

  it('a network-level throw counts as a failure', async () => {
    process.env.SERPER_BREAKER_FAILURE_THRESHOLD = '1'
    const fetchMock = vi.fn(async () => { throw new Error('network down') })
    global.fetch = fetchMock as any

    const { fetchSerper, getSerperBreakerState } = await import('./serperClient')
    await expect(fetchSerper('/search', {})).rejects.toThrow('network down')

    expect(getSerperBreakerState().state).toBe('open')
  })
})

// ─── Retry behaviour (issue #118) ─────────────────────────────────────────
//
// A single 429/5xx or connection reset used to fail an already-settled search.
// These cases pin the bounded, jittered retry contract: what is retried, what
// is not, how long we wait, and that the budget is strict.

const retryPolicy: SerperRetryPolicy = { attempts: 3, baseDelayMs: 10, maxDelayMs: 40, maxRetryAfterMs: 1_000 }

function policyFor(overrides: Partial<SerperRetryPolicy> = {}): SerperRetryPolicy {
  return { ...retryPolicy, ...overrides }
}

/** Collects the delays the retry loop asked to sleep for, without sleeping. */
function recordingSleep() {
  const delays: number[] = []
  const sleepFn = vi.fn(async (ms: number) => {
    delays.push(ms)
  })
  return { delays, sleepFn }
}

const URL_UNDER_TEST = 'https://google.serper.dev/search'

describe('serper transient-failure retry (#118)', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  describe('isRetryableStatus', () => {
    it('retries rate limits and server errors', () => {
      for (const status of [408, 425, 429, 500, 502, 503, 504]) {
        expect(isRetryableStatus(status)).toBe(true)
      }
    })

    it('never retries permanent 4xx responses', () => {
      for (const status of [400, 401, 403, 404, 405, 409, 422]) {
        expect(isRetryableStatus(status)).toBe(false)
      }
    })

    it('treats 501 as permanent', () => {
      expect(isRetryableStatus(501)).toBe(false)
    })
  })

  describe('isRetryableError', () => {
    it('retries transport-level failures', () => {
      expect(isRetryableError(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))).toBe(true)
      expect(isRetryableError(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }))).toBe(true)
      expect(isRetryableError(new TypeError('fetch failed'))).toBe(true)
    })

    it('never retries cancellation or programming errors', () => {
      expect(isRetryableError(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe(false)
      expect(isRetryableError(new Error('boom'))).toBe(false)
      expect(isRetryableError('not an error')).toBe(false)
      expect(isRetryableError(undefined)).toBe(false)
    })
  })

  describe('parseRetryAfterMs', () => {
    it('accepts delta-seconds', () => {
      expect(parseRetryAfterMs('0')).toBe(0)
      expect(parseRetryAfterMs('2')).toBe(2_000)
      expect(parseRetryAfterMs(' 5 ')).toBe(5_000)
    })

    it('accepts an HTTP-date', () => {
      const now = Date.parse('2026-01-01T00:00:00Z')
      expect(parseRetryAfterMs('Thu, 01 Jan 2026 00:00:03 GMT', now)).toBe(3_000)
      // A date in the past clamps to 0 rather than going negative.
      expect(parseRetryAfterMs('Thu, 01 Jan 2025 00:00:00 GMT', now)).toBe(0)
    })

    it('returns null for absent or unparseable values', () => {
      expect(parseRetryAfterMs(null)).toBeNull()
      expect(parseRetryAfterMs(undefined)).toBeNull()
      expect(parseRetryAfterMs('')).toBeNull()
      expect(parseRetryAfterMs('soon')).toBeNull()
      expect(parseRetryAfterMs('-5')).toBeNull()
    })
  })

  describe('computeBackoffMs', () => {
    it('grows exponentially from the base delay and stays inside maxDelayMs', () => {
      const alwaysMax = () => 0.999_999
      expect(computeBackoffMs(1, retryPolicy, alwaysMax)).toBe(9)
      expect(computeBackoffMs(2, retryPolicy, alwaysMax)).toBe(19)
      expect(computeBackoffMs(3, retryPolicy, alwaysMax)).toBe(39)
      // Never exceeds the cap even for large attempt numbers.
      expect(computeBackoffMs(20, retryPolicy, alwaysMax)).toBe(39)
    })

    it('applies full jitter within the exponential window', () => {
      expect(computeBackoffMs(3, retryPolicy, () => 0)).toBe(0)
      expect(computeBackoffMs(3, retryPolicy, () => 0.5)).toBe(20)
    })
  })

  it('retries a 503 and resolves with the eventual success', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    global.fetch = fetchMock as any

    const res = await fetchSerperWithRetry(URL_UNDER_TEST, { method: 'POST' }, {
      policy: retryPolicy,
      sleepFn: async () => {},
    })

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives up after the attempt budget and returns the final response', async () => {
    const fetchMock = vi.fn(async () => new Response('down', { status: 502 }))
    global.fetch = fetchMock as any
    const { delays, sleepFn } = recordingSleep()

    const res = await fetchSerperWithRetry(URL_UNDER_TEST, {}, {
      policy: policyFor({ attempts: 3 }),
      sleepFn,
      rng: () => 0.5,
    })

    expect(res.status).toBe(502)
    // 3 attempts → 2 backoffs, never a 4th request.
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(delays).toHaveLength(2)
  })

  it('makes exactly one attempt when the budget is 1', async () => {
    const fetchMock = vi.fn(async () => new Response('down', { status: 503 }))
    global.fetch = fetchMock as any

    const res = await fetchSerperWithRetry(URL_UNDER_TEST, {}, {
      policy: policyFor({ attempts: 1 }),
      sleepFn: async () => {},
    })

    expect(res.status).toBe(503)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('never retries permanent 4xx responses', async () => {
    for (const status of [400, 401, 403, 404, 422]) {
      const fetchMock = vi.fn(async () => new Response('nope', { status }))
      global.fetch = fetchMock as any

      const res = await fetchSerperWithRetry(URL_UNDER_TEST, {}, {
        policy: retryPolicy,
        sleepFn: async () => {},
      })

      expect(res.status).toBe(status)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  })

  it('honours a Retry-After header instead of the exponential backoff', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('slow down', { status: 429, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    global.fetch = fetchMock as any
    const { delays, sleepFn } = recordingSleep()

    const res = await fetchSerperWithRetry(URL_UNDER_TEST, {}, { policy: policyFor({ maxRetryAfterMs: 5_000 }), sleepFn })

    expect(res.status).toBe(200)
    expect(delays).toEqual([2_000])
  })

  it('caps a hostile Retry-After at maxRetryAfterMs', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('slow down', { status: 429, headers: { 'retry-after': '3600' } }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    global.fetch = fetchMock as any
    const { delays, sleepFn } = recordingSleep()

    await fetchSerperWithRetry(URL_UNDER_TEST, {}, { policy: policyFor({ maxRetryAfterMs: 500 }), sleepFn })

    expect(delays).toEqual([500])
  })

  it('retries a connection reset surfaced as a thrown TypeError', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    global.fetch = fetchMock as any

    const res = await fetchSerperWithRetry(URL_UNDER_TEST, {}, { policy: retryPolicy, sleepFn: async () => {} })

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rethrows the last error once the budget is exhausted', async () => {
    const failure = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
    const fetchMock = vi.fn(async () => {
      throw failure
    })
    global.fetch = fetchMock as any

    await expect(
      fetchSerperWithRetry(URL_UNDER_TEST, {}, { policy: policyFor({ attempts: 2 }), sleepFn: async () => {} }),
    ).rejects.toBe(failure)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry an AbortError from the caller', async () => {
    const controller = new AbortController()
    const abortErr = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    const fetchMock = vi.fn(async () => {
      controller.abort()
      throw abortErr
    })
    global.fetch = fetchMock as any

    await expect(
      fetchSerperWithRetry(URL_UNDER_TEST, { signal: controller.signal }, { policy: retryPolicy, sleepFn: async () => {} }),
    ).rejects.toBe(abortErr)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not issue a request at all when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchMock = vi.fn()
    global.fetch = fetchMock as any

    await expect(
      fetchSerperWithRetry(URL_UNDER_TEST, { signal: controller.signal }, { policy: retryPolicy, sleepFn: async () => {} }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('aborts a pending backoff when the caller cancels mid-retry', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn(async () => new Response('down', { status: 503 }))
    global.fetch = fetchMock as any

    const sleepFn = vi.fn(async () => {
      controller.abort()
    })

    await expect(
      fetchSerperWithRetry(URL_UNDER_TEST, { signal: controller.signal }, { policy: retryPolicy, sleepFn }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports each retry through the onRetry hook', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(new Response('down', { status: 502 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    global.fetch = fetchMock as any

    const attempts: Array<{ attempt: number; reason: string; status?: number }> = []
    const res = await fetchSerperWithRetry(URL_UNDER_TEST, {}, {
      policy: retryPolicy,
      sleepFn: async () => {},
      onRetry: (info) => attempts.push({ attempt: info.attempt, reason: info.reason, status: info.status }),
    })

    expect(res.status).toBe(200)
    expect(attempts).toEqual([
      { attempt: 1, reason: 'status', status: 429 },
      { attempt: 2, reason: 'status', status: 502 },
    ])
  })

  it('defaults to a 3-attempt budget', () => {
    expect(DEFAULT_SERPER_RETRY_POLICY.attempts).toBe(3)
    expect(DEFAULT_SERPER_RETRY_POLICY.baseDelayMs).toBeGreaterThan(0)
    expect(DEFAULT_SERPER_RETRY_POLICY.maxDelayMs).toBeGreaterThanOrEqual(DEFAULT_SERPER_RETRY_POLICY.baseDelayMs)
  })
})
