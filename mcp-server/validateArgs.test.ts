import { describe, it, expect } from 'vitest'
import {
  validateWebSearchArgs,
  validateImageSearchArgs,
  validateNewsSearchArgs,
} from './validateArgs'

/**
 * MCP argument validation (#98).
 *
 * The MCP transport has no HTTP status code, so an invalid `count` is surfaced
 * as a structured tool error instead of being silently coerced to the default.
 * Every route's bounds come from the shared contract (`src/lib/paramValidation.ts`):
 * web/image search 1–10, news 1–20.
 */

describe('validateWebSearchArgs — count bounds (#98)', () => {
  it('accepts omitted / null / valid integer counts', () => {
    expect(validateWebSearchArgs({ query: 'stellar' })).toBeNull()
    expect(validateWebSearchArgs({ query: 'stellar', count: null })).toBeNull()
    expect(validateWebSearchArgs({ query: 'stellar', count: 1 })).toBeNull()
    expect(validateWebSearchArgs({ query: 'stellar', count: 10 })).toBeNull()
    expect(validateWebSearchArgs({ query: 'stellar', count: '7' })).toBeNull()
  })

  it('rejects negative, zero, and out-of-range counts instead of clamping', () => {
    expect(validateWebSearchArgs({ query: 'q', count: 0 })).toMatch(/between 1 and 10/)
    expect(validateWebSearchArgs({ query: 'q', count: -1 })).toMatch(/between 1 and 10/)
    expect(validateWebSearchArgs({ query: 'q', count: 11 })).toMatch(/between 1 and 10/)
    expect(validateWebSearchArgs({ query: 'q', count: 999999 })).toMatch(/between 1 and 10/)
  })

  it('rejects fractional and non-numeric counts as non-integers', () => {
    for (const bad of [1.5, '1.5', 'abc', NaN, Infinity, {}]) {
      expect(validateWebSearchArgs({ query: 'q', count: bad })).toMatch(/count must be an integer/)
    }
  })

  it('rejects array counts (never silently coerced to a number)', () => {
    // `Number([]) === 0`, so an array must be rejected by the bounds check
    // rather than slipping through as a valid value.
    expect(validateWebSearchArgs({ query: 'q', count: [] })).toMatch(/count must be between 1 and 10/)
    expect(validateWebSearchArgs({ query: 'q', count: [1, 2] })).toMatch(/count must be an integer/)
  })

  it('validates freshness against the shared enum', () => {
    expect(validateWebSearchArgs({ query: 'q', freshness: 'pd' })).toBeNull()
    expect(validateWebSearchArgs({ query: 'q', freshness: 'pw' })).toBeNull()
    expect(validateWebSearchArgs({ query: 'q', freshness: 'pm' })).toBeNull()
    expect(validateWebSearchArgs({ query: 'q', freshness: 'year' })).toMatch(/freshness must be one of/)
    expect(validateWebSearchArgs({ query: 'q', freshness: 'PD' })).toMatch(/freshness must be one of/)
  })

  it('requires a non-empty query', () => {
    expect(validateWebSearchArgs({})).toMatch(/query is required/)
    expect(validateWebSearchArgs({ query: '   ' })).toMatch(/query is required/)
    expect(validateWebSearchArgs({ query: 42 })).toMatch(/query is required/)
    expect(validateWebSearchArgs(undefined)).toMatch(/Missing arguments object/)
  })
})

describe('validateImageSearchArgs — count bounds (#98)', () => {
  it('accepts omitted and in-range counts', () => {
    expect(validateImageSearchArgs({ query: 'stellar' })).toBeNull()
    expect(validateImageSearchArgs({ query: 'stellar', count: 1 })).toBeNull()
    expect(validateImageSearchArgs({ query: 'stellar', count: 10 })).toBeNull()
  })

  it('rejects out-of-range and fractional counts', () => {
    expect(validateImageSearchArgs({ query: 'q', count: 0 })).toMatch(/between 1 and 10/)
    expect(validateImageSearchArgs({ query: 'q', count: 11 })).toMatch(/between 1 and 10/)
    expect(validateImageSearchArgs({ query: 'q', count: 2.5 })).toMatch(/count must be an integer/)
  })
})

describe('validateNewsSearchArgs — count bounds (#98)', () => {
  it('accepts up to 20 results', () => {
    expect(validateNewsSearchArgs({ query: 'stellar' })).toBeNull()
    expect(validateNewsSearchArgs({ query: 'stellar', count: 20 })).toBeNull()
    expect(validateNewsSearchArgs({ query: 'stellar', count: '15' })).toBeNull()
  })

  it('rejects out-of-range and fractional counts', () => {
    expect(validateNewsSearchArgs({ query: 'q', count: 0 })).toMatch(/between 1 and 20/)
    expect(validateNewsSearchArgs({ query: 'q', count: 21 })).toMatch(/between 1 and 20/)
    expect(validateNewsSearchArgs({ query: 'q', count: 1.5 })).toMatch(/count must be an integer/)
  })

  it('validates freshness against the shared enum', () => {
    expect(validateNewsSearchArgs({ query: 'q', freshness: 'pm' })).toBeNull()
    expect(validateNewsSearchArgs({ query: 'q', freshness: 'month' })).toMatch(/freshness must be one of/)
  })
})
