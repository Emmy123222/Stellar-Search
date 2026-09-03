/**
 * x402Config.test.ts
 *
 * Validates that Express and Vercel runtimes emit identical payment requirements
 * built from the single shared x402Config module.
 *
 * Covers:
 *   - Network, asset, amount, payTo, timeout, fee sponsorship
 *   - Snapshot comparison of Express routes vs Vercel payment-required payload
 *   - Validation guards for malformed env values
 *   - x402 settlement semantics preservation
 */

import { describe, it, expect, beforeEach } from 'vitest'

// Ensure clean env before each test
const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV }
  process.env.STELLAR_RECEIVING_ADDRESS = 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3'
  process.env.STELLAR_NETWORK = 'stellar:testnet'
})

// ─── Shared config helpers ───────────────────────────────────────────────

import {
  getNetwork,
  getAsset,
  getAmount,
  getAmountUsdc,
  getPrice,
  getPayTo,
  buildPaymentRequirement,
  buildExpressRoutes,
  buildPaymentRequiredPayload,
  getFacilitatorUrl,
  getFullConfig,
} from './x402Config'

// ─── Individual field validation ─────────────────────────────────────────

describe('x402Config — individual field getters', () => {
  it('getNetwork returns stellar:testnet in test env', () => {
    expect(getNetwork()).toBe('stellar:testnet')
  })

  it('getAsset returns a valid Soroban contract address', () => {
    const asset = getAsset()
    expect(asset).toMatch(/^C[A-Z2-7]{55}$/)
  })

  it('getAmount returns "10000" (0.001 USDC in stroops)', () => {
    expect(getAmount()).toBe('10000')
  })

  it('getAmountUsdc returns "0.001"', () => {
    expect(getAmountUsdc()).toBe('0.001')
  })

  it('getPrice returns 0.001', () => {
    expect(getPrice()).toBe(0.001)
  })

  it('getPayTo returns the configured address', () => {
    const payTo = getPayTo()
    expect(payTo).toBe('GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3')
  })

  it('getPayTo uses override when provided', () => {
    const custom = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
    expect(getPayTo(custom)).toBe(custom)
  })

  it('getPayTo throws when address is invalid and no env', () => {
    delete process.env.STELLAR_RECEIVING_ADDRESS
    expect(() => getPayTo('INVALID')).toThrow(/STELLAR_RECEIVING_ADDRESS/)
  })

  it('getFacilitatorUrl returns default when env not set', () => {
    delete process.env.FACILITATOR_URL
    expect(getFacilitatorUrl()).toBe('https://www.x402.org/facilitator')
  })
})

// ─── buildPaymentRequirement ─────────────────────────────────────────────

describe('x402Config — buildPaymentRequirement', () => {
  it('returns a complete x402 v2 payment requirement', () => {
    const req = buildPaymentRequirement()
    expect(req).toEqual({
      scheme:            'exact',
      network:           'stellar:testnet',
      asset:             expect.stringMatching(/^C[A-Z2-7]{55}$/),
      amount:            '10000',
      payTo:             'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3',
      maxTimeoutSeconds: 300,
      extra:             { areFeesSponsored: true },
    })
  })

  it('uses override payTo when provided', () => {
    const custom = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
    const req = buildPaymentRequirement(custom)
    expect(req.payTo).toBe(custom)
  })
})

// ─── Express vs Vercel snapshot comparison ────────────────────────────────

