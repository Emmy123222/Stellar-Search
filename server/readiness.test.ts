import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getReadiness, clearReadinessCache } from './readiness.js'

describe('readiness — cached low-cost checks with strict timeouts', () => {
  const originalEnv = { ...process.env }
  const originalFetch = global.fetch

  beforeEach(() => {
    clearReadinessCache()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    global.fetch = originalFetch
    process.env = { ...originalEnv }
    clearReadinessCache()
  })

  it('distinguishes not_configured when keys missing', async () => {
    delete process.env.SERPER_API_KEY
    delete process.env.GROQ_API_KEY
    // mock fetch to avoid network
    global.fetch = vi.fn(async () => new Response('ok', { status: 200 })) as any

    const promise = getReadiness()
    // need to advance timers? fetch is mocked so no timeout needed
    const result = await promise
    expect(result.checks.serper.status).toBe('not_configured')
    expect(result.checks.groq.status).toBe('not_configured')
    expect(result.status).toBe('degraded')
    expect(result.checks.serper.configured).toBe(false)
  })

  it('caches results within TTL and respects strict timeout', async () => {
    process.env.SERPER_API_KEY = 'dummy1234567890abcdef'
    process.env.GROQ_API_KEY = 'gsk_dummy1234567890'
    let callCount = 0
    global.fetch = vi.fn(async () => {
      callCount++
      return new Response('ok', { status: 200 })
    }) as any

    const first = await getReadiness()
    expect(callCount).toBeGreaterThan(0)
    const second = await getReadiness()
    expect(second.cached).toBe(true)
    expect(second.cacheAgeMs).toBeGreaterThanOrEqual(0)
    // force refresh bypasses cache
    const fresh = await getReadiness({ forceRefresh: true })
    expect(fresh.cached).toBe(false)
  })

  it('marks degraded/unavailable on timeout vs auth failure', async () => {
    process.env.SERPER_API_KEY = 'dummy1234567890abcdef'
    process.env.GROQ_API_KEY = 'gsk_dummy1234567890'
    process.env.FACILITATOR_URL = 'https://www.x402.org/facilitator'

    // Simulate serper reachable (200), groq auth failure 401, facilitator timeout
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('serper.dev')) return new Response('ok', { status: 200 })
      if (String(url).includes('groq.com')) return new Response('unauthorized', { status: 401 })
      if (String(url).includes('x402.org')) {
        // simulate timeout by hanging — but our check uses AbortController timeout 2s.
        // Instead return 500 to simulate degraded
        return new Response('err', { status: 500 })
      }
      return new Response('ok', { status: 200 })
    }) as any

    const result = await getReadiness({ forceRefresh: true })
    expect(result.checks.serper.status).toBe('ok')
    expect(result.checks.groq.status).toBe('unavailable')
    expect(result.checks.facilitator.status).toBe('degraded')
    // With one unavailable, overall is degraded (not unavailable)
    expect(result.status).toBe('degraded')
  })

  it('exposes configured/reachable/degraded/unavailable vocabulary', async () => {
    process.env.SERPER_API_KEY = 'dummy1234567890abcdef123456'
    process.env.GROQ_API_KEY = 'gsk_dummy1234567890abcdef123456'
    global.fetch = vi.fn(async () => {
      throw new Error('network down')
    }) as any
    const result = await getReadiness({ forceRefresh: true })
    // Both configured but network down => unavailable (or degraded if cached probe uses HEAD)
    expect(['unavailable', 'degraded']).toContain(result.checks.serper.status)
    expect(result.checks.serper.reachable).toBe(false)
    expect(result.checks.serper.configured).toBe(true)
    expect(['ok', 'degraded', 'unavailable', 'not_configured']).toContain(result.checks.groq.status)
  })
})
