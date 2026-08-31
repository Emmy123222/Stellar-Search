import { describe, it, expect } from 'vitest'
import { validateQuery, MAX_QUERY_LENGTH } from './queryValidator'
import { queryValidationCases } from './queryValidator.fixtures'

describe('validateQuery — shared Express/Vercel input validation', () => {
  it.each(queryValidationCases)('$name', ({ input, expectedStatus, expectedCleanQ }) => {
    const res = validateQuery(input)
    expect(res.ok).toBe(expectedStatus === 200)
    if (res.ok && expectedCleanQ !== undefined) {
      expect(res.cleanQ).toBe(expectedCleanQ)
    }
  })

  it('rejects non-string q (number)', () => {
    expect(validateQuery(123 as unknown)).toEqual({ ok: false, error: 'Missing required parameter: q' })
  })

  it('rejects missing q (null)', () => {
    expect(validateQuery(null)).toEqual({ ok: false, error: 'Missing required parameter: q' })
  })

  it('reports the max-length error message', () => {
    const long = 'a'.repeat(MAX_QUERY_LENGTH + 1)
    expect(validateQuery(long)).toEqual({
      ok: false,
      error: `Query too long. Maximum ${MAX_QUERY_LENGTH} characters.`,
    })
  })

  it('reports the empty-after-stripping error message', () => {
    expect(validateQuery('\x00\x01\x1F\x7F   ')).toEqual({
      ok: false,
      error: 'Query contains no valid characters.',
    })
  })

  it('preserves x402 settlement semantics — only validates q, not payment', () => {
    // validateQuery is payment-agnostic; x402 middleware handles payment before this
    expect(validateQuery('valid query').ok).toBe(true)
    expect(MAX_QUERY_LENGTH).toBe(256)
  })
})
