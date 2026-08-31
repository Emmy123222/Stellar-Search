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

describe('api/images', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.clearAllMocks()
    resetConsumedPayments()
    global.fetch = originalFetch
  })

  it('rejects missing q', async () => {
    const { req, res } = mockReqRes({ method: 'GET', query: {} })
    await handler(req, res)
    expect(res._status).toBe(400)
    expect(res._json.error).toMatch(/Missing required parameter/)
  })

  it('returns 402 Payment Required when no payment header', async () => {
    const { req, res } = mockReqRes({
      method: 'GET',
      query: { q: 'stellar' },
      headers: { host: 'example.com', 'x-forwarded-proto': 'https' },
      url: '/api/images?q=stellar',
    })
    await handler(req, res)
    expect(res._status).toBe(402)
    expect(res.setHeader).toHaveBeenCalledWith('PAYMENT-REQUIRED', expect.any(String))
  })

  it('proceeds to search and applies safeSearch=moderate by default', async () => {
    const fakeTx = Buffer.from(JSON.stringify({ transactionHash: 'abc123' })).toString('base64')
    let capturedBody: any = null
    global.fetch = vi.fn().mockImplementation(async (_url: any, opts: any) => {
      capturedBody = JSON.parse(opts.body)
      return {
        ok: true,
        json: async () => ({ images: [] }),
      } as any
    })
    
    const { req, res } = mockReqRes({
      method: 'GET',
      query: { q: 'stellar' },
      headers: { 'x-payment': fakeTx },
    })
    await handler(req, res)
    
    expect(res._json.safeSearch).toBe('moderate')
    expect(capturedBody.safeSearch).toBe('moderate')
  })

  it('applies safeSearch=off when provided', async () => {
    const fakeTx = Buffer.from(JSON.stringify({ transactionHash: 'abc123' })).toString('base64')
    let capturedBody: any = null
    global.fetch = vi.fn().mockImplementation(async (_url: any, opts: any) => {
      capturedBody = JSON.parse(opts.body)
      return {
        ok: true,
        json: async () => ({ images: [] }),
      } as any
    })
    
    const { req, res } = mockReqRes({
      method: 'GET',
      query: { q: 'stellar', safeSearch: 'off' },
      headers: { 'x-payment': fakeTx },
    })
    await handler(req, res)
    
    expect(capturedBody.safeSearch).toBe('off')
    expect(res._json.safeSearch).toBe('off')
  })

  it('applies safeSearch=strict -> active when provided', async () => {
    const fakeTx = Buffer.from(JSON.stringify({ transactionHash: 'abc123' })).toString('base64')
    let capturedBody: any = null
    global.fetch = vi.fn().mockImplementation(async (_url: any, opts: any) => {
      capturedBody = JSON.parse(opts.body)
      return {
        ok: true,
        json: async () => ({ images: [] }),
      } as any
    })
    
    const { req, res } = mockReqRes({
      method: 'GET',
      query: { q: 'stellar', safeSearch: 'strict' },
      headers: { 'x-payment': fakeTx },
    })
    await handler(req, res)
    
    expect(capturedBody.safeSearch).toBe('active')
    expect(res._json.safeSearch).toBe('strict')
  })
})
