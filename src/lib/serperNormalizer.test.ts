import { describe, it, expect } from 'vitest'
import {
  isValidHttpUrl,
  extractSafeHostname,
  normalizeOrganicResults,
  normalizeImageResults,
  normalizeNewsResults,
} from './serperNormalizer'

describe('serperNormalizer helper functions', () => {
  describe('isValidHttpUrl', () => {
    it('returns true for valid http and https URLs', () => {
      expect(isValidHttpUrl('https://stellar.org')).toBe(true)
      expect(isValidHttpUrl('http://developers.stellar.org/docs/page?q=1')).toBe(true)
    })

    it('returns false for non-http(s) schemes, malformed strings, and non-strings', () => {
      expect(isValidHttpUrl('javascript:alert(1)')).toBe(false)
      expect(isValidHttpUrl('ftp://example.com/file')).toBe(false)
      expect(isValidHttpUrl('not a url')).toBe(false)
      expect(isValidHttpUrl('')).toBe(false)
      expect(isValidHttpUrl(null)).toBe(false)
      expect(isValidHttpUrl(undefined)).toBe(false)
      expect(isValidHttpUrl(12345)).toBe(false)
    })
  })

  describe('extractSafeHostname', () => {
    it('strips leading www. and returns hostname', () => {
      expect(extractSafeHostname('https://www.stellar.org/news')).toBe('stellar.org')
      expect(extractSafeHostname('http://developers.stellar.org')).toBe('developers.stellar.org')
    })

    it('returns original input or fallback if URL parsing fails', () => {
      expect(extractSafeHostname('invalid-url')).toBe('invalid-url')
      expect(extractSafeHostname('')).toBe('unknown')
    })
  })

  describe('normalizeOrganicResults', () => {
    it('returns empty array when raw input is null, non-object, or lacks organic array', () => {
      expect(normalizeOrganicResults(null)).toEqual([])
      expect(normalizeOrganicResults(undefined)).toEqual([])
      expect(normalizeOrganicResults('string')).toEqual([])
      expect(normalizeOrganicResults({ organic: 'not an array' })).toEqual([])
      expect(normalizeOrganicResults({})).toEqual([])
    })

    it('normalizes valid organic rows correctly', () => {
      const input = {
        organic: [
          { title: 'Stellar Docs', link: 'https://developers.stellar.org', snippet: 'Official docs', date: '2026-01-01' },
          { title: 'Stellar Foundation', link: 'https://www.stellar.org', description: 'Main site' },
        ],
      }
      const results = normalizeOrganicResults(input)

      expect(results).toHaveLength(2)
      expect(results[0]).toEqual({
        id: '1',
        title: 'Stellar Docs',
        url: 'https://developers.stellar.org',
        description: 'Official docs',
        source: 'developers.stellar.org',
        relevanceScore: 1,
        publishedAt: '2026-01-01',
      })
      expect(results[1]).toEqual({
        id: '2',
        title: 'Stellar Foundation',
        url: 'https://www.stellar.org',
        description: 'Main site',
        source: 'stellar.org',
        relevanceScore: 0.94,
        publishedAt: undefined,
      })
    })

    it('skips malformed rows and normalizes missing fields deterministically', () => {
      const input = {
        organic: [
          null,
          123,
          { link: 'javascript:void(0)', title: 'XSS attempt' }, // Invalid URL scheme
          { link: 'https://valid.com', title: 12345, snippet: null }, // Non-string title & snippet
          { link: '', title: 'Empty link' }, // Missing/empty link
          { link: 'https://second-valid.com', title: '  Trimming Title  ', date: 2026 }, // Non-string date
        ],
      }

      const results = normalizeOrganicResults(input)

      expect(results).toHaveLength(2)
      expect(results[0]).toEqual({
        id: '1',
        title: 'No title',
        url: 'https://valid.com',
        description: '',
        source: 'valid.com',
        relevanceScore: 1,
        publishedAt: undefined,
      })
      expect(results[1]).toEqual({
        id: '2',
        title: 'Trimming Title',
        url: 'https://second-valid.com',
        description: '',
        source: 'second-valid.com',
        relevanceScore: 0.94,
        publishedAt: undefined,
      })
    })
  })

  describe('normalizeImageResults', () => {
    it('returns empty array when raw input is invalid', () => {
      expect(normalizeImageResults(null)).toEqual([])
      expect(normalizeImageResults({ images: null })).toEqual([])
    })

    it('normalizes valid image rows correctly', () => {
      const input = {
        images: [
          {
            title: 'Stellar Logo',
            imageUrl: 'https://example.com/logo.png',
            thumbnailUrl: 'https://example.com/thumb.png',
            link: 'https://www.example.com/page',
            imageWidth: 800,
            imageHeight: 600,
          },
        ],
      }
      const results = normalizeImageResults(input)

      expect(results).toHaveLength(1)
      expect(results[0]).toEqual({
        id: '1',
        title: 'Stellar Logo',
        imageUrl: 'https://example.com/logo.png',
        thumbnailUrl: 'https://example.com/thumb.png',
        sourceUrl: 'https://www.example.com/page',
        source: 'example.com',
        width: 800,
        height: 600,
      })
    })

    it('skips rows missing valid imageUrl and applies fallbacks for missing links/dimensions', () => {
      const input = {
        images: [
          null,
          'not an object',
          { title: 'No Image URL', link: 'https://example.com' }, // missing imageUrl -> skipped
          { imageUrl: 'https://img.com/pic.png', imageWidth: 'invalid', imageHeight: -10 }, // fallbacks
        ],
      }
      const results = normalizeImageResults(input)

      expect(results).toHaveLength(1)
      expect(results[0]).toEqual({
        id: '1',
        title: 'No title',
        imageUrl: 'https://img.com/pic.png',
        thumbnailUrl: 'https://img.com/pic.png',
        sourceUrl: 'https://img.com/pic.png',
        source: 'img.com',
        width: undefined,
        height: undefined,
      })
    })
  })

  describe('normalizeNewsResults', () => {
    it('returns empty array when raw input is invalid', () => {
      expect(normalizeNewsResults(null)).toEqual([])
      expect(normalizeNewsResults({ news: 'not-array' })).toEqual([])
    })

    it('normalizes valid news rows and handles malformed rows deterministically', () => {
      const input = {
        news: [
          null,
          100,
          {
            title: 'News Headline',
            link: 'https://news.stellar.org/article',
            snippet: 'Article snippet text',
            source: 'Stellar News',
            date: '2026-02-15',
            imageUrl: 'https://news.stellar.org/header.jpg',
          },
          { link: 'not-a-valid-url', title: 'Bad URL' }, // Skipped
          {
            link: 'https://blog.example.com/post',
            title: '',
            source: null,
            imageUrl: 'ftp://bad-image-scheme',
          },
        ],
      }
      const results = normalizeNewsResults(input)

      expect(results).toHaveLength(2)
      expect(results[0]).toEqual({
        id: '1',
        title: 'News Headline',
        url: 'https://news.stellar.org/article',
        snippet: 'Article snippet text',
        source: 'Stellar News',
        publishedAt: '2026-02-15',
        imageUrl: 'https://news.stellar.org/header.jpg',
      })
      expect(results[1]).toEqual({
        id: '2',
        title: 'No title',
        url: 'https://blog.example.com/post',
        snippet: '',
        source: 'blog.example.com',
        publishedAt: undefined,
        imageUrl: undefined,
      })
    })
  })
})
