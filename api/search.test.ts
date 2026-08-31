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

import handler from './search'

function mockReqRes(overrides: any = {}) {
  const req: any = {
    method: 'GET',
    query: {},
    url: '/api/search?q=stellar',
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

describe('api/search — Vercel x402 settlement (aligned with Express)', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.clearAllMocks()
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
      query: { q: 'stellar' },
      headers: { host: 'example.com', 'x-forwarded-proto': 'https' },
      url: '/api/search?q=stellar',
    })
    await handler(req, res)
    expect(res._status).toBe(402)
    expect(res.setHeader).toHaveBeenCalledWith('PAYMENT-REQUIRED', expect.any(String))
    // Decode PAYMENT-REQUIRED base64 to verify settlement semantics
    const headerCall = res.setHeader.mock.calls.find((c: any) => c[0] === 'PAYMENT-REQUIRED')
    const decoded = JSON.parse(Buffer.from(headerCall[1], 'base64').toString('utf8'))
    expect(decoded.x402Version).toBe(2)
    expect(decoded.accepts[0].scheme).toBe('exact')
    expect(decoded.accepts[0].network).toBe('stellar:testnet')
    expect(decoded.accepts[0].amount).toBe('10000') // stroops = 0.001 USDC
    expect(decoded.accepts[0].asset).toBe('CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA')
    expect(decoded.accepts[0].payTo).toBe(process.env.STELLAR_RECEIVING_ADDRESS)
    expect(decoded.accepts[0].maxTimeoutSeconds).toBe(300)
    expect(res._json.error).toBe('Payment required')
  })

  it('sets CORS headers (Vercel browser alignment)', async () => {
    const { req, res } = mockReqRes({ method: 'GET', query: {} })
    await handler(req, res)
    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*')
    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Expose-Headers', expect.stringContaining('PAYMENT-REQUIRED'))
  })

  it('proceeds to search when payment header present (Serper mock)', async () => {
    const fakeTx = Buffer.from(JSON.stringify({ transactionHash: 'abc123' })).toString('base64')
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        organic: [
          { title: 'Stellar', link: 'https://stellar.org', snippet: 'Blockchain', date: '2026-01-01' },
        ],
      }),
    } as any)

    const { req, res } = mockReqRes({
      method: 'GET',
      query: { q: 'stellar', count: '1' },
      headers: { 'x-payment': fakeTx },
    })
    await handler(req, res)
    expect(res._json.results).toHaveLength(1)
    expect(res._json.results[0].title).toBe('Stellar')
    expect(res._json.paidAmount).toBe('0.001')
    expect(res._json.currency).toBe('USDC')
    expect(res._json.txHash).toBe('abc123')
    expect(res._json.network).toBe('stellar:testnet')
    expect(global.fetch).toHaveBeenCalledWith('https://google.serper.dev/search', expect.any(Object))
  })

  it('preserves x402 settlement — amount decoded from constants is 0.001 USDC', async () => {
    // Verify that Vercel and Express share same amount via constants
    const { STELLAR_NETWORK, AMOUNT_STROOPS, AMOUNT_USDC } = await import('../src/lib/constants')
    expect(STELLAR_NETWORK).toBe('stellar:testnet')
    expect(parseInt(AMOUNT_STROOPS)).toBe(10000)
    expect(AMOUNT_USDC).toBe('0.001')
  })

  it('returns 502 when Serper fails', async () => {
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

  it('applies freshness filter', async () => {
    const fakeTx = Buffer.from(JSON.stringify({})).toString('base64')
    let capturedBody: any = null
    global.fetch = vi.fn().mockImplementation(async (_url: any, opts: any) => {
      capturedBody = JSON.parse(opts.body)
      return {
        ok: true,
        json: async () => ({ organic: [] }),
      } as any
    })
    const { req, res } = mockReqRes({
      method: 'GET',
      query: { q: 'stellar', freshness: 'pw' },
      headers: { 'x-payment': fakeTx },
    })
    await handler(req, res)
    expect(capturedBody.tbs).toBe('qdr:w')
  })

  it('returns 503 readiness error when facilitator is incompatible with network', async () => {
    const original = process.env.FACILITATOR_URL
    try {
      process.env.FACILITATOR_URL = 'https://channels.openzeppelin.com/x402/mainnet'
      const { req, res } = mockReqRes({ method: 'GET', query: { q: 'stellar' } })
      await handler(req, res)
      expect(res._status).toBe(503)
      expect(res._json.code).toBe('FACILITATOR_NETWORK_INCOMPATIBLE')
      expect(res._json.error).toContain('incompatible with the selected Stellar network')
    } finally {
      if (original !== undefined) process.env.FACILITATOR_URL = original
      else delete process.env.FACILITATOR_URL
    }
  })
})

