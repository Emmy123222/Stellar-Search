import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  validateFacilitatorConfig,
  validateFacilitatorCompatibility,
  discoverFacilitatorCapabilities,
} from './facilitatorValidation'
import {
  USDC_CONTRACT_TESTNET,
  USDC_CONTRACT_MAINNET,
} from './constants'

describe('facilitatorValidation', () => {
  it('validates a correct testnet configuration', () => {
    const result = validateFacilitatorConfig({
      network: 'stellar:testnet',
      scheme: 'exact',
      asset: USDC_CONTRACT_TESTNET,
      facilitatorUrl: 'https://www.x402.org/facilitator',
    })

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.network).toBe('stellar:testnet')
    expect(result.scheme).toBe('exact')
    expect(result.asset).toBe(USDC_CONTRACT_TESTNET)
  })

  it('validates a correct mainnet configuration', () => {
    const result = validateFacilitatorConfig({
      network: 'stellar:mainnet',
      scheme: 'exact',
      asset: USDC_CONTRACT_MAINNET,
      facilitatorUrl: 'https://www.x402.org/facilitator',
    })

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('detects unsupported network', () => {
    const result = validateFacilitatorConfig({
      network: 'ethereum:mainnet',
      scheme: 'exact',
      asset: USDC_CONTRACT_TESTNET,
    })

    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('Unsupported network'))).toBe(true)
  })

  it('detects unsupported payment scheme', () => {
    const result = validateFacilitatorConfig({
      network: 'stellar:testnet',
      scheme: 'range',
      asset: USDC_CONTRACT_TESTNET,
    })

    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('Unsupported payment scheme'))).toBe(true)
  })

  it('detects mismatched asset contract address', () => {
    const result = validateFacilitatorConfig({
      network: 'stellar:testnet',
      scheme: 'exact',
      asset: USDC_CONTRACT_MAINNET, // Wrong asset for testnet
    })

    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('Mismatched asset contract'))).toBe(true)
  })

  it('detects invalid facilitator URL format', () => {
    const result = validateFacilitatorConfig({
      network: 'stellar:testnet',
      facilitatorUrl: 'not-a-valid-url',
    })

    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('Invalid facilitator URL'))).toBe(true)
  })

  it('detects non-http/https protocol', () => {
    const result = validateFacilitatorConfig({
      network: 'stellar:testnet',
      facilitatorUrl: 'ftp://facilitator.x402.org',
    })

    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('must use HTTP or HTTPS'))).toBe(true)
  })

  it('detects testnet facilitator URL paired with stellar:mainnet', () => {
    const result = validateFacilitatorConfig({
      network: 'stellar:mainnet',
      scheme: 'exact',
      asset: USDC_CONTRACT_MAINNET,
      facilitatorUrl: 'https://channels.openzeppelin.com/x402/testnet',
    })

    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('indicates a testnet endpoint'))).toBe(true)
  })

  it('detects mainnet facilitator URL paired with stellar:testnet', () => {
    const result = validateFacilitatorConfig({
      network: 'stellar:testnet',
      scheme: 'exact',
      asset: USDC_CONTRACT_TESTNET,
      facilitatorUrl: 'https://channels.openzeppelin.com/x402/mainnet',
    })

    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('indicates a mainnet endpoint'))).toBe(true)
  })

  it('detects /public facilitator URL paired with stellar:testnet', () => {
    const result = validateFacilitatorConfig({
      network: 'stellar:testnet',
      scheme: 'exact',
      asset: USDC_CONTRACT_TESTNET,
      facilitatorUrl: 'https://facilitator.stellar.org/public',
    })

    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('indicates a mainnet endpoint'))).toBe(true)
  })

  describe('discoverFacilitatorCapabilities', () => {
    const originalFetch = global.fetch

    afterEach(() => {
      global.fetch = originalFetch
    })

    it('returns capabilities when endpoint returns json metadata', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          networks: ['stellar:testnet', 'stellar:mainnet'],
          schemes: ['exact'],
          version: '2.0.0',
        }),
      })

      const res = await discoverFacilitatorCapabilities('https://www.x402.org/facilitator')
      expect(res.ok).toBe(true)
      expect(res.capabilities?.networks).toContain('stellar:testnet')
      expect(res.capabilities?.schemes).toContain('exact')
      expect(res.capabilities?.version).toBe('2.0.0')
    })

    it('handles non-200 responses gracefully', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
      })

      const res = await discoverFacilitatorCapabilities('https://www.x402.org/facilitator')
      expect(res.ok).toBe(false)
      expect(res.error).toContain('HTTP 502')
    })

    it('handles network / timeout errors', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'))

      const res = await discoverFacilitatorCapabilities('http://localhost:9999/facilitator')
      expect(res.ok).toBe(false)
      expect(res.error).toBe('Connection refused')
    })

    it('validateFacilitatorCompatibility flags network mismatch from discovered capabilities', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          networks: ['stellar:mainnet'], // Only supports mainnet
          schemes: ['exact'],
        }),
      })

      const res = await validateFacilitatorCompatibility(
        {
          network: 'stellar:testnet',
          scheme: 'exact',
          asset: USDC_CONTRACT_TESTNET,
          facilitatorUrl: 'https://www.x402.org/facilitator',
        },
        { discoverRemote: true }
      )

      expect(res.valid).toBe(false)
      expect(res.errors.some(e => e.includes('does not support network'))).toBe(true)
    })
  })
})
