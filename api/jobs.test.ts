import { describe, it, expect, vi, beforeEach } from 'vitest'
import handler, { jobStore } from './jobs'
import { resetConsumedPayments } from '../src/lib/paymentIntegrity'

function mockReqRes(overrides: any = {}) {
  const req: any = {
    method: 'POST',
    body: {},
    headers: {},
    url: '/api/jobs',
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
    end: vi.fn(),
  }
  return { req, res }
}

describe('api/jobs — Vercel jobs handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetConsumedPayments()
    jobStore.clear()
  })

  it('handles OPTIONS preflight', async () => {
    const { req, res } = mockReqRes({ method: 'OPTIONS' })
    await handler(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.end).toHaveBeenCalled()
  })

  it('rejects missing or empty query', async () => {
    const { req, res } = mockReqRes({ method: 'POST', body: { query: '' } })
    await handler(req, res)
    expect(res._status).toBe(400)
    expect(res._json.error).toMatch(/Missing required parameter/)
  })

  it('returns 402 Payment Required when payment header is missing', async () => {
    const { req, res } = mockReqRes({
      method: 'POST',
      body: { query: 'stellar x402' },
    })
    await handler(req, res)
    expect(res._status).toBe(402)
    expect(res.setHeader).toHaveBeenCalledWith('PAYMENT-REQUIRED', expect.any(String))
    expect(res._json.error).toBe('Payment required')
  })

  it('creates job (202) and populates query correction metadata on execution', async () => {
    const fakeTx = Buffer.from(JSON.stringify({ transactionHash: 'tx_job_test_1' })).toString('base64')
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
      body: { query: 'stelarr blockchan' },
      headers: { 'x-payment': fakeTx },
    })

    await handler(req, res)
    expect(res._status).toBe(202)
    expect(res._json.jobId).toBeDefined()
    expect(res._json.statusUrl).toContain('/api/jobs/')
    expect(res._json.paymentVerified).toBe(true)

    // Wait for async execution
    await new Promise((resolve) => setTimeout(resolve, 50))

    const job = jobStore.get(res._json.jobId)
    expect(job).toBeDefined()
    expect(job.status).toBe('completed')
    expect(job.result).toBeDefined()
    expect(job.result.originalQuery).toBe('stelarr blockchan')
    expect(job.result.executedQuery).toBe('stellar blockchain')
    expect(job.result.suggestedQuery).toBe('stellar blockchain')
    expect(job.result.isCorrected).toBe(true)
  })

  it('lists jobs on GET /api/jobs', async () => {
    jobStore.set('job-1', { id: 'job-1', query: 'test' } as any)
    const { req, res } = mockReqRes({ method: 'GET' })
    await handler(req, res)
    expect(res._status).toBe(200)
    expect(res._json.count).toBe(1)
    expect(res._json.jobs).toHaveLength(1)
  })
})
