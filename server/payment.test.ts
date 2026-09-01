/**
 * server/payment.test.ts
 *
 * Offline protocol tests for x402 payment flows on Express routes.
 * All scenarios run without a private key, real transfer, or network call.
 *
 * Scenarios covered:
 *   - challenge   : validation gate returns 400 for bad queries
 *   - settle      : valid payment passes and returns search results
 *   - reject      : Serper upstream errors propagate with correct status codes
 *   - expire      : payment consumed outside validity window is accepted again
 *   - replay      : same tx hash rejected within validity window
 *   - malformed   : garbled / truncated / wrong-type receipt headers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'

// ─── Mock x402 + heavy deps before app import ───────────────────────────────
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

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeReceipt(txHash: string): string {
  return Buffer.from(JSON.stringify({ transactionHash: txHash })).toString('base64')
}

const SERPER_STUB = {
  organic: [
    { title: 'Stellar', link: 'https://stellar.org', snippet: 'Blockchain for the internet', date: '2026-01-01' },
  ],
}

function mockFetchOk() {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => SERPER_STUB,
  } as any)
}

// ─── Setup ───────────────────────────────────────────────────────────────────

let app: any

beforeEach(async () => {
  vi.resetModules()

  const { resetConsumedPayments } = await import('../src/lib/paymentIntegrity')
  resetConsumedPayments()

  const mod = await import('./index.js')
  app = mod.default

  global.fetch = mockFetchOk()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── Challenge ───────────────────────────────────────────────────────────────

describe('challenge — query validation gate (pre-payment)', () => {
  it('returns 400 when q is missing', async () => {
    const res = await request(app).get('/search')
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Missing required parameter/)
  })

  it('returns 400 when q is whitespace', async () => {
    const res = await request(app).get('/search?q=%20%20')
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Missing required parameter/)
  })

  it('returns 400 when q exceeds 256 characters', async () => {
    const res = await request(app).get(`/search?q=${'a'.repeat(257)}`)
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Query too long/)
  })

  it('returns 400 for q that is only control characters', async () => {
    const res = await request(app).get('/search?q=%00%01%1F')
    expect(res.status).toBe(400)
  })

  it('challenge also fires on /images missing q', async () => {
    const res = await request(app).get('/images')
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Missing required parameter/)
  })

  it('challenge also fires on /news missing q', async () => {
    const res = await request(app).get('/news')
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Missing required parameter/)
  })
})

// ─── Settle ──────────────────────────────────────────────────────────────────

describe('settle — successful search after payment', () => {
  it('returns 200 with search results from Serper', async () => {
    const res = await request(app).get('/search?q=stellar').set('x-payment', makeReceipt('tx_settle_1'))
    expect(res.status).toBe(200)
    expect(res.body.results).toHaveLength(1)
    expect(res.body.results[0].title).toBe('Stellar')
  })

  it('response includes x402 settlement metadata', async () => {
    const res = await request(app).get('/search?q=stellar').set('x-payment', makeReceipt('tx_settle_meta'))
    expect(res.status).toBe(200)
    expect(res.body.paidAmount).toBe('0.001')
    expect(res.body.currency).toBe('USDC')
    expect(res.body.network).toMatch(/^stellar:/)
    expect(typeof res.body.latencyMs).toBe('number')
    expect(res.body.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('respects count param and returns correct result count', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        organic: Array.from({ length: 3 }, (_, i) => ({
          title: `Result ${i}`,
          link: `https://example.com/${i}`,
          snippet: 'desc',
        })),
      }),
    } as any)
    const res = await request(app).get('/search?q=stellar&count=3').set('x-payment', makeReceipt('tx_settle_count'))
    expect(res.status).toBe(200)
    expect(res.body.count).toBe(3)
  })

  it('settle on /images returns image results with x402 metadata', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        images: [{ title: 'Img', imageUrl: 'https://i.example.com/1.jpg', link: 'https://example.com' }],
      }),
    } as any)
    const res = await request(app).get('/images?q=stellar+logo').set('x-payment', makeReceipt('tx_settle_img'))
    expect(res.status).toBe(200)
    expect(res.body.results[0].imageUrl).toBe('https://i.example.com/1.jpg')
    expect(res.body.currency).toBe('USDC')
    expect(res.body.paidAmount).toBe('0.001')
  })

  it('settle on /news returns news results with x402 metadata', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        news: [{ title: 'News', link: 'https://news.example.com/1', snippet: 'Article', source: 'Example', date: '2026-01-01' }],
      }),
    } as any)
    const res = await request(app).get('/news?q=stellar').set('x-payment', makeReceipt('tx_settle_news'))
    expect(res.status).toBe(200)
    expect(res.body.results[0].title).toBe('News')
    expect(res.body.network).toMatch(/^stellar:/)
  })

  it('applies freshness filter pw → qdr:w when param is set', async () => {
    let capturedBody: any = null
    global.fetch = vi.fn().mockImplementation(async (_url: string, opts: any) => {
      capturedBody = JSON.parse(opts.body)
      return { ok: true, json: async () => ({ organic: [] }) } as any
    })
    const res = await request(app).get('/search?q=stellar&freshness=pw').set('x-payment', makeReceipt('tx_freshness'))
    expect(res.status).toBe(200)
    expect(capturedBody.tbs).toBe('qdr:w')
  })
})

// ─── Reject ───────────────────────────────────────────────────────────────────

describe('reject — upstream errors after payment header is present', () => {
  it('returns 502 when Serper responds 500', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'internal error' } as any)
    const res = await request(app).get('/search?q=stellar').set('x-payment', makeReceipt('tx_rej_500'))
    expect(res.status).toBe(502)
    expect(res.body.error).toMatch(/Serper/)
  })

  it('returns 502 when Serper responds 403 (bad API key)', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => 'forbidden' } as any)
    const res = await request(app).get('/search?q=stellar').set('x-payment', makeReceipt('tx_rej_403'))
    expect(res.status).toBe(502)
  })

  it('returns 502 when /images Serper responds with error', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => 'rate limited' } as any)
    const res = await request(app).get('/images?q=stellar').set('x-payment', makeReceipt('tx_rej_img'))
    expect(res.status).toBe(502)
  })

  it('returns 500 when fetch throws (network failure)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    const res = await request(app).get('/search?q=stellar').set('x-payment', makeReceipt('tx_rej_net'))
    expect(res.status).toBe(500)
  })
})

// ─── Replay ──────────────────────────────────────────────────────────────────

describe('replay — same payment cannot be re-used within validity window', () => {
  it('rejects same tx hash on second consumePaymentPayload call', async () => {
    const { consumePaymentPayload, resetConsumedPayments } = await import('../src/lib/paymentIntegrity')
    resetConsumedPayments()
    const receipt = makeReceipt('tx_replay_1')
    expect(consumePaymentPayload(receipt).ok).toBe(true)
    const second = consumePaymentPayload(receipt)
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error).toBe('Payment payload already consumed')
  })

  it('rejects 20 concurrent replay attempts — exactly one succeeds', async () => {
    const { consumePaymentPayload, resetConsumedPayments } = await import('../src/lib/paymentIntegrity')
    resetConsumedPayments()
    const receipt = makeReceipt('tx_replay_concurrent')
    const results = await Promise.all(
      Array.from({ length: 20 }, () => Promise.resolve().then(() => consumePaymentPayload(receipt)))
    )
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok)).toHaveLength(19)
  })

  it('rejects object-form receipt when base64 form already consumed', async () => {
    const { consumePaymentPayload, resetConsumedPayments } = await import('../src/lib/paymentIntegrity')
    resetConsumedPayments()
    const base64 = makeReceipt('tx_replay_dual')
    const obj = { transactionHash: 'tx_replay_dual' }
    expect(consumePaymentPayload(base64).ok).toBe(true)
    expect(consumePaymentPayload(obj).ok).toBe(false)
  })

  it('isPaymentConsumed returns true after consumption', async () => {
    const { consumePaymentPayload, isPaymentConsumed, resetConsumedPayments } = await import('../src/lib/paymentIntegrity')
    resetConsumedPayments()
    const receipt = makeReceipt('tx_replay_check')
    expect(isPaymentConsumed(receipt)).toBe(false)
    consumePaymentPayload(receipt)
    expect(isPaymentConsumed(receipt)).toBe(true)
  })
})

// ─── Expire ───────────────────────────────────────────────────────────────────

describe('expire — consumed payment accepted again after validity window', () => {
  it('re-allows a payment receipt after 300s validity window', async () => {
    const { consumePaymentPayload, resetConsumedPayments, DEFAULT_PAYMENT_VALIDITY_WINDOW_MS } =
      await import('../src/lib/paymentIntegrity')
    resetConsumedPayments()
    const receipt = makeReceipt('tx_expire_1')
    const t0 = 1_000_000
    expect(consumePaymentPayload(receipt, DEFAULT_PAYMENT_VALIDITY_WINDOW_MS, t0).ok).toBe(true)
    expect(consumePaymentPayload(receipt, DEFAULT_PAYMENT_VALIDITY_WINDOW_MS, t0 + 299_000).ok).toBe(false)
    expect(consumePaymentPayload(receipt, DEFAULT_PAYMENT_VALIDITY_WINDOW_MS, t0 + 301_000).ok).toBe(true)
  })

  it('DEFAULT_PAYMENT_VALIDITY_WINDOW_MS is 300_000ms (aligned with x402 maxTimeoutSeconds)', async () => {
    const { DEFAULT_PAYMENT_VALIDITY_WINDOW_MS } = await import('../src/lib/paymentIntegrity')
    expect(DEFAULT_PAYMENT_VALIDITY_WINDOW_MS).toBe(300_000)
  })

  it('cleanupExpiredPayments purges only expired entries', async () => {
    const { consumePaymentPayload, cleanupExpiredPayments, getConsumedPaymentsCount, resetConsumedPayments } =
      await import('../src/lib/paymentIntegrity')
    resetConsumedPayments()
    const t0 = 1_000_000
    consumePaymentPayload(makeReceipt('tx_short'), 1_000, t0)
    consumePaymentPayload(makeReceipt('tx_long'), 5_000, t0)
    expect(getConsumedPaymentsCount()).toBe(2)
    cleanupExpiredPayments(t0 + 2_000)
    expect(getConsumedPaymentsCount()).toBe(1)
    cleanupExpiredPayments(t0 + 6_000)
    expect(getConsumedPaymentsCount()).toBe(0)
  })
})

// ─── Malformed receipts ───────────────────────────────────────────────────────

describe('malformed — garbled, truncated, or wrong-type receipt headers', () => {
  it('null returns no paymentId', async () => {
    const { extractPaymentIdentifier } = await import('../src/lib/paymentIntegrity')
    expect(extractPaymentIdentifier(null)).toBeNull()
  })

  it('undefined returns no paymentId', async () => {
    const { extractPaymentIdentifier } = await import('../src/lib/paymentIntegrity')
    expect(extractPaymentIdentifier(undefined)).toBeNull()
  })

  it('empty string returns no paymentId', async () => {
    const { extractPaymentIdentifier } = await import('../src/lib/paymentIntegrity')
    expect(extractPaymentIdentifier('')).toBeNull()
    expect(extractPaymentIdentifier('   ')).toBeNull()
  })

  it('number type returns no paymentId', async () => {
    const { extractPaymentIdentifier } = await import('../src/lib/paymentIntegrity')
    expect(extractPaymentIdentifier(42 as any)).toBeNull()
  })

  it('boolean type returns no paymentId', async () => {
    const { extractPaymentIdentifier } = await import('../src/lib/paymentIntegrity')
    expect(extractPaymentIdentifier(true as any)).toBeNull()
  })

  it('truncated base64 falls back to SHA-256 hash identifier', async () => {
    const { extractPaymentIdentifier } = await import('../src/lib/paymentIntegrity')
    const truncated = makeReceipt('tx_trunc').slice(0, 10)
    expect(extractPaymentIdentifier(truncated)).toMatch(/^hash:[a-f0-9]{64}$/)
  })

  it('plain non-base64 string falls back to SHA-256 hash identifier', async () => {
    const { extractPaymentIdentifier } = await import('../src/lib/paymentIntegrity')
    expect(extractPaymentIdentifier('not-a-real-receipt')).toMatch(/^hash:[a-f0-9]{64}$/)
  })

  it('base64 JSON missing known id fields falls back to SHA-256', async () => {
    const { extractPaymentIdentifier } = await import('../src/lib/paymentIntegrity')
    const noId = Buffer.from(JSON.stringify({ randomField: 'value' })).toString('base64')
    expect(extractPaymentIdentifier(noId)).toMatch(/^hash:[a-f0-9]{64}$/)
  })

  it('two different malformed headers produce different identifiers', async () => {
    const { extractPaymentIdentifier } = await import('../src/lib/paymentIntegrity')
    expect(extractPaymentIdentifier('garbage-1')).not.toBe(extractPaymentIdentifier('garbage-2'))
  })

  it('consumePaymentPayload returns error for null header', async () => {
    const { consumePaymentPayload, resetConsumedPayments } = await import('../src/lib/paymentIntegrity')
    resetConsumedPayments()
    const result = consumePaymentPayload(null)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Invalid or missing/)
  })

  it('consumePaymentPayload accepts truncated base64 via hash fallback', async () => {
    const { consumePaymentPayload, resetConsumedPayments } = await import('../src/lib/paymentIntegrity')
    resetConsumedPayments()
    const truncated = makeReceipt('tx_trunc_consume').slice(0, 12)
    const result = consumePaymentPayload(truncated)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.paymentId).toMatch(/^hash:[a-f0-9]{64}$/)
  })
})

// ─── x402 settlement semantics ────────────────────────────────────────────────

describe('x402 settlement semantics — Express + Vercel constants aligned', () => {
  it('AMOUNT_STROOPS is 10000 (0.001 USDC)', async () => {
    const { AMOUNT_STROOPS, AMOUNT_USDC } = await import('../src/lib/constants')
    expect(parseInt(AMOUNT_STROOPS)).toBe(10_000)
    expect(AMOUNT_USDC).toBe('0.001')
  })

  it('STELLAR_NETWORK is a valid x402 network identifier', async () => {
    const { STELLAR_NETWORK } = await import('../src/lib/constants')
    expect(STELLAR_NETWORK).toMatch(/^stellar:(testnet|mainnet)$/)
  })

  it('USDC_CONTRACT is a valid Soroban contract address (starts with C, 56 chars)', async () => {
    const { USDC_CONTRACT } = await import('../src/lib/constants')
    expect(USDC_CONTRACT).toMatch(/^C[A-Z2-7]{55}$/)
  })

  it('settled /search response latencyMs is a non-negative number', async () => {
    const res = await request(app).get('/search?q=stellar').set('x-payment', makeReceipt('tx_latency'))
    expect(res.status).toBe(200)
    expect(res.body.latencyMs).toBeGreaterThanOrEqual(0)
  })
})

// ─── Upstream Serper payload validation ───────────────────────────────────────

describe('malformed upstream Serper payloads — server normalization', () => {
  it('handles null or non-object Serper responses safely (returns 200 with empty results)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => null,
    } as any)
    const res = await request(app).get('/search?q=stellar').set('x-payment', makeReceipt('tx_malformed_null'))
    expect(res.status).toBe(200)
    expect(res.body.results).toEqual([])
    expect(res.body.count).toBe(0)
  })

  it('skips organic rows missing valid HTTP/HTTPS link or containing malformed fields', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        organic: [
          { title: 'Bad Link 1', link: 'javascript:alert(1)' },
          { title: 'Valid Link', link: 'https://example.com/ok', snippet: 'Good' },
          { title: 'Missing Link' },
        ],
      }),
    } as any)
    const res = await request(app).get('/search?q=stellar').set('x-payment', makeReceipt('tx_malformed_organic'))
    expect(res.status).toBe(200)
    expect(res.body.results).toHaveLength(1)
    expect(res.body.results[0].title).toBe('Valid Link')
    expect(res.body.results[0].url).toBe('https://example.com/ok')
  })

  it('skips image rows missing valid imageUrl and handles malformed image dimensions', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        images: [
          { title: 'No Image', link: 'https://example.com' },
          { title: 'Valid Img', imageUrl: 'https://example.com/img.png', imageWidth: 'invalid' },
        ],
      }),
    } as any)
    const res = await request(app).get('/images?q=stellar').set('x-payment', makeReceipt('tx_malformed_img'))
    expect(res.status).toBe(200)
    expect(res.body.results).toHaveLength(1)
    expect(res.body.results[0].imageUrl).toBe('https://example.com/img.png')
    expect(res.body.results[0].width).toBeUndefined()
  })

  it('skips news rows missing valid link', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        news: [
          { title: 'Bad News', link: 'not-a-url' },
          { title: 'Good News', link: 'https://news.example.com/item' },
        ],
      }),
    } as any)
    const res = await request(app).get('/news?q=stellar').set('x-payment', makeReceipt('tx_malformed_news'))
    expect(res.status).toBe(200)
    expect(res.body.results).toHaveLength(1)
    expect(res.body.results[0].title).toBe('Good News')
  })
})

