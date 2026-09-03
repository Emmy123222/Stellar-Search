import { describe, it, expect, vi, beforeAll } from 'vitest'
import request from 'supertest'
import { MEASURED_STAT_FIELDS, resolveStat, hasAnyStats } from '../src/lib/serverHealth'

// Mock x402 and Groq before importing app
vi.mock('@x402/express', () => ({
  paymentMiddlewareFromConfig: () => (_req: any, _res: any, next: any) => next(),
}))
// Using global mock for HTTPFacilitatorClient
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

// Need to set env before import
process.env.STELLAR_RECEIVING_ADDRESS = 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3'
process.env.SERPER_API_KEY = 'test-serper-key'
process.env.GROQ_API_KEY = 'gsk_test'

let app: any

beforeAll(async () => {
  const mod = await import('./index.js')
  app = mod.default
})

describe('GET /health and GET /', () => {
  it('GET /health returns ok with settlement config', async () => {
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(res.body.protocol).toBe('x402')
    expect(res.body.pricePerQuery).toBe('0.001 USDC')
    expect(typeof res.body.totalQueries).toBe('number')
    expect(typeof res.body.totalUsdcSettled).toBe('string')
    expect(typeof res.body.avgLatencyMs).toBe('number')
    expect(typeof res.body.uptime).toBe('string')
    expect(res.body.network).toMatch(/stellar:/)
    // Config flags present
    expect(typeof res.body.serperApiConfigured).toBe('boolean')
    expect(typeof res.body.groqApiConfigured).toBe('boolean')
    expect(typeof res.body.receivingAddressConfigured).toBe('boolean')
    // Serper circuit breaker state (issue #120)
    expect(res.body.serperCircuitBreaker).toMatchObject({
      name: 'serper',
      state: expect.stringMatching(/^(closed|open|half-open)$/),
      failureCount: expect.any(Number),
      failureThreshold: expect.any(Number),
      openDurationMs: expect.any(Number),
      halfOpenMaxProbes: expect.any(Number),
    })
  })

  // ─── Statistics declaration (#226) ──────────────────────────────────────
  // Express keeps the counters in the process serving the paid routes, so it
  // measures everything and says so. The declaration is what lets a consumer
  // tell a real `totalQueries: 0` apart from a runtime that never measured it.

  it('GET /health declares that it measures every activity statistic', async () => {
    const res = await request(app).get('/health')
    expect(res.body.statsSupported).toBe(true)
    expect(res.body.unsupportedFields).toEqual([])
    expect(res.body.statsUnavailableReason).toBeUndefined()
  })

  it('GET /health resolves every statistic as available through the shared contract', async () => {
    const res = await request(app).get('/health')
    expect(hasAnyStats(res.body)).toBe(true)
    for (const field of MEASURED_STAT_FIELDS) {
      expect(resolveStat(res.body, field).available).toBe(true)
    }
  })

  it('GET /health reports a zero counter as a real measurement, not an absence', async () => {
    // Nothing has been searched in this suite, so the counters are genuinely
    // zero — and must resolve as available zeros rather than "unavailable".
    const res = await request(app).get('/health')
    const queries = resolveStat(res.body, 'totalQueries')
    expect(queries).toEqual({ available: true, value: res.body.totalQueries })
    expect(typeof res.body.totalQueries).toBe('number')
  })

  it('GET / returns service metadata with paid routes', async () => {
    const res = await request(app).get('/')
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('StellarSearch')
    expect(res.body.version).toBe('1.0.0')
    expect(res.body.capabilities.streaming).toBe(true)
    expect(res.body.capabilities.images).toBe(true)
    expect(res.body.capabilities.news).toBe(true)
    expect(res.body.capabilities.paymentHeaders).toContain('x-payment')
    expect(res.body.capabilities.runtime).toBe('express')
    expect(res.body.endpoints['GET /search?q=<query>']).toContain('0.001 USDC')
    expect(res.body.endpoints['GET /images?q=<query>']).toContain('0.001 USDC')
    expect(res.body.endpoints['GET /news?q=<query>']).toContain('0.001 USDC')
    expect(res.body.endpoints['POST /ai/chat']).toBeDefined()
    expect(res.body.endpoints['GET /health']).toBeDefined()
  })

  it('GET /health totalUsdcSettled is formatted to 4 decimals', async () => {
    const res = await request(app).get('/health')
    expect(res.body.totalUsdcSettled).toMatch(/^\d+\.\d{4}$/)
  })

  it('GET /health uptime format is seconds/minutes/hours', async () => {
    const res = await request(app).get('/health')
    expect(res.body.uptime).toMatch(/^(\d+s|\d+m|\d+h)$/)
  })

  it('preserves x402 price semantics in health check', async () => {
    const res = await request(app).get('/health')
    expect(res.body.pricePerQuery).toBe('0.001 USDC')
    // facilitator URL present
    expect(typeof res.body.facilitator).toBe('string')
    expect(res.body.facilitator.length).toBeGreaterThan(0)
  })
})