describe('x402Config — Express and Vercel payment requirements are identical', () => {
  it('Express routes accept array has correct structure', () => {
    const routes = buildExpressRoutes()

    // Every Express route must contain the exact same payment option
    for (const route of Object.values(routes)) {
      expect(route.accepts).toHaveLength(1)
      const opt = route.accepts[0]
      expect(opt.scheme).toBe('exact')
      expect(opt.payTo).toBe('GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3')
      expect(opt.price).toBe(0.001)
      expect(opt.network).toBe('stellar:testnet')
    }
  })

  it('Vercel payment-required payload uses the same requirement', () => {
    const url = 'https://example.com/api/search?q=stellar'
    const payload = buildPaymentRequiredPayload(url)
    const requirement = buildPaymentRequirement()

    expect(payload.x402Version).toBe(2)
    expect(payload.accepts).toHaveLength(1)
    expect(payload.accepts[0]).toEqual(requirement)
  })

  it('snapshot: Express and Vercel share core fields (network, payTo, scheme, price/amount)', () => {
    const routes = buildExpressRoutes()
    const url = 'https://example.com/api/search?q=stellar'
    const payload = buildPaymentRequiredPayload(url)

    const expressOpt = routes['GET /search'].accepts[0]
    const vercelReq = payload.accepts[0]

    // Core fields must match exactly between runtimes
    expect(expressOpt.scheme).toBe(vercelReq.scheme)
    expect(expressOpt.payTo).toBe(vercelReq.payTo)
    expect(expressOpt.network).toBe(vercelReq.network)
    // Express uses price (number), Vercel uses amount (stroops string) — derived from same source
    expect(expressOpt.price).toBe(parseFloat(vercelReq.amount) / 10_000_000)
  })

  it('snapshot: all Express routes share identical payment option', () => {
    const routes = buildExpressRoutes()
    expect(routes['GET /search'].accepts[0]).toEqual(routes['GET /images'].accepts[0])
    expect(routes['GET /search'].accepts[0]).toEqual(routes['GET /news'].accepts[0])
  })

  it('snapshot: full config is stable across calls', () => {
    const config1 = getFullConfig()
    const config2 = getFullConfig()
    expect(config1).toEqual(config2)
  })

  it('snapshot: getFullConfig returns all required fields', () => {
    const config = getFullConfig()
    expect(config).toMatchObject({
      x402Version: 2,
      network: 'stellar:testnet',
      asset: expect.stringMatching(/^C[A-Z2-7]{55}$/),
      amount: '10000',
      price: 0.001,
      payTo: 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3',
      maxTimeoutSeconds: 300,
      extra: { areFeesSponsored: true },
      facilitatorUrl: 'https://www.x402.org/facilitator',
    })
    // Verify expressRoutes structure
    expect(Object.keys(config.expressRoutes)).toEqual(['GET /search', 'GET /images', 'GET /news'])
    for (const route of Object.values(config.expressRoutes)) {
      expect(route.accepts).toHaveLength(1)
      expect(route.accepts[0].scheme).toBe('exact')
      expect(route.accepts[0].price).toBe(0.001)
    }
  })
})

// ─── Settlement semantics ────────────────────────────────────────────────

describe('x402Config — settlement semantics preserved', () => {
  it('amount in stroops is 10^7 × USDC amount (Stellar 7 decimals)', () => {
    expect(parseInt(getAmount())).toBe(Math.round(getPrice() * 10_000_000))
  })

  it('asset is a Soroban contract (C prefix, 56 chars)', () => {
    expect(getAsset()).toMatch(/^C[A-Z2-7]{55}$/)
  })

  it('network is a valid x402 network identifier', () => {
    expect(getNetwork()).toMatch(/^stellar:(testnet|mainnet)$/)
  })

  it('maxTimeoutSeconds is 300 (5 minutes, aligned with paymentIntegrity)', () => {
    const req = buildPaymentRequirement()
    expect(req.maxTimeoutSeconds).toBe(300)
  })

  it('areFeesSponsored is true', () => {
    const req = buildPaymentRequirement()
    expect(req.extra.areFeesSponsored).toBe(true)
  })
})

// ─── Express routes structure ────────────────────────────────────────────

describe('x402Config — Express routes structure', () => {
  it('defines GET /search, GET /images, GET /news', () => {
    const routes = buildExpressRoutes()
    expect(Object.keys(routes)).toEqual([
      'GET /search',
      'GET /images',
      'GET /news',
    ])
  })

  it('each route has description and accepts', () => {
    const routes = buildExpressRoutes()
    for (const route of Object.values(routes)) {
      expect(typeof route.description).toBe('string')
      expect(route.description.length).toBeGreaterThan(0)
      expect(Array.isArray(route.accepts)).toBe(true)
      expect(route.accepts.length).toBe(1)
    }
  })
})

// ─── Vercel payment-required payload structure ────────────────────────────

describe('x402Config — Vercel payment-required payload', () => {
  it('has x402Version 2, error, resource, and accepts', () => {
    const url = 'https://example.com/api/search?q=test'
    const payload = buildPaymentRequiredPayload(url)
    expect(payload.x402Version).toBe(2)
    expect(payload.error).toBe('Payment required')
    expect(payload.resource.url).toBe(url)
    expect(payload.resource.mimeType).toBe('application/json')
    expect(Array.isArray(payload.accepts)).toBe(true)
  })
})
