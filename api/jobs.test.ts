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

import jobsHandler, { jobStore, jobIdempotencyStore, validateWebhookUrl, signWebhookPayload } from './jobs'
import jobDetailHandler from './jobs/[id]'
import { resetConsumedPayments } from '../src/lib/paymentIntegrity'

function mockReqRes(overrides: any = {}) {
  const req: any = {
    method: 'POST',
    query: {},
    body: {},
    url: '/api/jobs',
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

describe('api/jobs & api/jobs/[id] — Serverless Async Jobs', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.clearAllMocks()
    resetConsumedPayments()
    jobStore.clear()
    jobIdempotencyStore.clear()
    global.fetch = originalFetch
  })

  it('handles OPTIONS preflight on /api/jobs and /api/jobs/[id]', async () => {
    const { req: req1, res: res1 } = mockReqRes({ method: 'OPTIONS' })
    await jobsHandler(req1, res1)
    expect(res1.status).toHaveBeenCalledWith(200)

    const { req: req2, res: res2 } = mockReqRes({ method: 'OPTIONS' })
    await jobDetailHandler(req2, res2)
    expect(res2.status).toHaveBeenCalledWith(200)
  })

  it('returns list of jobs on GET /api/jobs', async () => {
    jobStore.set('job-1', { id: 'job-1', createdAt: new Date().toISOString() })
    const { req, res } = mockReqRes({ method: 'GET' })
    await jobsHandler(req, res)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      count: 1,
      jobs: expect.arrayContaining([expect.objectContaining({ id: 'job-1' })]),
    }))
  })

  it('rejects unsupported HTTP methods', async () => {
    const { req: req1, res: res1 } = mockReqRes({ method: 'PUT' })
    await jobsHandler(req1, res1)
    expect(res1.status).toHaveBeenCalledWith(405)

    const { req: req2, res: res2 } = mockReqRes({ method: 'POST', query: { id: 'job-1' } })
    await jobDetailHandler(req2, res2)
    expect(res2.status).toHaveBeenCalledWith(405)
  })

  it('validates query parameter on POST /api/jobs', async () => {
    const { req: req1, res: res1 } = mockReqRes({ method: 'POST', body: {} })
    await jobsHandler(req1, res1)
    expect(res1.status).toHaveBeenCalledWith(400)
    expect(res1._json.error).toContain('Missing required parameter: q')

    const { req: req2, res: res2 } = mockReqRes({ method: 'POST', body: { query: 'a'.repeat(300) } })
    await jobsHandler(req2, res2)
    expect(res2.status).toHaveBeenCalledWith(400)
    expect(res2._json.error).toContain('Query too long')
  })

  it('rejects missing or empty query', async () => {
    const { req, res } = mockReqRes({ method: 'POST', body: { query: '' } })
    await jobsHandler(req, res)
    expect(res._status).toBe(400)
    expect(res._json.error).toMatch(/Missing required parameter/)
  })

  it('validates webhookUrl and webhookSecret (SSRF protection & secret length)', () => {
    expect(validateWebhookUrl('http://example.com/webhook').ok).toBe(false)
    expect(validateWebhookUrl('https://localhost/webhook').ok).toBe(false)
    expect(validateWebhookUrl('https://127.0.0.1/webhook').ok).toBe(false)
    expect(validateWebhookUrl('https://10.0.0.1/webhook').ok).toBe(false)
    expect(validateWebhookUrl('https://192.168.1.1/webhook').ok).toBe(false)
    expect(validateWebhookUrl('https://user:pass@example.com/webhook').ok).toBe(false)
    expect(validateWebhookUrl('not-a-url').ok).toBe(false)
    expect(validateWebhookUrl('https://api.example.com/webhook').ok).toBe(true)

    const sig = signWebhookPayload('payload', 'mysecretkey123456')
    expect(sig).toBeDefined()
    expect(typeof sig).toBe('string')
  })

  it('returns 400 when webhookUrl is provided with invalid secret or SSRF url', async () => {
    const { req: req1, res: res1 } = mockReqRes({
      method: 'POST',
      body: { query: 'stellar', webhookUrl: 'http://insecure.com' },
    })
    await jobsHandler(req1, res1)
    expect(res1.status).toHaveBeenCalledWith(400)

    const { req: req2, res: res2 } = mockReqRes({
      method: 'POST',
      body: { query: 'stellar', webhookUrl: 'https://api.example.com/hook', webhookSecret: 'short' },
    })
    await jobsHandler(req2, res2)
    expect(res2.status).toHaveBeenCalledWith(400)
    expect(res2._json.error).toContain('webhookSecret required')
  })

  it('returns 402 PAYMENT-REQUIRED when payment header is missing', async () => {
    const { req, res } = mockReqRes({
      method: 'POST',
      body: { query: 'stellar blockchain' },
      headers: { host: 'localhost:3000' },
    })
    await jobsHandler(req, res)
    expect(res.status).toHaveBeenCalledWith(402)
    expect(res.setHeader).toHaveBeenCalledWith('PAYMENT-REQUIRED', expect.any(String))
    expect(res._json.error).toBe('Payment required')
  })

  it('creates job, returns 202, and completes async search when payment header is valid', async () => {
    const paymentPayload = {
      transactionHash: 'a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0',
      from: 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3',
      amount: '0.001',
      network: 'stellar:testnet',
    }
    const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString('base64')

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        organic: [
          { title: 'Stellar Org', link: 'https://stellar.org', snippet: 'Stellar network' },
        ],
      }),
    }) as any

    const { req, res } = mockReqRes({
      method: 'POST',
      body: { query: 'stellar lumens', count: 5, freshness: 'pw' },
      headers: {
        'x-payment': paymentHeader,
        host: 'localhost:3000',
        'x-forwarded-proto': 'https',
      },
    })

    await jobsHandler(req, res)
    expect(res.status).toHaveBeenCalledWith(202)
    expect(res._json.jobId).toBeDefined()
    expect(res._json.paymentVerified).toBe(true)

    const jobId = res._json.jobId

    // Allow async execution to tick
    await new Promise((r) => setTimeout(r, 50))

    // Query job details via /api/jobs/[id]
    const { req: detailReq, res: detailRes } = mockReqRes({
      method: 'GET',
      query: { id: jobId },
    })
    await jobDetailHandler(detailReq, detailRes)
    expect(detailRes.json).toHaveBeenCalledWith(expect.objectContaining({
      job: expect.objectContaining({
        id: jobId,
        status: 'completed',
        result: expect.objectContaining({ count: 1 }),
      }),
      paymentVerified: true,
    }))
  })

  it('creates job and populates query correction metadata on execution', async () => {
    const paymentPayload = {
      transactionHash: 'c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef02',
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
    }) as any

    const { req, res } = mockReqRes({
      method: 'POST',
      body: { query: 'stelarr blockchan' },
      headers: {
        'x-payment': paymentHeader,
        host: 'localhost:3000',
        'x-forwarded-proto': 'https',
      },
    })

    await jobsHandler(req, res)
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

  it('handles idempotency replay on POST /api/jobs', async () => {
    const paymentPayload = {
      transactionHash: 'b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef01',
      from: 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3',
      amount: '0.001',
      network: 'stellar:testnet',
    }
    const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString('base64')

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ organic: [] }),
    }) as any

    const idempotencyKey = 'idem-job-test-key-1'
    const { req: req1, res: res1 } = mockReqRes({
      method: 'POST',
      body: { query: 'stellar query', idempotencyKey },
      headers: { 'x-payment': paymentHeader, host: 'localhost:3000' },
    })

    await jobsHandler(req1, res1)
    expect(res1.status).toHaveBeenCalledWith(202)

    // Second request with same idempotency key returns 200 with existing job
    const { req: req2, res: res2 } = mockReqRes({
      method: 'POST',
      body: { query: 'stellar query', idempotencyKey },
      headers: { host: 'localhost:3000' },
    })
    await jobsHandler(req2, res2)
    expect(res2.status).toHaveBeenCalledWith(200)
    expect(res2._json.jobId).toBe(res1._json.jobId)
  })

  it('handles /api/jobs/[id] 400 on missing id and 404 on unknown id', async () => {
    const { req: req1, res: res1 } = mockReqRes({ method: 'GET', query: {} })
    await jobDetailHandler(req1, res1)
    expect(res1.status).toHaveBeenCalledWith(400)

    const { req: req2, res: res2 } = mockReqRes({ method: 'GET', query: { id: 'non-existent-id' } })
    await jobDetailHandler(req2, res2)
    expect(res2.status).toHaveBeenCalledWith(404)
  })
})