import { describe, it, expect } from 'vitest'
import { STROOPS_PER_XLM, readFeeSponsorship, stroopsToXlm } from './feeSponsorship'

/**
 * Fee sponsorship & network-fee disclosure (#312).
 *
 * The challenge advertises `extra.areFeesSponsored`. The UI must state who pays
 * the Stellar network fee and any estimated payer fee the challenge provides —
 * and must not use optimistic copy when that metadata is missing or has
 * changed, because those cases require an explicit acknowledgement.
 */

const PAY_TO = 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3'

function challenge(extra: Record<string, unknown> | undefined, amount: unknown = '10000') {
  return {
    x402Version: 2,
    accepts: [{ scheme: 'exact', network: 'stellar:testnet', asset: 'C...', amount, payTo: PAY_TO, maxTimeoutSeconds: 300, extra }],
  }
}

describe('readFeeSponsorship — sponsored', () => {
  it('reports the sponsor as the payer and requires no acknowledgement', () => {
    const info = readFeeSponsorship(challenge({ areFeesSponsored: true }))

    expect(info.payer).toBe('sponsor')
    expect(info.areFeesSponsored).toBe(true)
    expect(info.requiresAcknowledgement).toBe(false)
    expect(info.acknowledgementReason).toBeNull()
    expect(info.changed).toBe(false)
  })

  it('states who pays and echoes the price from the challenge', () => {
    const info = readFeeSponsorship(challenge({ areFeesSponsored: true }))

    expect(info.priceUsdc).toBe('0.001')
    expect(info.label).toMatch(/sponsored/i)
    expect(info.detail).toMatch(/StellarSearch covers the Stellar network fee/i)
    expect(info.detail).toContain('0.001 USDC')
    expect(info.estimatedNetworkFeeXlm).toBeNull()
  })
})

describe('readFeeSponsorship — payer-funded', () => {
  it('reports the payer and requires no acknowledgement', () => {
    const info = readFeeSponsorship(challenge({ areFeesSponsored: false }))

    expect(info.payer).toBe('payer')
    expect(info.areFeesSponsored).toBe(false)
    expect(info.requiresAcknowledgement).toBe(false)
    expect(info.label).toMatch(/You pay network fees/i)
  })

  it('surfaces an estimated payer fee when the challenge states one', () => {
    const info = readFeeSponsorship(challenge({ areFeesSponsored: false, estimatedFeeStroops: 100 }))

    expect(info.estimatedNetworkFeeXlm).toBe('0.00001')
    expect(info.detail).toContain('0.00001 XLM')
  })

  it('accepts a string or aliased estimate and never invents one', () => {
    expect(readFeeSponsorship(challenge({ areFeesSponsored: false, estimatedFeeStroops: '250' })).estimatedNetworkFeeXlm).toBe('0.000025')
    expect(readFeeSponsorship(challenge({ areFeesSponsored: false, estimatedPayerFeeStroops: 10 })).estimatedNetworkFeeXlm).toBe('0.000001')
    expect(readFeeSponsorship(challenge({ areFeesSponsored: false, estimatedFeeStroops: 'lots' })).estimatedNetworkFeeXlm).toBeNull()
    expect(readFeeSponsorship(challenge({ areFeesSponsored: false })).estimatedNetworkFeeXlm).toBeNull()
  })

  it('says the estimate was not provided rather than guessing', () => {
    const info = readFeeSponsorship(challenge({ areFeesSponsored: false }))
    expect(info.detail).toMatch(/did not state an estimate/i)
  })
})

describe('readFeeSponsorship — unknown sponsorship', () => {
  it('never claims sponsorship when the field is absent', () => {
    for (const extra of [undefined, {}, { areFeesSponsored: 'yes' }, { areFeesSponsored: null }]) {
      const info = readFeeSponsorship(challenge(extra))

      expect(info.payer).toBe('unknown')
      expect(info.areFeesSponsored).toBeNull()
      expect(info.label).toMatch(/not stated/i)
      expect(info.label).not.toMatch(/sponsored by StellarSearch/i)
    }
  })

  it('requires explicit acknowledgement when sponsorship is unknown', () => {
    const info = readFeeSponsorship(challenge({}))

    expect(info.requiresAcknowledgement).toBe(true)
    expect(info.acknowledgementReason).toBe('unknown')
    expect(info.detail).toMatch(/does not state whether network fees are sponsored/i)
    expect(info.detail).toMatch(/unknown/i)
  })
})

describe('readFeeSponsorship — changed sponsorship', () => {
  it('flags a change from sponsored to unstated and requires acknowledgement', () => {
    const info = readFeeSponsorship(challenge({}), true)

    expect(info.changed).toBe(true)
    expect(info.requiresAcknowledgement).toBe(true)
    expect(info.acknowledgementReason).toBe('changed')
    expect(info.detail).toMatch(/different from the previous challenge/i)
  })

  it('flags a change from unstated to sponsored', () => {
    const info = readFeeSponsorship(challenge({ areFeesSponsored: true }), null)

    expect(info.changed).toBe(true)
    expect(info.requiresAcknowledgement).toBe(true)
    expect(info.acknowledgementReason).toBe('changed')
  })

  it('flags a change from sponsored to payer-funded', () => {
    const info = readFeeSponsorship(challenge({ areFeesSponsored: false }), true)

    expect(info.changed).toBe(true)
    expect(info.requiresAcknowledgement).toBe(true)
  })

  it('does not flag anything on the first challenge or an identical repeat', () => {
    expect(readFeeSponsorship(challenge({ areFeesSponsored: true }), undefined).changed).toBe(false)
    expect(readFeeSponsorship(challenge({ areFeesSponsored: true }), true).changed).toBe(false)
    expect(readFeeSponsorship(challenge({ areFeesSponsored: true }), true).requiresAcknowledgement).toBe(false)
  })
})

describe('readFeeSponsorship — malformed challenges', () => {
  it('does not throw and requires acknowledgement when there is nothing to read', () => {
    for (const input of [null, undefined, {}, { accepts: [] }, { accepts: 'nope' }, { accepts: [null] }]) {
      const info = readFeeSponsorship(input)

      expect(info.payer).toBe('unknown')
      expect(info.areFeesSponsored).toBeNull()
      expect(info.requiresAcknowledgement).toBe(true)
    }
  })

  it('omits the price when the challenge does not state a numeric amount', () => {
    expect(readFeeSponsorship(challenge({}, 'not-a-number')).priceUsdc).toBeNull()
    expect(readFeeSponsorship(challenge({})).priceUsdc).toBe('0.001')
  })
})

describe('stroopsToXlm', () => {
  it('converts stroops to XLM with trailing zeros trimmed', () => {
    expect(STROOPS_PER_XLM).toBe(10_000_000)
    expect(stroopsToXlm(10_000_000)).toBe('1')
    expect(stroopsToXlm(100)).toBe('0.00001')
    expect(stroopsToXlm(10)).toBe('0.000001')
    expect(stroopsToXlm(0)).toBe('0')
  })
})
