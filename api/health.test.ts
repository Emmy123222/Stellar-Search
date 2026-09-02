import { describe, it, expect, vi, beforeEach } from 'vitest'
import handler from './health'
import {
  MEASURED_STAT_FIELDS,
  SERVERLESS_STATS_UNAVAILABLE_REASON,
  resolveStat,
  hasAnyStats,
} from '../src/lib/serverHealth'

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
    process.env.SERPER_API_KEY = 'test-serper'
    process.env.STELLAR_RECEIVING_ADDRESS = 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3'
  })

  it('returns ok with x402 payment config', async () => {
    process.env.STELLAR_NETWORK = 'stellar:testnet'
    process.env.FACILITATOR_URL = 'https://www.x402.org/facilitator'
    process.env.SERPER_API_KEY = 'test-serper'
    process.env.GROQ_API_KEY = 'gsk_test'
    process.env.STELLAR_RECEIVING_ADDRESS = 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3'

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

  it('fails fast when required core variables are missing', async () => {
    delete process.env.STELLAR_NETWORK
    delete process.env.FACILITATOR_URL
    delete process.env.SERPER_API_KEY
    delete process.env.GROQ_API_KEY
    delete process.env.STELLAR_RECEIVING_ADDRESS

    const req: any = { method: 'GET', headers: {} }
    const res = mockRes()

    expect(() => handler(req, res)).toThrow('STELLAR_RECEIVING_ADDRESS')
  })

  it('exposes timestamp as ISO string', async () => {
    const req: any = { method: 'GET', headers: {} }
    const res = mockRes()
    await handler(req, res)
    const payload = res.json.mock.calls[0][0]
    expect(payload.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
  // ─── Statistics declaration (#226) ────────────────────────────────────────
  // A Vercel function is stateless and scales to zero, so it cannot hold a
  // durable counter. Rather than omit the fields silently — which let the UI
  // render the absence as "0 queries, $0.00 settled" — it declares the gap.

  it('declares that it measures no activity statistics, with a reason', async () => {
    const req: any = { method: 'GET', headers: {} }
    const res = mockRes()
    await handler(req, res)
    const payload = res.json.mock.calls[0][0]

    expect(payload.statsSupported).toBe(false)
    expect(payload.unsupportedFields).toEqual([...MEASURED_STAT_FIELDS])
    expect(payload.statsUnavailableReason).toBe(SERVERLESS_STATS_UNAVAILABLE_REASON)
  })

  it('omits the counters entirely rather than reporting a fabricated zero', async () => {
    const req: any = { method: 'GET', headers: {} }
    const res = mockRes()
    await handler(req, res)
    const payload = res.json.mock.calls[0][0]

    for (const field of MEASURED_STAT_FIELDS) {
      expect(payload[field]).toBeUndefined()
    }
  })

  it('resolves every statistic as unavailable through the shared contract', async () => {
    const req: any = { method: 'GET', headers: {} }
    const res = mockRes()
    await handler(req, res)
    const payload = res.json.mock.calls[0][0]

    expect(hasAnyStats(payload)).toBe(false)
    for (const field of MEASURED_STAT_FIELDS) {
      expect(resolveStat(payload, field)).toEqual({
        available: false,
        reason: SERVERLESS_STATS_UNAVAILABLE_REASON,
      })
    }
  })

  it('still reports the configuration facts it genuinely knows', async () => {
    const req: any = { method: 'GET', headers: {} }
    const res = mockRes()
    await handler(req, res)
    const payload = res.json.mock.calls[0][0]

    // Declaring the counters unavailable must not weaken the settlement facts.
    expect(payload.status).toBe('ok')
    expect(payload.protocol).toBe('x402')
    expect(payload.pricePerQuery).toBe('0.001 USDC')
    expect(payload.network).toMatch(/^stellar:(testnet|mainnet)$/)
    expect(payload.receivingAddressConfigured).toBe(true)
  })
})
