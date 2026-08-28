import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'

// ── Env vars must be set before the server module loads ────────────────────
vi.hoisted(() => {
  process.env.STELLAR_RECEIVING_ADDRESS =
    'GCDNJUBQS67SL6FXCPLKI3KBV5HFQA3EGZYRWY3VYQK3DZ7E3VZ64STE'
  process.env.SERPER_API_KEY = 'test-serper-key'
  process.env.GROQ_API_KEY = 'test-groq-key'
  process.env.NODE_ENV = 'test'
})

// ── Mock x402 — paymentMiddlewareFromConfig returns a simple middleware ─────
vi.mock('@x402/express', () => ({
  paymentMiddlewareFromConfig: vi.fn(() => {
    return (req: any, res: any, next: any) => {
      const protectedPaths = ['/search', '/images', '/news']
      if (!protectedPaths.includes(req.path)) return next()

      const payment = req.headers['x-payment']
      if (!payment) {
        return res.status(402).json({
          x402Version: 1,
          accepts: [
            {
              scheme: 'exact',
              network: 'stellar:testnet',
              maxAmountRequired: '10000',
              resource: `${req.method} ${req.path}`,
              description: 'Pay-per-query search',
            },
          ],
        })
      }
      if (payment === 'invalid') {
        return res.status(403).json({ error: 'Invalid payment' })
      }
      next()
    }
  }),
}))

vi.mock('@x402/core/server', () => ({
  HTTPFacilitatorClient: vi.fn(),
}))

vi.mock('@x402/stellar/exact/server', () => ({
  ExactStellarScheme: vi.fn(),
}))

// ── Mock Groq SDK (must be a class since server uses `new Groq(...)`) ──────
vi.mock('groq-sdk', () => {
  return {
    default: class MockGroq {
      chat = {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: '[]' } }],
            model: 'llama-3.3-70b-versatile',
          }),
        },
      }
    },
  }
})

// ── Mock winston logger ────────────────────────────────────────────────────
vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// ── Import the Express app (runs module-level setup with mocked deps) ──────
import app from '../index.js'

// ── Mock global fetch (used by the server to call Serper.dev) ──────────────
const mockFetch = vi.fn()

const mockSerperResponse = {
  organic: [
    {
      title: 'Stellar Blockchain',
      link: 'https://stellar.org',
      snippet: 'A decentralized payment network.',
    },
    {
      title: 'Stellar Development Foundation',
      link: 'https://dev.stellar.org',
      snippet: 'Developer resources for Stellar.',
    },
  ],
}

describe('GET /search — x402 payment flow', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSerperResponse),
    })
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns 402 when no payment header is sent', async () => {
    const res = await request(app).get('/search?q=stellar').expect(402)

    expect(res.body.x402Version).toBe(1)
    expect(res.body.accepts).toBeDefined()
    expect(Array.isArray(res.body.accepts)).toBe(true)
    expect(res.body.accepts[0].scheme).toBe('exact')
  })

  it('returns 200 with search results when a valid payment header is sent', async () => {
    const res = await request(app)
      .get('/search?q=stellar')
      .set('x-payment', 'valid-payment')
      .expect(200)

    expect(res.body.query).toBe('stellar')
    expect(res.body.results).toBeDefined()
    expect(Array.isArray(res.body.results)).toBe(true)
    expect(res.body.results.length).toBeGreaterThan(0)
    expect(res.body.results[0].title).toBe('Stellar Blockchain')
    expect(res.body.results[0].url).toBe('https://stellar.org')
    expect(res.body.count).toBe(2)
    expect(typeof res.body.latencyMs).toBe('number')
  })

  it('returns 403 when an invalid payment header is sent', async () => {
    const res = await request(app)
      .get('/search?q=stellar')
      .set('x-payment', 'invalid')
      .expect(403)

    expect(res.body.error).toBeDefined()
  })
})
