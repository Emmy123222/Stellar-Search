import { describe, it, expect } from 'vitest'
import {
  normalizeUrl,
  normalizeSource,
  normalizeTitle,
  normalizeDescription,
  normalizeDate
} from './normalize'

describe('normalize helpers', () => {
  it('normalizeUrl filters non-http urls', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com/')
    expect(normalizeUrl('http://test.com')).toBe('http://test.com/')
    expect(normalizeUrl('javascript:alert(1)')).toBe('')
    expect(normalizeUrl('file:///etc/passwd')).toBe('')
    expect(normalizeUrl('')).toBe('')
    expect(normalizeUrl(undefined)).toBe('')
  })

  it('normalizeSource extracts hostname without www.', () => {
    expect(normalizeSource('https://www.example.com/path')).toBe('example.com')
    expect(normalizeSource('http://sub.domain.com')).toBe('sub.domain.com')
    expect(normalizeSource('invalid-url')).toBe('Unknown')
    expect(normalizeSource(undefined)).toBe('Unknown')
  })

  it('normalizeTitle provides fallback', () => {
    expect(normalizeTitle('My Title')).toBe('My Title')
    expect(normalizeTitle('   ')).toBe('No title')
    expect(normalizeTitle(null)).toBe('No title')
    expect(normalizeTitle(undefined)).toBe('No title')
  })

  it('normalizeDescription provides fallback', () => {
    expect(normalizeDescription('snippet')).toBe('snippet')
    expect(normalizeDescription('')).toBe('No description available')
    expect(normalizeDescription(undefined)).toBe('No description available')
  })

  it('normalizeDate returns undefined if missing', () => {
    expect(normalizeDate('2023-01-01')).toBe('2023-01-01')
    expect(normalizeDate('')).toBeUndefined()
    expect(normalizeDate(undefined)).toBeUndefined()
  })
})
