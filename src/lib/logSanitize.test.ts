import { describe, it, expect } from 'vitest'
import { sanitizeOperatorText } from './logSanitize'

describe('sanitizeOperatorText', () => {
  it('returns empty string for null and undefined', () => {
    expect(sanitizeOperatorText(null)).toBe('')
    expect(sanitizeOperatorText(undefined)).toBe('')
  })

  it('preserves plain text', () => {
    expect(sanitizeOperatorText('plain message')).toBe('plain message')
  })

  it('strips C0 control characters and DEL (log injection)', () => {
    expect(sanitizeOperatorText('upstream\x00\x01\x1f\x7fbroken')).toBe('upstream broken')
    expect(sanitizeOperatorText('line1\nline2\r\nline3')).toBe('line1 line2 line3')
    expect(sanitizeOperatorText('esc\x1b[31mred\x1b[0m')).toBe('esc [31mred [0m')
    expect(sanitizeOperatorText('\x00\x00\x00')).toBe('')
  })

  it('collapses runs of whitespace into a single space and trims', () => {
    expect(sanitizeOperatorText('  a\t\tb   c  ')).toBe('a b c')
  })

  it('truncates to the configured max length', () => {
    const long = 'x'.repeat(500)
    expect(sanitizeOperatorText(long)).toHaveLength(200)
    expect(sanitizeOperatorText(long, 10)).toBe('x'.repeat(10))
  })

  it('coerces non-string inputs via String()', () => {
    expect(sanitizeOperatorText(12345)).toBe('12345')
    expect(sanitizeOperatorText({ a: 1 })).toBe('[object Object]')
  })

  it('never emits newlines or control characters', () => {
    const out = sanitizeOperatorText('\x00\x1b[31mhostile\x0a\x1fpayload\x7f')
    expect(out).not.toMatch(/[\x00-\x1F\x7F]/)
    expect(out).not.toContain('\n')
  })
})
