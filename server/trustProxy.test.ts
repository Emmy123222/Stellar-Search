// @vitest-environment node
/**
 * server/trustProxy.test.ts
 *
 * Proves the Express trust-proxy configuration drives how express-rate-limit
 * identifies clients behind a reverse proxy (Vercel, nginx, load balancer):
 *
 *   - The number of trusted hops is explicit and configurable per deployment
 *     via TRUST_PROXY_HOPS (unset/0 => no proxy trusted; <n> => trust n hops;
 *     true => trust all).
 *   - Distinct clients behind a trusted proxy are limited separately.
 *   - Spoofed X-Forwarded-For headers cannot bypass the limits: when no proxy
 *     is trusted (default), req.ip ignores XFF entirely, so a single client
 *     that flips the header cannot multiply its allowance.
 */

import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'

// Mock x402 + heavy deps before importing app
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

// Fresh module graph (and fresh express-rate-limit store) per case so buckets
// never leak between tests. TRUST_PROXY_HOPS / RATE_LIMIT_PER_MINUTE are read
// at import time inside server/index.ts.
async function loadApp(
  trustProxyHops: string | undefined,
  rateLimitPerMinute = '3'
): Promise<any> {
  vi.resetModules()
  if (trustProxyHops === undefined) delete process.env.TRUST_PROXY_HOPS
  else process.env.TRUST_PROXY_HOPS = trustProxyHops
  process.env.RATE_LIMIT_PER_MINUTE = rateLimitPerMinute
  const mod = await import('./index.js')
  return mod.default
}

describe('trust proxy — explicit hop configuration', () => {
  it('defaults to NOT trusting any proxy (X-Forwarded-For ignored)', async () => {
    const app = await loadApp(undefined)
    expect(app.get('trust proxy')).toBe(false)
  })

  it('TRUST_PROXY_HOPS=<n> trusts exactly n hops', async () => {
    const app = await loadApp('1')
    expect(app.get('trust proxy')).toBe(1)
  })

  it('TRUST_PROXY_HOPS=true trusts all proxies', async () => {
    const app = await loadApp('true')
    expect(app.get('trust proxy')).toBe(true)
  })
})

describe('trust proxy — rate limiter client isolation', () => {
  it('distinct clients behind one trusted proxy each get their own bucket', async () => {
    const app = await loadApp('1', '2')

    // Client A uses its full allowance in its own bucket.
    await request(app).get('/health').set('X-Forwarded-For', '198.51.100.11')
    await request(app).get('/health').set('X-Forwarded-For', '198.51.100.11')
    const aThird = await request(app).get('/health').set('X-Forwarded-For', '198.51.100.11')
    expect(aThird.status).toBe(429)

    // Client B with a different forwarded IP is a separate bucket → allowed.
    const b = await request(app).get('/health').set('X-Forwarded-For', '198.51.100.22')
    expect(b.status).toBe(200)
  })

  it('with no trusted proxy, spoofed X-Forwarded-For headers do not bypass the limit', async () => {
    const app = await loadApp(undefined, '2')

    // Two allowed requests, each carrying a DIFFERENT spoofed upstream address.
    await request(app).get('/health').set('X-Forwarded-For', '203.0.113.1')
    await request(app).get('/health').set('X-Forwarded-For', '203.0.113.2')

    // A third request with yet another spoofed address must still be limited:
    // with trust proxy disabled, req.ip ignores XFF, so every request maps to
    // the single real client socket and shares one bucket.
    const res = await request(app).get('/health').set('X-Forwarded-For', '203.0.113.9')
    expect(res.status).toBe(429)
    expect(res.body.error).toMatch(/Too many requests/)
  })

  it('a trusted client that legitimately passes the limit is not blocked', async () => {
    const app = await loadApp('1', '5')
    for (let i = 0; i < 5; i++) {
      const res = await request(app).get('/health').set('X-Forwarded-For', '10.0.0.7')
      expect(res.status).toBe(200)
    }
    // Sixth request in the same bucket over the limit.
    const blocked = await request(app).get('/health').set('X-Forwarded-For', '10.0.0.7')
    expect(blocked.status).toBe(429)
  })
})
