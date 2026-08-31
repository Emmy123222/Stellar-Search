import { describe, it, expect, vi } from 'vitest'
import handler from './index'

describe('api/index — Vercel root API handler', () => {
  it('returns service metadata and endpoint descriptions', () => {
    const res: any = {
      json: vi.fn(),
    }
    const req: any = {}

    handler(req, res)

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'StellarSearch',
        version: '1.0.0',
        description: expect.stringContaining('x402 on Stellar'),
        endpoints: expect.objectContaining({
          'GET /api/search?q=<query>': expect.stringContaining('0.001 USDC via x402'),
          'POST /api/ai/chat': expect.any(String),
          'GET /api/health': expect.any(String),
        }),
      })
    )
  })
})
