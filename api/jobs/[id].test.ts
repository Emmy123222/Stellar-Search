import { describe, it, expect, beforeEach } from 'vitest'
import handler from './[id]'
import { jobStore } from '../jobs'

function mockReqRes(overrides: any = {}) {
  const req: any = {
    method: 'GET',
    query: {},
    headers: {},
    url: '/api/jobs/job-123',
    ...overrides,
  }
  const res: any = {
    _status: 200,
    setHeader: () => res,
    status: (code: number) => {
      res._status = code
      return res
    },
    json: (data: any) => {
      res._json = data
      return res
    },
    end: () => res,
  }
  return { req, res }
}

describe('api/jobs/[id] — Vercel job status handler', () => {
  beforeEach(() => {
    jobStore.clear()
  })

  it('handles OPTIONS preflight', async () => {
    const { req, res } = mockReqRes({ method: 'OPTIONS' })
    await handler(req, res)
    expect(res._status).toBe(200)
  })

  it('rejects non-GET methods', async () => {
    const { req, res } = mockReqRes({ method: 'DELETE' })
    await handler(req, res)
    expect(res._status).toBe(405)
    expect(res._json.error).toBe('Method not allowed')
  })

  it('returns 400 when id is missing', async () => {
    const { req, res } = mockReqRes({ query: {} })
    await handler(req, res)
    expect(res._status).toBe(400)
    expect(res._json.error).toBe('Missing job id')
  })

  it('returns 404 when job does not exist', async () => {
    const { req, res } = mockReqRes({ query: { id: 'non-existent' } })
    await handler(req, res)
    expect(res._status).toBe(404)
    expect(res._json.error).toBe('Job not found')
  })

  it('returns job details when job exists', async () => {
    jobStore.set('job-123', {
      id: 'job-123',
      query: 'stellar',
      status: 'completed',
      verified: true,
      statusUrl: '/api/jobs/job-123',
    } as any)

    const { req, res } = mockReqRes({ query: { id: 'job-123' } })
    await handler(req, res)
    expect(res._status).toBe(200)
    expect(res._json.job.id).toBe('job-123')
    expect(res._json.paymentVerified).toBe(true)
  })
})
