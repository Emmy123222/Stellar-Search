import { describe, it, expect } from 'vitest'
import {
  FRESHNESS_VALUES,
  FRESHNESS_TBS,
  SEARCH_COUNT,
  IMAGES_COUNT,
  NEWS_COUNT,
  validateCount,
  validateFreshness,
} from './paramValidation'

describe('paramValidation — bounds constants', () => {
  it('exposes route-specific count bounds', () => {
    expect(SEARCH_COUNT).toEqual({ min: 1, max: 20, default: 5 })
    expect(IMAGES_COUNT).toEqual({ min: 1, max: 10, default: 10 })
    expect(NEWS_COUNT).toEqual({ min: 1, max: 20, default: 10 })
  })

  it('maps freshness enums to Serper tbs date filters', () => {
    expect(FRESHNESS_VALUES).toEqual(['pd', 'pw', 'pm'])
    expect(FRESHNESS_TBS).toEqual({ pd: 'qdr:d', pw: 'qdr:w', pm: 'qdr:m' })
  })
})

describe('validateCount', () => {
  const bounds = SEARCH_COUNT // { min: 1, max: 20, default: 5 }

  it('falls back to the default when count is missing or empty', () => {
    expect(validateCount(undefined, bounds)).toEqual({ ok: true, value: 5 })
    expect(validateCount(null, bounds)).toEqual({ ok: true, value: 5 })
    expect(validateCount('', bounds)).toEqual({ ok: true, value: 5 })
    expect(validateCount('   ', bounds)).toEqual({ ok: true, value: 5 })
  })

  it('accepts a string or numeric integer within bounds', () => {
    expect(validateCount('1', bounds)).toEqual({ ok: true, value: 1 })
    expect(validateCount('20', bounds)).toEqual({ ok: true, value: 20 })
    expect(validateCount(7, bounds)).toEqual({ ok: true, value: 7 })
    expect(validateCount(' 5 ', bounds)).toEqual({ ok: true, value: 5 })
  })

  it('rejects out-of-bounds values', () => {
    expect(validateCount('0', bounds).ok).toBe(false)
    expect(validateCount('-1', bounds).ok).toBe(false)
    expect(validateCount('21', bounds).ok).toBe(false)
    expect(validateCount('999', bounds).ok).toBe(false)
    expect(validateCount(0, bounds).ok).toBe(false)
    if (!validateCount('21', bounds).ok) {
      expect(validateCount('21', bounds).error).toMatch(/between 1 and 20/)
    }
  })

  it('rejects non-integer strings', () => {
    for (const bad of ['abc', '1.5', '1e3', '--5', '5.0', 'one', '+', '1,000']) {
      const r = validateCount(bad, bounds)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toMatch(/integer/)
    }
  })

  it('rejects repeated values (arrays)', () => {
    const r = validateCount(['1', '2'], bounds)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/single value/)
  })

  it('rejects other types (booleans, objects)', () => {
    expect(validateCount(true, bounds).ok).toBe(false)
    expect(validateCount({}, bounds).ok).toBe(false)
  })

  it('respects per-route max bounds', () => {
    expect(validateCount('10', IMAGES_COUNT)).toEqual({ ok: true, value: 10 })
    expect(validateCount('11', IMAGES_COUNT).ok).toBe(false)
  })
})

describe('validateFreshness', () => {
  it('returns undefined when freshness is missing or empty', () => {
    expect(validateFreshness(undefined)).toEqual({ ok: true, value: undefined })
    expect(validateFreshness(null)).toEqual({ ok: true, value: undefined })
    expect(validateFreshness('')).toEqual({ ok: true, value: undefined })
    expect(validateFreshness('  ')).toEqual({ ok: true, value: undefined })
  })

  it('accepts the supported enums', () => {
    expect(validateFreshness('pd')).toEqual({ ok: true, value: 'pd' })
    expect(validateFreshness('pw')).toEqual({ ok: true, value: 'pw' })
    expect(validateFreshness('pm')).toEqual({ ok: true, value: 'pm' })
    expect(validateFreshness(' pw ')).toEqual({ ok: true, value: 'pw' })
  })

  it('rejects unknown enums (case-sensitive)', () => {
    for (const bad of ['day', 'week', 'month', 'P', 'PD', '1', 'yesterday', 'past-day']) {
      const r = validateFreshness(bad)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toMatch(/freshness must be one of/)
    }
  })

  it('rejects repeated values (arrays) and non-string types', () => {
    expect(validateFreshness(['pd', 'pw']).ok).toBe(false)
    expect(validateFreshness(1).ok).toBe(false)
    expect(validateFreshness(true).ok).toBe(false)
  })
})
