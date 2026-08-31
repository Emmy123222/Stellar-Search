import { describe, expect, it, vi } from 'vitest'
import handler from './x402'

function mockResponse() {
  const res: any = {
    setHeader: vi.fn(),
    status: vi.fn().mockImplementation((code: number) => {
      res._status = code
      return res
    }),
    json: vi.fn().mockImplementation((body: unknown) => {
      res._json = body
      return res
    }),
  }
  return res
}

describe('Vercel x402 discovery handler', () => {
  it('returns a cacheable machine-readable document', async () => {
    const res = mockResponse()
    await handler({ method: 'GET', headers: { host: 'example.com', 'x-forwarded-proto': 'https' } } as any, res)

    expect(res._status).toBe(200)
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, max-age=300')
    expect(res._json.protocol).toBe('x402')
    expect(res._json.resourceTemplates).toHaveLength(3)
    expect(res._json.priceDiscoveryUrl).toBe('https://example.com/.well-known/x402')
  })

  it('only permits GET', async () => {
    const res = mockResponse()
    await handler({ method: 'POST', headers: {} } as any, res)
    expect(res._status).toBe(405)
    expect(res.setHeader).toHaveBeenCalledWith('Allow', 'GET')
  })
})
