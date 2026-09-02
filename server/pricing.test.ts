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

describe('GET /pricing', () => {
  it('returns pricing info without payment required', async () => {
    const res = await request(app).get('/pricing')
    expect(res.status).toBe(200)
    expect(res.body.version).toBe('1.0.0')
    expect(Array.isArray(res.body.endpoints)).toBe(true)
    expect(Array.isArray(res.body.schemes)).toBe(true)
    expect(typeof res.body.facilitatorUrl).toBe('string')
    expect(typeof res.body.note).toBe('string')
  })

  it('lists all paid endpoints', async () => {
    const res = await request(app).get('/pricing')
    const endpoints = res.body.endpoints
    expect(endpoints.length).toBe(5)
    
    const paths = endpoints.map((e: any) => e.path)
    expect(paths).toContain('/search')
    expect(paths).toContain('/images')
    expect(paths).toContain('/news')
    expect(paths).toContain('/search/batch')
    expect(paths).toContain('/jobs')
  })

  it('each endpoint has method, path, and description', async () => {
    const res = await request(app).get('/pricing')
    for (const endpoint of res.body.endpoints) {
      expect(typeof endpoint.method).toBe('string')
      expect(typeof endpoint.path).toBe('string')
      expect(typeof endpoint.description).toBe('string')
    }
  })

  it('scheme contains required fields from validated config', async () => {
    const res = await request(app).get('/pricing')
    const scheme = res.body.schemes[0]
    
    expect(scheme.network).toMatch(/stellar:/)
    expect(scheme.scheme).toBe('exact')
    expect(typeof scheme.assetContract).toBe('string')
    expect(scheme.assetContract.length).toBeGreaterThan(0)
    expect(scheme.amountStroops).toBe('10000')
    expect(scheme.amountUsdc).toBe('0.001')
    expect(typeof scheme.payTo).toBe('string')
    expect(scheme.payTo.startsWith('G')).toBe(true)
    expect(scheme.maxTimeoutSeconds).toBe(300)
  })

  it('facilitator URL is configured', async () => {
    const res = await request(app).get('/pricing')
    expect(res.body.facilitatorUrl).toBe('https://www.x402.org/facilitator')
  })

  it('does not require payment (no 402)', async () => {
    const res = await request(app).get('/pricing')
    expect(res.status).not.toBe(402)
  })
})
