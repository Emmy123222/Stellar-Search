import { describe, it, expect } from 'vitest'
import { getPricingRequirement } from '../src/lib/pricing'

describe('pricing tiers', () => {
  it('determines correct exact x402 requirement by mode and count', () => {
    const req = getPricingRequirement('search', 10)
    expect(req.priceUsdc).toBe('0.001')
  })
})
