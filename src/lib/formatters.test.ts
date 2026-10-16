/**
 * formatters.test.ts — Tests for Intl-based formatters
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  formatNumber,
  formatUSDC,
  formatXLM,
  formatPercent,
  formatRelevanceScore,
  formatCompact,
  formatRelativeTime,
  formatDate,
  formatDateTime,
  formatDuration,
  calculateRemainingQueries,
  formatRemainingQueries,
} from './formatters'

describe('formatters', () => {
  describe('formatNumber', () => {
    it('formats numbers with default locale', () => {
      expect(formatNumber(1234.56)).toBe('1,234.56')
      expect(formatNumber(1000000)).toBe('1,000,000')
    })

    it('handles zero and negative numbers', () => {
      expect(formatNumber(0)).toBe('0')
      expect(formatNumber(-1234.56)).toBe('-1,234.56')
    })

    it('handles non-finite values', () => {
      expect(formatNumber(NaN)).toBe('NaN')
      expect(formatNumber(Infinity)).toBe('Infinity')
      expect(formatNumber(-Infinity)).toBe('-Infinity')
    })

    it('preserves high precision', () => {
      expect(formatNumber(1.123456789012345)).toContain('1.123456789')
    })
  })

  describe('formatUSDC', () => {
    it('formats standard USDC amounts', () => {
      expect(formatUSDC(123.456789)).toBe('123.457')
      expect(formatUSDC('1.001')).toBe('1.001')
    })

    it('handles very small amounts with scientific notation', () => {
      const result = formatUSDC(0.0001)
      expect(result).toMatch(/1(\.0)?[eE]-4/)
    })

    it('handles zero', () => {
      expect(formatUSDC(0)).toBe('0')
      expect(formatUSDC('0')).toBe('0')
    })

    it('handles invalid input', () => {
      expect(formatUSDC(NaN)).toBe('0')
      expect(formatUSDC('invalid')).toBe('0')
    })

    it('respects custom precision options', () => {
      expect(formatUSDC(1.23456, 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 }))
        .toBe('1.2346')
    })
  })

  describe('formatXLM', () => {
    it('formats XLM amounts with standard precision', () => {
      expect(formatXLM(100.1234567)).toBe('100.1234567')
      expect(formatXLM('50.5')).toBe('50.5000')
    })

    it('handles zero', () => {
      expect(formatXLM(0)).toBe('0.0000')
    })

    it('handles invalid input', () => {
      expect(formatXLM(NaN)).toBe('0')
    })
  })

  describe('formatPercent', () => {
    it('formats percentages', () => {
      expect(formatPercent(0.5)).toBe('50%')
      expect(formatPercent(1)).toBe('100%')
      expect(formatPercent(0.1234)).toBe('12%')
    })

    it('handles zero and negative values', () => {
      expect(formatPercent(0)).toBe('0%')
      expect(formatPercent(-0.5)).toBe('-50%')
    })

    it('handles non-finite values', () => {
      expect(formatPercent(NaN)).toBe('0%')
    })
  })

  describe('formatRelevanceScore', () => {
    it('formats relevance scores as whole percentages', () => {
      expect(formatRelevanceScore(0.95)).toBe('95%')
      expect(formatRelevanceScore(0.5)).toBe('50%')
      expect(formatRelevanceScore(0.123)).toBe('12%')
    })
  })

  describe('formatCompact', () => {
    it('formats large numbers with compact notation', () => {
      expect(formatCompact(1200)).toBe('1.2K')
      expect(formatCompact(1500000)).toBe('1.5M')
      expect(formatCompact(1000000000)).toBe('1B')
    })

    it('formats small numbers without compact notation', () => {
      expect(formatCompact(999)).toBe('999')
      expect(formatCompact(100)).toBe('100')
    })

    it('handles non-finite values', () => {
      expect(formatCompact(NaN)).toBe('NaN')
    })
  })

  describe('formatRelativeTime', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('formats seconds ago', () => {
      const now = new Date('2024-01-15T12:00:00Z')
      vi.setSystemTime(now)
      
      const fiveSecondsAgo = new Date(now.getTime() - 5 * 1000)
      const result = formatRelativeTime(fiveSecondsAgo)
      expect(result).toMatch(/5 second/)
    })

    it('formats minutes ago', () => {
      const now = new Date('2024-01-15T12:00:00Z')
      vi.setSystemTime(now)
      
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000)
      const result = formatRelativeTime(fiveMinutesAgo)
      expect(result).toMatch(/5 minute/)
    })

    it('formats hours ago', () => {
      const now = new Date('2024-01-15T12:00:00Z')
      vi.setSystemTime(now)
      
      const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000)
      const result = formatRelativeTime(threeHoursAgo)
      expect(result).toMatch(/3 hour/)
    })

    it('formats days ago', () => {
      const now = new Date('2024-01-15T12:00:00Z')
      vi.setSystemTime(now)
      
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)
      const result = formatRelativeTime(twoDaysAgo)
      expect(result).toMatch(/2 day/)
    })

    it('formats months ago', () => {
      const now = new Date('2024-01-15T12:00:00Z')
      vi.setSystemTime(now)
      
      const twoMonthsAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)
      const result = formatRelativeTime(twoMonthsAgo)
      expect(result).toMatch(/2 month/)
    })

    it('handles invalid dates', () => {
      expect(formatRelativeTime('invalid')).toBe('Invalid date')
      expect(formatRelativeTime(new Date('invalid'))).toBe('Invalid date')
    })

    it('handles future dates', () => {
      const now = new Date('2024-01-15T12:00:00Z')
      vi.setSystemTime(now)
      
      const future = new Date(now.getTime() + 5 * 60 * 1000)
      const result = formatRelativeTime(future)
      // Should return a formatted date for future dates
      expect(result).toContain('15')
    })

    it('accepts ISO string input', () => {
      const now = new Date('2024-01-15T12:00:00Z')
      vi.setSystemTime(now)
      
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString()
      const result = formatRelativeTime(fiveMinutesAgo)
      expect(result).toMatch(/5 minute/)
    })
  })

  describe('formatDate', () => {
    it('formats dates with default options', () => {
      const date = new Date('2024-01-15T12:00:00Z')
      const result = formatDate(date)
      expect(result).toMatch(/Jan/)
      expect(result).toMatch(/15/)
    })

    it('handles invalid dates', () => {
      expect(formatDate('invalid')).toBe('Invalid date')
      expect(formatDate(new Date('invalid'))).toBe('Invalid date')
    })

    it('accepts ISO string input', () => {
      const result = formatDate('2024-01-15T12:00:00Z')
      expect(result).toMatch(/Jan/)
      expect(result).toMatch(/15/)
    })
  })

  describe('formatDateTime', () => {
    it('formats dates with time', () => {
      const date = new Date('2024-01-15T12:30:00Z')
      const result = formatDateTime(date)
      expect(result).toMatch(/Jan/)
      expect(result).toMatch(/15/)
      // Time portion will vary by timezone, just check it exists
      expect(result).toMatch(/\d{1,2}:\d{2}/)
    })

    it('handles invalid dates', () => {
      expect(formatDateTime('invalid')).toBe('Invalid date')
    })
  })

  describe('formatDuration', () => {
    it('formats milliseconds', () => {
      expect(formatDuration(500)).toBe('500ms')
      expect(formatDuration(999)).toBe('999ms')
    })

    it('formats seconds', () => {
      expect(formatDuration(5000)).toBe('5s')
      expect(formatDuration(45300)).toBe('45.3s')
    })

    it('formats minutes', () => {
      expect(formatDuration(120000)).toBe('2m')
      expect(formatDuration(150000)).toBe('2.5m')
    })

    it('formats hours', () => {
      expect(formatDuration(7200000)).toBe('2h')
      expect(formatDuration(9000000)).toBe('2.5h')
    })

    it('handles zero and negative values', () => {
      expect(formatDuration(0)).toBe('0ms')
      expect(formatDuration(-100)).toBe('0ms')
    })

    it('handles non-finite values', () => {
      expect(formatDuration(NaN)).toBe('0ms')
      expect(formatDuration(Infinity)).toBe('0ms')
    })
  })

  describe('calculateRemainingQueries', () => {
    it('calculates remaining queries from balance and price', () => {
      expect(calculateRemainingQueries(10, 0.001)).toBe(10000)
      expect(calculateRemainingQueries('5', '0.5')).toBe(10)
      expect(calculateRemainingQueries(1.234, 0.1)).toBe(12)
    })

    it('handles zero balance', () => {
      expect(calculateRemainingQueries(0, 0.001)).toBe(0)
    })

    it('handles negative balance', () => {
      expect(calculateRemainingQueries(-5, 0.001)).toBe(0)
    })

    it('handles zero price', () => {
      expect(calculateRemainingQueries(10, 0)).toBe(0)
    })

    it('handles invalid input', () => {
      expect(calculateRemainingQueries(NaN, 0.001)).toBe(0)
      expect(calculateRemainingQueries(10, NaN)).toBe(0)
      expect(calculateRemainingQueries('invalid', 0.001)).toBe(0)
    })

    it('floors partial queries', () => {
      expect(calculateRemainingQueries(0.0015, 0.001)).toBe(1)
      expect(calculateRemainingQueries(0.0009, 0.001)).toBe(0)
    })
  })

  describe('formatRemainingQueries', () => {
    it('formats remaining queries with locale separators', () => {
      expect(formatRemainingQueries(1000, 0.001)).toBe('1,000,000')
      expect(formatRemainingQueries(5, 0.5)).toBe('10')
    })

    it('handles zero', () => {
      expect(formatRemainingQueries(0, 0.001)).toBe('0')
    })
  })

  describe('time zone handling', () => {
    it('formatDate respects explicit timezone option', () => {
      const date = new Date('2024-01-15T00:00:00Z')
      const result = formatDate(date, 'en-US', { timeZone: 'UTC' })
      expect(result).toMatch(/Jan/)
      expect(result).toMatch(/15/)
    })

    it('formatDateTime respects explicit timezone option', () => {
      const date = new Date('2024-01-15T12:00:00Z')
      const resultUtc = formatDateTime(date, 'en-US', { timeZone: 'UTC' })
      expect(resultUtc).toMatch(/Jan/)
      expect(resultUtc).toMatch(/15/)
      expect(resultUtc).toMatch(/12:00/)

      const resultTokyo = formatDateTime(date, 'en-US', { timeZone: 'Asia/Tokyo' })
      expect(resultTokyo).toMatch(/Jan/)
      expect(resultTokyo).toMatch(/15/)
      expect(resultTokyo).toMatch(/9:00\s*PM|21:00/i)

      const resultNY = formatDateTime(date, 'en-US', { timeZone: 'America/New_York' })
      expect(resultNY).toMatch(/Jan/)
      expect(resultNY).toMatch(/15/)
      expect(resultNY).toMatch(/7:00\s*AM|07:00/i)

      const resultTokyo24 = formatDateTime(date, 'en-US', { timeZone: 'Asia/Tokyo', hour12: false })
      expect(resultTokyo24).toMatch(/21:00/)
    })
  })

  describe('plural forms', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('formatRelativeTime uses singular for 1 unit and plural for multiple units', () => {
      const now = new Date('2024-01-15T12:00:00Z')
      vi.setSystemTime(now)

      // 1 second (singular) vs 5 seconds (plural)
      const oneSecondAgo = new Date(now.getTime() - 1000)
      expect(formatRelativeTime(oneSecondAgo).toLowerCase()).toMatch(/1 second|a second/)
      const fiveSecondsAgo = new Date(now.getTime() - 5000)
      expect(formatRelativeTime(fiveSecondsAgo).toLowerCase()).toMatch(/5 seconds/)

      // 1 minute (singular) vs 2 minutes (plural)
      const oneMinuteAgo = new Date(now.getTime() - 60 * 1000)
      expect(formatRelativeTime(oneMinuteAgo).toLowerCase()).toMatch(/1 minute|a minute/)
      const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000)
      expect(formatRelativeTime(twoMinutesAgo).toLowerCase()).toMatch(/2 minutes/)

      // 1 hour (singular) vs 3 hours (plural)
      const oneHourAgo = new Date(now.getTime() - 3600 * 1000)
      expect(formatRelativeTime(oneHourAgo).toLowerCase()).toMatch(/1 hour|an hour/)
      const threeHoursAgo = new Date(now.getTime() - 3 * 3600 * 1000)
      expect(formatRelativeTime(threeHoursAgo).toLowerCase()).toMatch(/3 hours/)

      // 1 day (singular) vs 4 days (plural)
      const oneDayAgo = new Date(now.getTime() - 24 * 3600 * 1000)
      expect(formatRelativeTime(oneDayAgo).toLowerCase()).toMatch(/1 day|yesterday/)
      const fourDaysAgo = new Date(now.getTime() - 4 * 24 * 3600 * 1000)
      expect(formatRelativeTime(fourDaysAgo).toLowerCase()).toMatch(/4 days/)
    })
  })

  describe('timestamp and edge case date handling', () => {
    it('accepts millisecond numbers as input', () => {
      const ts = 1705320000000 // 2024-01-15T12:00:00.000Z
      expect(formatDate(ts, 'en-US', { timeZone: 'UTC' })).toContain('Jan')
      expect(formatDateTime(ts, 'en-US', { timeZone: 'UTC' })).toContain('12:00')
    })

    it('gracefully handles null, undefined, and non-date values', () => {
      expect(formatDate(null as any)).toBe('Invalid date')
      expect(formatDate(undefined as any)).toBe('Invalid date')
      expect(formatDateTime(null as any)).toBe('Invalid date')
      expect(formatDateTime(undefined as any)).toBe('Invalid date')
      expect(formatRelativeTime(null as any)).toBe('Invalid date')
      expect(formatRelativeTime(undefined as any)).toBe('Invalid date')
    })
  })
})
