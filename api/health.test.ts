import { describe, it, expect, vi, beforeEach } from 'vitest'
import handler from './health'

function mockRes() {
  const res: any = {}
  res.json = vi.fn().mockReturnValue(res)
  res.status = vi.fn().mockReturnValue(res)
  res.setHeader = vi.fn()
  res.end = vi.fn()
  return res
}

describe('api/health — Vercel health aligned with server /health', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  it('returns ok with x402 payment config', async () => {
    process.env.STELLAR_NETWORK = 'stellar:testnet'
    process.env.FACILITATOR_URL = 'https://www.x402.org/facilitator'
    process.env.SERPER_API_KEY = 'test-serper'
    process.env.GROQ_API_KEY = 'gsk_test'
    process.env.STELLAR_RECEIVING_ADDRESS = 'GTEST'

    const req: any = { method: 'GET', headers: {} }
    const res = mockRes()

    await handler(req, res)

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ok',
        network: 'stellar:testnet',
        pricePerQuery: '0.001 USDC',
        protocol: 'x402',
        facilitator: 'https://www.x402.org/facilitator',
        serperApiConfigured: true,
        groqApiConfigured: true,
        receivingAddressConfigured: true,
      })
    )
  })

  it('uses defaults when env missing and preserves settlement semantics', async () => {
    delete process.env.STELLAR_NETWORK
    delete process.env.FACILITATOR_URL
    delete process.env.SERPER_API_KEY
    delete process.env.GROQ_API_KEY
    delete process.env.STELLAR_RECEIVING_ADDRESS

    const req: any = { method: 'GET', headers: {} }
    const res = mockRes()

    await handler(req, res)

    const payload = res.json.mock.calls[0][0]
    expect(payload.network).toBe('stellar:testnet')
    expect(payload.pricePerQuery).toBe('0.001 USDC')
    expect(payload.protocol).toBe('x402')
    expect(payload.serperApiConfigured).toBe(false)
    expect(payload.facilitator).toBe('https://www.x402.org/facilitator')
    expect(new Date(payload.timestamp).toString()).not.toBe('Invalid Date')
  })

  it('exposes timestamp as ISO string', async () => {
    const req: any = { method: 'GET', headers: {} }
    const res = mockRes()
    await handler(req, res)
    const payload = res.json.mock.calls[0][0]
    expect(payload.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
