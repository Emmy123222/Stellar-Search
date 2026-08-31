import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.hoisted(() => {
  process.env.STELLAR_RECEIVING_ADDRESS = 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3'
  process.env.SERPER_API_KEY = 'test-serper'
})

vi.mock('../src/lib/constants', async () => {
  const actual: any = await vi.importActual('../src/lib/constants')
  return {
    ...actual,
    STELLAR_NETWORK: 'stellar:testnet',
    USDC_CONTRACT: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
    AMOUNT_STROOPS: '10000',
    AMOUNT_USDC: '0.001',
  }
})

import handler from './images'
import { resetConsumedPayments } from '../src/lib/paymentIntegrity'

function mockReqRes(overrides: any = {}) {
  const req: any = {
    method: 'GET',
    query: {},
    url: '/api/images?q=stellar',
    ...overrides,
    headers: { ...(overrides.headers || {}) },
  }
  const res: any = {}
  res.setHeader = vi.fn()
  res.status = vi.fn().mockImplementation((code: number) => {
    res._status = code
    return res
  })
  res.json = vi.fn().mockImplementation((data: any) => {
    res._json = data
    return res
  })
  res.end = vi.fn()
  return { req, res }
}

describe('api/images — Vercel x402 image search endpoint', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.clearAllMocks()
    resetConsumedPayments()
    global.fetch = originalFetch
  })

  it('handles OPTIONS preflight', async () => {
    const { req, res } = mockReqRes({ method: 'OPTIONS' })
    await handler(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.end).toHaveBeenCalled()
  })

  it('rejects non-GET methods', async () => {
    const { req, res } = mockReqRes({ method: 'POST' })
    await handler(req, res)
    expect(res._status).toBe(405)
    expect(res._json.error).toMatch(/Method not allowed/)
  })

  it('rejects missing q', async () => {
    const { req, res } = mockReqRes({ method: 'GET', query: {} })
    await handler(req, res)
    expect(res._status).toBe(400)
    expect(res._json.error).toMatch(/Missing required parameter/)
  })

  it('rejects whitespace q', async () => {
    const { req, res } = mockReqRes({ method: 'GET', query: { q: '   ' } })
    await handler(req, res)
    expect(res._status).toBe(400)
  })

  it('returns 402 Payment Required with x402 v2 payload when no payment header', async () => {
    const { req, res } = mockReqRes({
      method: 'GET',
      query: { q: 'stellar lumens' },
      headers: { host: 'example.com', 'x-forwarded-proto': 'https' },
      url: '/api/images?q=stellar+lumens',
    })
    await handler(req, res)
    expect(res._status).toBe(402)
    expect(res.setHeader).toHaveBeenCalledWith('PAYMENT-REQUIRED', expect.any(String))
    const headerCall = res.setHeader.mock.calls.find((c: any) => c[0] === 'PAYMENT-REQUIRED')
    const decoded = JSON.parse(Buffer.from(headerCall[1], 'base64').toString('utf8'))
    expect(decoded.x402Version).toBe(2)
    expect(decoded.resource.description).toContain('image search')
    expect(decoded.accepts[0].scheme).toBe('exact')
    expect(decoded.accepts[0].network).toBe('stellar:testnet')
    expect(decoded.accepts[0].amount).toBe('10000')
    expect(decoded.accepts[0].asset).toBe('CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA')
    expect(decoded.accepts[0].payTo).toBe(process.env.STELLAR_RECEIVING_ADDRESS)
    expect(decoded.accepts[0].maxTimeoutSeconds).toBe(300)
    expect(res._json.error).toBe('Payment required')
  })

  it('sets CORS headers', async () => {
    const { req, res } = mockReqRes({ method: 'GET', query: {} })
    await handler(req, res)
    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*')
    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Expose-Headers', expect.stringContaining('PAYMENT-REQUIRED'))
  })

  it('proceeds to image search when payment header present (Serper mock)', async () => {
    const fakeTx = Buffer.from(JSON.stringify({ transactionHash: 'tx_img_123' })).toString('base64')
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        images: [
          {
            title: 'Stellar Logo',
            imageUrl: 'https://stellar.org/logo.png',
            thumbnailUrl: 'https://stellar.org/thumb.png',
            link: 'https://stellar.org',
            imageWidth: 800,
            imageHeight: 600,
          },
        ],
      }),
    } as any)

    const { req, res } = mockReqRes({
      method: 'GET',
      query: { q: 'stellar logo', count: '5' },
      headers: { 'x-payment': fakeTx },
    })
    await handler(req, res)
    expect(res._json.results).toHaveLength(1)
    expect(res._json.results[0].title).toBe('Stellar Logo')
    expect(res._json.results[0].imageUrl).toBe('https://stellar.org/logo.png')
    expect(res._json.results[0].source).toBe('stellar.org')
    expect(res._json.paidAmount).toBe('0.001')
    expect(res._json.currency).toBe('USDC')
    expect(res._json.txHash).toBe('tx_img_123')
    expect(res._json.network).toBe('stellar:testnet')
    expect(global.fetch).toHaveBeenCalledWith('https://google.serper.dev/images', expect.any(Object))
  })

  it('returns 502 when Serper image search fails', async () => {
    const fakeTx = Buffer.from(JSON.stringify({ txHash: 'x' })).toString('base64')
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'serper error',
    } as any)
    const { req, res } = mockReqRes({
      method: 'GET',
      query: { q: 'stellar' },
      headers: { 'x-payment': fakeTx },
    })
    await handler(req, res)
    expect(res._status).toBe(502)
  })

  it('rejects replayed payment headers for image search', async () => {
    const fakeTx = Buffer.from(JSON.stringify({ transactionHash: 'tx_img_replay_123' })).toString('base64')
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ images: [] }),
    } as any)

    const first = mockReqRes({
      method: 'GET',
      query: { q: 'stellar' },
      headers: { 'x-payment': fakeTx },
    })
    await handler(first.req, first.res)
    expect(first.res._json.query).toBe('stellar')

    const second = mockReqRes({
      method: 'GET',
      query: { q: 'stellar' },
      headers: { 'x-payment': fakeTx },
    })
    await handler(second.req, second.res)
    expect(second.res._status).toBe(402)
    expect(second.res._json.error).toBe('Payment payload already consumed')
  })

  it('concurrency test: ensures only one image search proceeds for duplicate payload', async () => {
    const fakeTx = Buffer.from(JSON.stringify({ transactionHash: 'tx_img_concurrent_456' })).toString('base64')
    global.fetch = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return {
        ok: true,
        json: async () => ({ images: [{ title: 'Stellar Image', imageUrl: 'https://stellar.org/img.png' }] }),
      } as any
    })

    const numConcurrent = 4
    const pairs = Array.from({ length: numConcurrent }, () =>
      mockReqRes({
        method: 'GET',
        query: { q: 'stellar' },
        headers: { 'x-payment': fakeTx },
      })
    )

    await Promise.all(pairs.map((p) => handler(p.req, p.res)))
    expect(global.fetch).toHaveBeenCalledTimes(1)

    const successes = pairs.filter((p) => p.res._json?.results)
    const rejections = pairs.filter((p) => p.res._status === 402 && p.res._json?.error === 'Payment payload already consumed')

    expect(successes).toHaveLength(1)
    expect(rejections).toHaveLength(numConcurrent - 1)
  })
})
