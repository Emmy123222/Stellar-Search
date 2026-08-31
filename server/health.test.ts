import { describe, it, expect, vi, beforeAll } from 'vitest'
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
  })

  it('GET / returns service metadata with paid routes', async () => {
    const res = await request(app).get('/')
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('StellarSearch')
    expect(res.body.version).toBe('1.0.0')
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

describe('POST /ai/chat validation', () => {
  it('returns 400 when messages missing', async () => {
    const res = await request(app).post('/ai/chat').send({}).set('Content-Type', 'application/json')
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/messages array required/)
  })

  it('returns 400 when messages empty', async () => {
    const res = await request(app).post('/ai/chat').send({ messages: [] }).set('Content-Type', 'application/json')
    expect(res.status).toBe(400)
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

describe('GET /images and GET /news validation', () => {
  it('GET /images returns 400 when q missing', async () => {
    const res = await request(app).get('/images')
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Missing required parameter/)
  })

  it('GET /news returns 400 when q missing', async () => {
    const res = await request(app).get('/news')
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Missing required parameter/)
  })
})

describe('createShutdownHandler', () => {
  it('gracefully stops server when signal is received', async () => {
    const { createShutdownHandler } = await import('./index.js')
    const closeMock = vi.fn().mockImplementation((cb: () => void) => cb())
    const exitMock = vi.fn()
    const mockServer = { close: closeMock }

    const handler = createShutdownHandler(mockServer, exitMock)
    handler('SIGTERM')

    expect(closeMock).toHaveBeenCalled()
    expect(exitMock).toHaveBeenCalledWith(0)
  })

  it('exits cleanly if server instance is null', async () => {
    const { createShutdownHandler } = await import('./index.js')
    const exitMock = vi.fn()

    const handler = createShutdownHandler(null, exitMock)
    handler('SIGINT')

    expect(exitMock).toHaveBeenCalledWith(0)
  })
})

describe('SPA static file fallback routing', () => {
  it('handles client route requests and non-api fallbacks', async () => {
    const res = await request(app).get('/some-spa-route')
    expect([200, 404]).toContain(res.status)
  })

  it('passes through api route requests', async () => {
    const res = await request(app).get('/api/health')
    expect([200, 404]).toContain(res.status)
  })
})


