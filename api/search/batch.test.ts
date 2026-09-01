import { describe, it, expect, vi, beforeEach } from 'vitest'
import handler from './batch'
import { resetConsumedPayments } from '../../src/lib/paymentIntegrity'

function mockReqRes(overrides: any = {}) {
  const chunks: string[] = []
  const req: any = {
    method: 'POST',
    body: {},
    headers: {},
    url: '/api/search/batch',
    on: vi.fn(),
    ...overrides,
  }
  const res: any = {
    _status: 200,
    setHeader: vi.fn(),
    status: vi.fn().mockImplementation((code: number) => {
      res._status = code
      return res
    }),
    json: vi.fn().mockImplementation((data: any) => {
      res._json = data
      return res
    }),
    write: vi.fn().mockImplementation((chunk: string) => {
      chunks.push(chunk)
      return true
    }),
    end: vi.fn(),
    _chunks: chunks,
  }
  return { req, res }
}

describe('api/search/batch — Vercel batch JSONL handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetConsumedPayments()
  })

  it('handles OPTIONS preflight', async () => {
    const { req, res } = mockReqRes({ method: 'OPTIONS' })
    await handler(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.end).toHaveBeenCalled()
  })

  it('rejects non-POST methods', async () => {
    const { req, res } = mockReqRes({ method: 'GET' })
    await handler(req, res)
    expect(res._status).toBe(405)
    expect(res._json.error).toMatch(/Method not allowed/)
  })

  it('rejects missing or empty queries array', async () => {
    const { req, res } = mockReqRes({ method: 'POST', body: { queries: [] } })
    await handler(req, res)
    expect(res._status).toBe(400)
    expect(res._json.error).toMatch(/queries array required/i)
  })

  it('returns 402 with quote when payment header missing', async () => {
    const { req, res } = mockReqRes({
      method: 'POST',
      body: { queries: ['stellar', 'soroban'] },
    })
    await handler(req, res)
    expect(res._status).toBe(402)
    expect(res.setHeader).toHaveBeenCalledWith('PAYMENT-REQUIRED', expect.any(String))
    expect(res._json.error).toBe('Payment required')
    expect(res._json.quote).toBeDefined()
    expect(res._json.quote.totalQueries).toBe(2)
  })

  it('processes batch search and streams query correction metadata when payment present', async () => {
    const fakeTx = Buffer.from(JSON.stringify({ transactionHash: 'tx_batch_test_1' })).toString('base64')
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        searchParameters: { q: 'stellar blockchain' },
        searchInformation: { originalQuery: 'stelarr blockchan' },
        organic: [{ title: 'Stellar Docs', link: 'https://developers.stellar.org', snippet: 'Official docs' }],
      }),
    } as any)

    const { req, res } = mockReqRes({
      method: 'POST',
      body: { queries: ['stelarr blockchan'] },
      headers: { 'x-payment': fakeTx },
    })

    await handler(req, res)
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', expect.stringContaining('application/x-ndjson'))
    expect(res._chunks.length).toBeGreaterThan(0)

    const events = res._chunks.map((c) => JSON.parse(c.trim()))
    const resultEvt = events.find((e) => e.type === 'result')
    expect(resultEvt).toBeDefined()
    expect(resultEvt.originalQuery).toBe('stelarr blockchan')
    expect(resultEvt.executedQuery).toBe('stellar blockchain')
    expect(resultEvt.suggestedQuery).toBe('stellar blockchain')
    expect(resultEvt.isCorrected).toBe(true)

    const doneEvt = events.find((e) => e.type === 'done')
    expect(doneEvt).toBeDefined()
    expect(doneEvt.succeeded).toBe(1)
  })
})
