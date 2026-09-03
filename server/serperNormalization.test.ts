/**
 * server/serperNormalization.test.ts
 *
 * End-to-end (Express) normalization + error-mapping tests for the paid
 * /search, /images, and /news routes against deterministic Serper payload
 * fixtures (server/serperFixtures.ts).
 *
 * Covers the edge cases the Serper engine actually produces: completely
 * empty result sets, missing/malformed fields, unsafe URLs, spelling
 * metadata, upstream provider errors, and network failures. Asserts the
 * *stable response shapes* clients rely on and that operator log output is
 * sanitized (no control characters / raw hostile upstream bodies).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'

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
  default: class { chat = { completions: { create: vi.fn() } } },
}))
vi.mock('./logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

process.env.STELLAR_RECEIVING_ADDRESS = 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3'
process.env.SERPER_API_KEY = 'test-serper-key'
process.env.GROQ_API_KEY = 'gsk_test'

import {
  organicEmpty,
  organicMissingFields,
  organicUnsafeUrls,
  organicMixed,
  organicSpellingCorrected,
  organicDidYouMean,
  organicNull,
  organicNotAnObject,
  organicWrongShape,
  imagesEmpty,
  imagesMissingFields,
  imagesUnsafeUrls,
  imagesMixed,
  imagesNull,
  imagesWrongShape,
  newsEmpty,
  newsMissingFields,
  newsUnsafeUrls,
  newsMixed,
  newsNull,
  newsWrongShape,
  upstreamErrors,
} from './serperFixtures'

let app: any
let receiptCounter = 0

function makeReceipt(txHash: string): string {
  return Buffer.from(JSON.stringify({ transactionHash: txHash })).toString('base64')
}

function nextReceipt(): string {
  receiptCounter += 1
  return makeReceipt(`tx_norm_${receiptCounter}`)
}

beforeEach(async () => {
  vi.resetModules()
  const { resetConsumedPayments } = await import('../src/lib/paymentIntegrity')
  resetConsumedPayments()
  const mod = await import('./index.js')
  app = mod.default
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => organicEmpty,
  } as any)
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── Organic (/search) ───────────────────────────────────────────────────────

describe('normalization — /search (organic family)', () => {
  it('returns 200 with empty, stable results for a completely empty organic array', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => organicEmpty } as any)
    const res = await request(app).get('/search?q=stellar+blockchain').set('x-payment', nextReceipt())
    expect(res.status).toBe(200)
    expect(res.body.results).toEqual([])
    expect(res.body.count).toBe(0)
    expect(res.body.query).toBe('stellar blockchain')
    expect(res.body.paidAmount).toBe('0.001')
    expect(res.body.currency).toBe('USDC')
  })

  it('handles null, non-object, and wrong-shape upstream payloads as empty results', async () => {
    for (const payload of [organicNull, organicNotAnObject, organicWrongShape]) {
      global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => payload } as any)
      const res = await request(app).get('/search?q=stellar').set('x-payment', nextReceipt())
      expect(res.status).toBe(200)
      expect(res.body.results).toEqual([])
      expect(res.body.count).toBe(0)
    }
  })

  it('produces deterministic fallbacks when optional fields are missing or wrong-typed', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => organicMissingFields } as any)
    const res = await request(app).get('/search?q=stellar').set('x-payment', nextReceipt())
    expect(res.status).toBe(200)
    expect(res.body.count).toBe(4)
    expect(res.body.results[0]).toEqual({
      id: '1',
      title: 'No title',
      url: 'https://example.com/bare',
      description: '',
      source: 'example.com',
      relevanceScore: 1,
      publishedAt: undefined,
    })
    expect(res.body.results[1].title).toBe('No title')          // numeric title
    expect(res.body.results[1].description).toBe('')
    expect(res.body.results[2].title).toBe('Date')              // numeric date -> no publishedAt
    expect(res.body.results[2].publishedAt).toBeUndefined()
    expect(res.body.results[3].title).toBe('No title')          // whitespace title
    // stable ids and monotonic relevance scores
    expect(res.body.results.map((r: any) => r.id)).toEqual(['1', '2', '3', '4'])
    expect(res.body.results[3].relevanceScore).toBeLessThan(res.body.results[2].relevanceScore)
  })

  it('drops every row whose link is not a valid http(s) URL', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => organicUnsafeUrls } as any)
    const res = await request(app).get('/search?q=stellar').set('x-payment', nextReceipt())
    expect(res.status).toBe(200)
    expect(res.body.results).toEqual([])
    expect(res.body.count).toBe(0)
  })

  it('keeps valid rows in order and skips unsafe/missing rows in a mixed payload', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => organicMixed } as any)
    const res = await request(app).get('/search?q=stellar').set('x-payment', nextReceipt())
    expect(res.status).toBe(200)
    expect(res.body.count).toBe(2)
    expect(res.body.results[0]).toEqual({
      id: '1',
      title: 'Valid One',
      url: 'https://example.com/one',
      description: 'First snippet',
      source: 'example.com',
      relevanceScore: 1,
      publishedAt: '2026-01-01',
    })
    expect(res.body.results[1]).toEqual({
      id: '2',
      title: 'Valid Two',
      url: 'https://www.example.com/two',
      description: 'Second description',
      source: 'example.com',
      relevanceScore: 0.94,
      publishedAt: undefined,
    })
  })

  it('exposes spelling-correction metadata (original/executed/suggested) deterministically', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => organicSpellingCorrected } as any)
    const res = await request(app).get('/search?q=stelarr+blockchan').set('x-payment', nextReceipt())
    expect(res.status).toBe(200)
    expect(res.body.originalQuery).toBe('stelarr blockchan')
    expect(res.body.executedQuery).toBe('stellar blockchain')
    expect(res.body.suggestedQuery).toBe('stellar blockchain')
    expect(res.body.isCorrected).toBe(true)
    expect(res.body.count).toBe(1)

    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => organicDidYouMean } as any)
    const res2 = await request(app).get('/search?q=stelarr+blockchan').set('x-payment', nextReceipt())
    expect(res2.body.suggestedQuery).toBe('stellar blockchain')
    expect(res2.body.isCorrected).toBe(false)
    expect(res2.body.executedQuery).toBe('stelarr blockchan')
  })
})

// ─── Images (/images) ────────────────────────────────────────────────────────

describe('normalization — /images (image family)', () => {
  it('returns 200 with empty results for empty / null / wrong-shape payloads', async () => {
    for (const payload of [imagesEmpty, imagesNull, imagesWrongShape]) {
      global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => payload } as any)
      const res = await request(app).get('/images?q=stellar').set('x-payment', nextReceipt())
      expect(res.status).toBe(200)
      expect(res.body.results).toEqual([])
      expect(res.body.count).toBe(0)
    }
  })

  it('applies fallbacks for missing thumbnails, links, and malformed dimensions', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => imagesMissingFields } as any)
    const res = await request(app).get('/images?q=stellar').set('x-payment', nextReceipt())
    expect(res.status).toBe(200)
    expect(res.body.count).toBe(4)
    expect(res.body.results[0]).toEqual({
      id: '1',
      title: 'No title',
      imageUrl: 'https://img.example.com/bare.png',
      thumbnailUrl: 'https://img.example.com/bare.png',
      sourceUrl: 'https://img.example.com/bare.png',
      source: 'img.example.com',
      width: undefined,
      height: undefined,
    })
    expect(res.body.results[2].title).toBe('No title')
    expect(res.body.results[2].width).toBeUndefined()   // 'wide'
    expect(res.body.results[2].height).toBeUndefined()  // -10
    expect(res.body.results[3].sourceUrl).toBe('https://img.example.com/bad-link.png')
    expect(res.body.results[3].source).toBe('img.example.com')
  })

  it('drops rows without a valid http(s) imageUrl', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => imagesUnsafeUrls } as any)
    const res = await request(app).get('/images?q=stellar').set('x-payment', nextReceipt())
    expect(res.status).toBe(200)
    expect(res.body.results).toEqual([])
  })

  it('normalizes a mixed image payload with a stable shape', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => imagesMixed } as any)
    const res = await request(app).get('/images?q=stellar').set('x-payment', nextReceipt())
    expect(res.status).toBe(200)
    expect(res.body.count).toBe(2)
    expect(res.body.results[0]).toEqual({
      id: '1',
      title: 'Stellar Logo',
      imageUrl: 'https://img.example.com/logo.png',
      thumbnailUrl: 'https://img.example.com/thumb.png',
      sourceUrl: 'https://www.example.com/page',
      source: 'example.com',
      width: 800,
      height: 600,
    })
    expect(res.body.results[1].thumbnailUrl).toBe('https://img.example.com/pic.png')
    expect(res.body.results[1].width).toBeUndefined()
    expect(res.body.paidAmount).toBe('0.001')
    expect(res.body.currency).toBe('USDC')
  })
})

// ─── News (/news) ────────────────────────────────────────────────────────────

describe('normalization — /news (news family)', () => {
  it('returns 200 with empty results for empty / null / wrong-shape payloads', async () => {
    for (const payload of [newsEmpty, newsNull, newsWrongShape]) {
      global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => payload } as any)
      const res = await request(app).get('/news?q=stellar').set('x-payment', nextReceipt())
      expect(res.status).toBe(200)
      expect(res.body.results).toEqual([])
      expect(res.body.count).toBe(0)
    }
  })

  it('applies deterministic fallbacks for missing snippets, sources, dates, and images', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => newsMissingFields } as any)
    const res = await request(app).get('/news?q=stellar').set('x-payment', nextReceipt())
    expect(res.status).toBe(200)
    expect(res.body.count).toBe(4)
    expect(res.body.results[0]).toEqual({
      id: '1',
      title: 'No title',
      url: 'https://news.example.com/bare',
      snippet: '',
      source: 'news.example.com',
      publishedAt: undefined,
      imageUrl: undefined,
    })
    expect(res.body.results[1].title).toBe('Headline')
    expect(res.body.results[1].snippet).toBe('')
    expect(res.body.results[2].title).toBe('Null Source')                    // null source -> hostname fallback
    expect(res.body.results[2].source).toBe('news.example.com')
    expect(res.body.results[2].imageUrl).toBeUndefined()                     // ftp image dropped
    expect(res.body.results[3].publishedAt).toBeUndefined()                  // numeric date dropped
  })

  it('drops news rows without a valid http(s) link', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => newsUnsafeUrls } as any)
    const res = await request(app).get('/news?q=stellar').set('x-payment', nextReceipt())
    expect(res.status).toBe(200)
    expect(res.body.results).toEqual([])
  })

  it('normalizes a mixed news payload with a stable shape', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => newsMixed } as any)
    const res = await request(app).get('/news?q=stellar').set('x-payment', nextReceipt())
    expect(res.status).toBe(200)
    expect(res.body.count).toBe(2)
    expect(res.body.results[0]).toEqual({
      id: '1',
      title: 'News Headline',
      url: 'https://news.stellar.org/article',
      snippet: 'Article snippet text',
      source: 'Stellar News',
      publishedAt: '2026-02-15',
      imageUrl: 'https://news.stellar.org/header.jpg',
    })
    expect(res.body.results[1].title).toBe('No title')
    expect(res.body.results[1].source).toBe('blog.example.com')
    expect(res.body.results[1].imageUrl).toBeUndefined()
  })
})

// ─── Upstream provider errors + sanitized operator logs ─────────────────────

describe('error mapping — upstream provider errors', () => {
  it('maps every upstream Serper status to a stable 502 with a sanitized error body', async () => {
    for (const fx of upstreamErrors) {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: fx.status,
        text: async () => fx.body,
      } as any)
      const res = await request(app).get('/search?q=stellar').set('x-payment', nextReceipt())
      expect(res.status).toBe(fx.expectedStatus)
      // User-facing body must never leak the raw upstream body
      expect(res.body.error).toBe(fx.expectedMessage)
      expect(res.body.error).not.toContain(fx.body)
    }
  })

  it('maps upstream errors on /images and /news the same way', async () => {
    for (const path of ['/images', '/news'] as const) {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => 'service unavailable' } as any)
      const res = await request(app).get(`${path}?q=stellar`).set('x-payment', nextReceipt())
      expect(res.status).toBe(502)
      expect(res.body.error).toBe('Serper.dev API error: 503')
    }
  })

  it('returns 500 (stable body) when fetch throws a network error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    for (const path of ['/search', '/images', '/news'] as const) {
      const res = await request(app).get(`${path}?q=stellar`).set('x-payment', nextReceipt())
      expect(res.status).toBe(500)
    }
  })

  it('sanitizes operator log output: no control characters or raw hostile upstream bodies', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const hostile = upstreamErrors[upstreamErrors.length - 1] // 502 with \x00 \x1b \x0a \x1f

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: hostile.status,
      text: async () => hostile.body,
    } as any)

    const res = await request(app).get('/search?q=stellar').set('x-payment', nextReceipt())
    expect(res.status).toBe(502)

    const serperLog = spy.mock.calls.find((c) => c[0] === '[serper]')
    expect(serperLog).toBeDefined()
    expect(serperLog![1]).toBe(502)
    const loggedText = String(serperLog![2])
    // Control characters (incl. \x1b ANSI escapes and raw newlines) must be gone
    expect(loggedText).not.toMatch(/[\x00-\x1F\x7F]/)
    expect(loggedText).not.toContain('\n')
    // Sanitized text keeps the visible content but collapses whitespace
    expect(loggedText).toContain('upstream')
    expect(loggedText).toContain('broken')
  })

  it('sanitizes generic search error logs as well', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    global.fetch = vi.fn().mockRejectedValue(new Error('boom\x1b[31mred\x0a'))

    await request(app).get('/search?q=stellar').set('x-payment', nextReceipt())

    const searchLog = spy.mock.calls.find((c) => c[0] === '[search error]')
    expect(searchLog).toBeDefined()
    expect(String(searchLog![1])).not.toMatch(/[\x00-\x1F\x7F]/)
  })
})
