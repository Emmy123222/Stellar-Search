import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import request from 'supertest'

// Mock x402 and Groq before importing app
vi.mock('@x402/express', () => ({
  paymentMiddlewareFromConfig: () => (_req: any, _res: any, next: any) => next(),
}))
vi.mock('@x402/core/server', () => ({
  HTTPFacilitatorClient: class { constructor(_opts: any) {} },
}))
vi.mock('@x402/stellar/exact/server', () => ({
  ExactStellarScheme: class { constructor() {} },
}))
vi.mock('groq-sdk', () => ({
  default: class {
    chat = { completions: { create: vi.fn() } }
  },
}))
vi.mock('./logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

process.env.STELLAR_RECEIVING_ADDRESS = 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3'
process.env.SERPER_API_KEY = 'test-serper-key'
process.env.GROQ_API_KEY = 'gsk_test'
process.env.SERPER_BREAKER_FAILURE_THRESHOLD = '2'
process.env.SERPER_BREAKER_OPEN_MS = '30000'
process.env.SERPER_BREAKER_HALF_OPEN_PROBES = '1'

let app: any
let serperBreaker: import('../src/lib/circuitBreaker').CircuitBreaker

beforeAll(async () => {
  const mod = await import('./index.js')
  app = mod.default
  const client = await import('../src/lib/serperClient.js')
  serperBreaker = client.serperBreaker
})

beforeEach(() => {
  serperBreaker.reset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Serper circuit breaker — server integration (issue #120)', () => {
  it('opens after configured consecutive upstream 5xx failures and fails fast', async () => {
    const fetchMock = vi.fn(async () => new Response('upstream down', { status: 502 }))
    vi.stubGlobal('fetch', fetchMock)

    // Threshold is 2 — first two calls hit the network and fail.
    await request(app).get('/search?q=test1')
    await request(app).get('/search?q=test2')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(serperBreaker.getSnapshot().state).toBe('open')

    // Third call should fail fast without touching the network, and surface as 503.
    const res = await request(app).get('/search?q=test3')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(res.status).toBe(503)
    expect(res.body.error).toMatch(/temporarily unavailable/i)
    expect(res.headers['retry-after']).toBeDefined()
  })

  it('recovers via a half-open probe once openDurationMs elapses', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('down', { status: 502 }))
      .mockResolvedValueOnce(new Response('down', { status: 502 }))
      .mockResolvedValue(
        new Response(JSON.stringify({ organic: [{ title: 'ok', link: 'https://example.com', snippet: 's' }] }), { status: 200 })
      )
    vi.stubGlobal('fetch', fetchMock)

    await request(app).get('/search?q=test1')
    await request(app).get('/search?q=test2')
    expect(serperBreaker.getSnapshot().state).toBe('open')

    vi.advanceTimersByTime(30_000)
    expect(serperBreaker.getSnapshot().state).toBe('half-open')

    const res = await request(app).get('/search?q=test3')
    expect(res.status).toBe(200)
    expect(serperBreaker.getSnapshot().state).toBe('closed')
  })

  it('does not trip the breaker on a 4xx (bad request) response from Serper', async () => {
    const fetchMock = vi.fn(async () => new Response('bad request', { status: 400 }))
    vi.stubGlobal('fetch', fetchMock)

    await request(app).get('/search?q=test1')
    await request(app).get('/search?q=test2')
    await request(app).get('/search?q=test3')

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(serperBreaker.getSnapshot().state).toBe('closed')
  })
})
