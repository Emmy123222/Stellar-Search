import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.hoisted(() => {
  process.env.STELLAR_RECEIVING_ADDRESS = 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3'
  process.env.SERPER_API_KEY = 'test-serper'
})

vi.mock('../../src/lib/constants', async () => {
  const actual: any = await vi.importActual('../../src/lib/constants')
  return {
    ...actual,
    STELLAR_NETWORK: 'stellar:testnet',
    USDC_CONTRACT: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
    AMOUNT_STROOPS: '10000',
    AMOUNT_USDC: '0.001',
  }
})

import batchHandler from './batch'
import { resetConsumedPayments } from '../../src/lib/paymentIntegrity'

function mockReqRes(overrides: any = {}) {
  const req: any = {
    method: 'POST',
    body: {},
    url: '/api/search/batch',
    ...overrides,
    headers: { ...(overrides.headers || {}) },
  }
  const chunks: string[] = []
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
  res.write = vi.fn().mockImplementation((chunk: string) => {
    chunks.push(chunk)
    return true
  })
  res.end = vi.fn().mockImplementation(() => {
    res.writableEnded = true
    return res
  })
  res._chunks = chunks
  return { req, res }
}

describe('api/search/batch — Serverless Batch Search JSONL', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.clearAllMocks()
    resetConsumedPayments()
    global.fetch = originalFetch
  })

  it('handles OPTIONS preflight and non-POST methods', async () => {
    const { req: req1, res: res1 } = mockReqRes({ method: 'OPTIONS' })
    await batchHandler(req1, res1)
    expect(res1.status).toHaveBeenCalledWith(200)
    expect(res1.end).toHaveBeenCalled()

    const { req: req2, res: res2 } = mockReqRes({ method: 'GET' })
    await batchHandler(req2, res2)
    expect(res2.status).toHaveBeenCalledWith(405)
    expect(res2._json.error).toMatch(/Method not allowed/)
  })

  it('validates queries payload and handles errors', async () => {
    const { req: req1, res: res1 } = mockReqRes({ method: 'POST', body: {} })
    await batchHandler(req1, res1)
    expect(res1.status).toHaveBeenCalledWith(400)
    expect(res1._json.error).toContain('queries array required')

    const { req: req2, res: res2 } = mockReqRes({
      method: 'POST',
      body: { queries: Array(15).fill('query') },
    })
    await batchHandler(req2, res2)
    expect(res2.status).toHaveBeenCalledWith(400)
    expect(res2._json.error).toContain('Batch too large')

    const { req: req3, res: res3 } = mockReqRes({
      method: 'POST',
      body: { queries: ['valid', ''] },
    })
    await batchHandler(req3, res3)
    expect(res3.status).toHaveBeenCalledWith(400)
    expect(res3._json.error).toContain('Invalid query')

    const { req: req4, res: res4 } = mockReqRes({
      method: 'POST',
      body: { queries: ['a'.repeat(300)] },
    })
    await batchHandler(req4, res4)
    expect(res4.status).toHaveBeenCalledWith(400)
    expect(res4._json.error).toContain('Query too long')

    const { req: req5, res: res5 } = mockReqRes({
      method: 'POST',
      body: { queries: ['\x00\x1F'] },
    })
    await batchHandler(req5, res5)
    expect(res5.status).toHaveBeenCalledWith(400)
    expect(res5._json.error).toContain('Query contains no valid characters')
  })

  it('rejects missing or empty queries array', async () => {
    const { req, res } = mockReqRes({ method: 'POST', body: { queries: [] } })
    await batchHandler(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res._json.error).toMatch(/queries array required/i)
  })

  it('returns 402 with quote when payment header is missing', async () => {
    const { req, res } = mockReqRes({
      method: 'POST',
      body: { queries: ['stellar', 'soroban'] },
      headers: { host: 'localhost:3000' },
    })
    await batchHandler(req, res)
    expect(res.status).toHaveBeenCalledWith(402)
    expect(res.setHeader).toHaveBeenCalledWith('PAYMENT-REQUIRED', expect.any(String))
    expect(res._json.error).toBe('Payment required')
    expect(res._json.quote).toMatchObject({
      type: 'quote',
      totalQueries: 2,
      totalAmount: '0.002',
    })
  })

  it('streams JSONL settlement, result, and done events when payment is provided', async () => {
    const paymentPayload = {
      transactionHash: 'c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef012',
      from: 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3',
      amount: '0.002',
      network: 'stellar:testnet',
    }
    const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString('base64')

    global.fetch = vi.fn().mockImplementation(async (_url, options: any) => {
      const body = JSON.parse(options.body)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          organic: [
            { title: `Result for ${body.q}`, link: `https://example.com/${body.q}`, snippet: `Snippet for ${body.q}` },
          ],
        }),
      }
    }) as any

    const { req, res } = mockReqRes({
      method: 'POST',
      body: { queries: ['stellar sdk', 'soroban rust'], freshness: 'pw', count: 3, idempotencyKey: 'idem-batch-1' },
      headers: {
        'x-payment': paymentHeader,
        host: 'localhost:3000',
      },
    })

    await batchHandler(req, res)
    expect(res.end).toHaveBeenCalled()

    const parsedEvents = res._chunks.map((line: string) => JSON.parse(line.trim()))
    expect(parsedEvents.some((e: any) => e.type === 'settlement')).toBe(true)
    expect(parsedEvents.filter((e: any) => e.type === 'result')).toHaveLength(2)
    expect(parsedEvents.some((e: any) => e.type === 'done')).toBe(true)

    // Replay with same idempotency key returns 409
    const { req: reqReplay, res: resReplay } = mockReqRes({
      method: 'POST',
      body: { queries: ['stellar sdk'], idempotencyKey: 'idem-batch-1' },
    })
    await batchHandler(reqReplay, resReplay)
    expect(resReplay.status).toHaveBeenCalledWith(409)
  })

  it('emits error event for failed query and continues remaining batch', async () => {
    const paymentPayload = {
      transactionHash: 'd4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0123',
      from: 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3',
      amount: '0.002',
      network: 'stellar:testnet',
    }
    const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString('base64')

    let callCount = 0
    global.fetch = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount === 1) {
        return {
          ok: false,
          status: 500,
          text: async () => 'upstream failure',
        }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ organic: [{ title: 'Success', link: 'https://example.com', snippet: 'text' }] }),
      }
    }) as any

    const { req, res } = mockReqRes({
      method: 'POST',
      body: { queries: ['failing query', 'succeeding query'] },
      headers: {
        'x-payment': paymentHeader,
        host: 'localhost:3000',
      },
    })

    await batchHandler(req, res)
    const parsedEvents = res._chunks.map((line: string) => JSON.parse(line.trim()))
    const errorEvt = parsedEvents.find((e: any) => e.type === 'error')
    expect(errorEvt).toBeDefined()
    expect(errorEvt.code).toBe('UPSTREAM_ERROR')

    const doneEvt = parsedEvents.find((e: any) => e.type === 'done')
    expect(doneEvt.succeeded).toBe(1)
    expect(doneEvt.failed).toBe(1)
  })

  it('processes batch search and streams query correction metadata when payment present', async () => {
    const paymentPayload = {
      transactionHash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      from: 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3',
      amount: '0.001',
      network: 'stellar:testnet',
    }
    const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString('base64')

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        searchParameters: { q: 'stellar blockchain' },
        searchInformation: { originalQuery: 'stelarr blockchan' },
        organic: [{ title: 'Stellar Docs', link: 'https://developers.stellar.org', snippet: 'Official docs' }],
      }),
    } as any)

    const { req, res } = mockReqRes({
      method: 'POST',
      body: { queries: ['stelarr blockchan'] },
      headers: { 'x-payment': paymentHeader, host: 'localhost:3000' },
    })

    await batchHandler(req, res)
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', expect.stringContaining('application/x-ndjson'))
    expect(res._chunks.length).toBeGreaterThan(0)

    const events = res._chunks.map((line: string) => JSON.parse(line.trim()))
    const resultEvt = events.find((e: any) => e.type === 'result')
    expect(resultEvt).toBeDefined()
    expect(resultEvt.originalQuery).toBe('stelarr blockchan')
    expect(resultEvt.executedQuery).toBe('stellar blockchain')
    expect(resultEvt.suggestedQuery).toBe('stellar blockchain')
    expect(resultEvt.isCorrected).toBe(true)

    const doneEvt = events.find((e: any) => e.type === 'done')
    expect(doneEvt).toBeDefined()
    expect(doneEvt.succeeded).toBe(1)
  })
})