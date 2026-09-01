import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  truncateAddress,
  truncateHash,
  explorerTxUrl,
  explorerAccountUrl,
  formatTimeAgo,
  fetchServerStats,
} from './stellar'
import { STELLAR_EXPERT_URL } from './constants'

describe('stellar helpers', () => {
  describe('truncateAddress', () => {
    it('truncates with default 6 chars and last 4', () => {
      const addr = 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3'
      expect(truncateAddress(addr)).toBe('GAAZI4...ZOM3')
    })
    it('truncates with custom chars', () => {
      const addr = 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3'
      expect(truncateAddress(addr, 4)).toBe('GAAZ...ZOM3')
    })
    it('returns empty string for falsy address', () => {
      expect(truncateAddress('')).toBe('')
      expect(truncateAddress(null as any)).toBe('')
      expect(truncateAddress(undefined as any)).toBe('')
    })
    it('handles short addresses gracefully', () => {
      expect(truncateAddress('GABC')).toBe('GABC...GABC')
    })
  })

  describe('truncateHash', () => {
    it('truncates with default 8 chars and last 6', () => {
      const hash = 'a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef'
      expect(truncateHash(hash)).toBe('a1b2c3d4...abcdef')
    })
    it('truncates with custom chars', () => {
      const hash = 'a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef'
      expect(truncateHash(hash, 4)).toBe('a1b2...abcdef')
    })
    it('returns empty string for falsy hash', () => {
      expect(truncateHash('')).toBe('')
      expect(truncateHash(null as any)).toBe('')
    })
  })

  describe('explorerTxUrl', () => {
    it('constructs tx explorer URL', () => {
      const hash = 'abc123'
      expect(explorerTxUrl(hash)).toBe(`${STELLAR_EXPERT_URL}/tx/${hash}`)
    })
    it('contains /tx/ path and is https', () => {
      const url = explorerTxUrl('a1b2c3d4')
      expect(url).toContain('/tx/a1b2c3d4')
      expect(url.startsWith('https://stellar.expert')).toBe(true)
    })
  })

  describe('explorerAccountUrl', () => {
    it('constructs account explorer URL', () => {
      const addr = 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3'
      expect(explorerAccountUrl(addr)).toBe(`${STELLAR_EXPERT_URL}/account/${addr}`)
    })
    it('contains /account/ path', () => {
      expect(explorerAccountUrl('GABC')).toContain('/account/GABC')
    })
  })

  describe('formatTimeAgo', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('formats seconds ago', () => {
      const now = new Date('2026-01-01T00:00:30Z').getTime()
      vi.setSystemTime(now)
      const iso = new Date(now - 5 * 1000).toISOString()
      expect(formatTimeAgo(iso)).toBe('5s ago')
    })

    it('formats minutes ago', () => {
      const now = new Date('2026-01-01T00:10:00Z').getTime()
      vi.setSystemTime(now)
      const iso = new Date(now - 5 * 60 * 1000).toISOString()
      expect(formatTimeAgo(iso)).toBe('5m ago')
    })

    it('formats hours ago', () => {
      const now = new Date('2026-01-01T12:00:00Z').getTime()
      vi.setSystemTime(now)
      const iso = new Date(now - 3 * 60 * 60 * 1000).toISOString()
      expect(formatTimeAgo(iso)).toBe('3h ago')
    })

    it('formats days ago', () => {
      const now = new Date('2026-01-05T12:00:00Z').getTime()
      vi.setSystemTime(now)
      const iso = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString()
      expect(formatTimeAgo(iso)).toBe('2d ago')
    })

    it('handles exactly 60 seconds -> 1m ago', () => {
      const now = new Date('2026-01-01T00:01:00Z').getTime()
      vi.setSystemTime(now)
      const iso = new Date(now - 60 * 1000).toISOString()
      expect(formatTimeAgo(iso)).toBe('1m ago')
    })

    it('handles exactly 24 hours -> 1d ago', () => {
      const now = new Date('2026-01-02T00:00:00Z').getTime()
      vi.setSystemTime(now)
      const iso = new Date(now - 24 * 60 * 60 * 1000).toISOString()
      expect(formatTimeAgo(iso)).toBe('1d ago')
    })
  })

  describe('fetchServerStats', () => {
    const originalFetch = global.fetch
    afterEach(() => {
      global.fetch = originalFetch
      vi.restoreAllMocks()
    })

    it('returns json on successful health fetch', async () => {
      const mockData = { status: 'ok', totalQueries: 5 }
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockData,
      } as any)

      const result = await fetchServerStats()
      expect(result).toEqual(mockData)
      expect(global.fetch).toHaveBeenCalled()
      const url = (global.fetch as any).mock.calls[0][0] as string
      expect(url).toContain('/health')
    })

    it('returns null when response not ok', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      } as any)
      const result = await fetchServerStats()
      expect(result).toBeNull()
    })

    it('returns null when fetch throws', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('network error'))
      const result = await fetchServerStats()
      expect(result).toBeNull()
    })

    it('returns null when json parsing throws indirectly via fetch rejection', async () => {
      global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
      expect(await fetchServerStats()).toBeNull()
    })
  })
})
