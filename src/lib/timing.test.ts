import { describe, it, expect } from 'vitest'
import { TIMING_PHASES, percentile } from './timing'

describe('timing vocabulary', () => {
  it('exposes shared vocabulary', () => {
    expect(TIMING_PHASES.TOTAL).toBe('total')
    expect(TIMING_PHASES.SERPER).toBe('serper')
    expect(TIMING_PHASES.GROQ).toBe('groq')
    expect(TIMING_PHASES.VALIDATION).toBe('validation')
    expect(TIMING_PHASES.BROWSER_FETCH).toBe('browser_fetch')
  })

  it('percentile computes correctly without unbounded arrays', () => {
    expect(percentile([], 50)).toBeNull()
    expect(percentile([100], 50)).toBe(100)
    const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    expect(percentile(sorted, 50)).toBe(50)
    expect(percentile(sorted, 95)).toBe(100)
    expect(percentile(sorted, 99)).toBe(100)
    expect(percentile([1, 2, 3, 4], 50)).toBe(2)
    expect(percentile([1, 2, 3, 4], 95)).toBe(4)
  })
})