describe('POST /ai/chat — single route with streaming, JSON fallback, and model selection', () => {
  it('returns 400 when messages missing', async () => {
    const res = await request(app).post('/ai/chat').send({}).set('Content-Type', 'application/json')
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/messages array required/)
  })

  it('returns 400 when messages empty', async () => {
    const res = await request(app).post('/ai/chat').send({ messages: [] }).set('Content-Type', 'application/json')
    expect(res.status).toBe(400)
  })

  it('validates messages structure — rejects null messages', async () => {
    const res = await request(app).post('/ai/chat').send({ messages: null }).set('Content-Type', 'application/json')
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/messages array required/)
  })

  it('only registers a single POST /ai/chat route', async () => {
    // Verify the route only accepts POST — GET returns 404 (no GET handler registered)
    const getRes = await request(app).get('/ai/chat')
    expect(getRes.status).toBe(404)

    // Verify POST with valid data reaches the handler (Groq mock returns default response)
    const postRes = await request(app)
      .post('/ai/chat')
      .send({ messages: [{ role: 'user', content: 'hello' }] })
      .set('Content-Type', 'application/json')
    // The handler either succeeds (200) or fails with Groq error (500),
    // but it MUST be handled — not 404
    expect(postRes.status).not.toBe(404)
  })
})

describe('method handling — 405 with Allow header', () => {
  it('GET /search returns 405 with Allow header for POST', async () => {
    const res = await request(app).post('/search')
    expect(res.status).toBe(405)
    expect(res.body.error).toMatch(/Method not allowed/)
    expect(res.headers['allow']).toMatch(/GET/)
    expect(res.headers['allow']).toMatch(/OPTIONS/)
  })

  it('GET /search returns 405 with Allow header for PUT', async () => {
    const res = await request(app).put('/search')
    expect(res.status).toBe(405)
    expect(res.headers['allow']).toMatch(/GET/)
  })

  it('GET /images returns 405 with Allow header for POST', async () => {
    const res = await request(app).post('/images')
    expect(res.status).toBe(405)
    expect(res.body.error).toMatch(/Method not allowed/)
    expect(res.headers['allow']).toMatch(/GET/)
  })

  it('GET /news returns 405 with Allow header for DELETE', async () => {
    const res = await request(app).delete('/news')
    expect(res.status).toBe(405)
    expect(res.headers['allow']).toMatch(/GET/)
  })

  it('GET /health returns 405 with Allow header for POST', async () => {
    const res = await request(app).post('/health')
    expect(res.status).toBe(405)
    expect(res.body.error).toMatch(/Method not allowed/)
    expect(res.headers['allow']).toMatch(/GET/)
  })

  it('POST /ai/chat returns 405 with Allow header for GET', async () => {
    const res = await request(app).get('/ai/chat')
    expect(res.status).toBe(405)
    expect(res.body.error).toMatch(/Method not allowed/)
    expect(res.headers['allow']).toMatch(/POST/)
  })

  it('POST /ai/chat returns 405 with Allow header for DELETE', async () => {
    const res = await request(app).delete('/ai/chat')
    expect(res.status).toBe(405)
    expect(res.headers['allow']).toMatch(/POST/)
  })

  it('GET / returns 405 with Allow header for POST', async () => {
    const res = await request(app).post('/')
    expect(res.status).toBe(405)
    expect(res.body.error).toMatch(/Method not allowed/)
    expect(res.headers['allow']).toMatch(/GET/)
  })
})

describe('GET /search validation (x402 middleware bypassed via mock)', () => {
  it('returns 400 when q missing', async () => {
    const res = await request(app).get('/search')
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Missing required parameter/)
  })

  it('returns 400 when q empty', async () => {
    const res = await request(app).get('/search?q=   ')
    expect(res.status).toBe(400)
  })

  it('returns 400 when q too long', async () => {
    const long = 'a'.repeat(257)
    const res = await request(app).get(`/search?q=${long}`)
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Query too long/)
  })
})
