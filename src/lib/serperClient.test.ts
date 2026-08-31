import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('serperClient', () => {
  const originalEnv = { ...process.env }
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
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
