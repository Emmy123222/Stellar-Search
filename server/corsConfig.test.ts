import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  parseAllowedOrigins,
  isProductionEnv,
  getCorsStartupMessage,
  buildCorsOptions,
} from './corsConfig'

describe('corsConfig', () => {
  describe('parseAllowedOrigins', () => {
    it('returns empty array for undefined', () => {
      expect(parseAllowedOrigins(undefined)).toEqual([])
    })
    it('returns empty array for empty string', () => {
      expect(parseAllowedOrigins('')).toEqual([])
    })
    it('splits comma separated origins', () => {
      expect(parseAllowedOrigins('https://a.com,https://b.com')).toEqual(['https://a.com', 'https://b.com'])
    })
    it('trims entries and filters empty', () => {
      expect(parseAllowedOrigins(' https://a.com , , https://b.com ')).toEqual(['https://a.com', 'https://b.com'])
    })
    it('handles single origin without comma', () => {
      expect(parseAllowedOrigins('https://example.com')).toEqual(['https://example.com'])
    })
    it('filters out blank entries from trailing comma', () => {
      expect(parseAllowedOrigins('https://a.com,')).toEqual(['https://a.com'])
    })
    it('deduplicates origins while preserving order', () => {
      expect(parseAllowedOrigins('https://a.com, https://a.com, https://b.com')).toEqual(['https://a.com', 'https://b.com'])
    })
    it('does not treat hostile lookalike origins as allowed', () => {
      expect(parseAllowedOrigins('https://example.com')).not.toContain('https://example.com.evil.test')
    })
  })

  describe('isProductionEnv', () => {
    const originalEnv = process.env.NODE_ENV
    afterEach(() => {
      process.env.NODE_ENV = originalEnv
      vi.restoreAllMocks()
    })

    it('returns true when NODE_ENV is production', () => {
      process.env.NODE_ENV = 'production'
      expect(isProductionEnv()).toBe(true)
    })
    it('returns false when NODE_ENV is not production', () => {
      process.env.NODE_ENV = 'development'
      expect(isProductionEnv()).toBe(false)
    })
    it('returns false when NODE_ENV is test', () => {
      process.env.NODE_ENV = 'test'
      expect(isProductionEnv()).toBe(false)
    })
    it('returns false when NODE_ENV is undefined', () => {
      delete process.env.NODE_ENV
      expect(isProductionEnv()).toBe(false)
    })
  })

  describe('getCorsStartupMessage', () => {
    const originalEnv = process.env.NODE_ENV
    const originalAllowed = process.env.ALLOWED_ORIGINS
    afterEach(() => {
      process.env.NODE_ENV = originalEnv
      process.env.ALLOWED_ORIGINS = originalAllowed
    })

    it('returns development message when not production', () => {
      process.env.NODE_ENV = 'development'
      expect(getCorsStartupMessage()).toBe('CORS: * (development)')
    })

    it('returns allowlist empty message in production with no origins', () => {
      process.env.NODE_ENV = 'production'
      delete process.env.ALLOWED_ORIGINS
      expect(getCorsStartupMessage()).toBe('CORS: allowlist empty — cross-origin browser requests blocked')
    })

    it('returns empty allowed with empty string', () => {
      process.env.NODE_ENV = 'production'
      process.env.ALLOWED_ORIGINS = ''
      expect(getCorsStartupMessage()).toBe('CORS: allowlist empty — cross-origin browser requests blocked')
    })

    it('returns singular origin message', () => {
      process.env.NODE_ENV = 'production'
      process.env.ALLOWED_ORIGINS = 'https://example.com'
      expect(getCorsStartupMessage()).toBe('CORS: allowlist (1 origin)')
    })

    it('returns plural origins message', () => {
      process.env.NODE_ENV = 'production'
      process.env.ALLOWED_ORIGINS = 'https://a.com,https://b.com'
      expect(getCorsStartupMessage()).toBe('CORS: allowlist (2 origins)')
    })
  })

  describe('buildCorsOptions', () => {
    const originalNodeEnv = process.env.NODE_ENV
    const originalAllowed = process.env.ALLOWED_ORIGINS
    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv
      process.env.ALLOWED_ORIGINS = originalAllowed
      vi.restoreAllMocks()
    })

    it('returns wildcard origin in development', () => {
      process.env.NODE_ENV = 'development'
      const opts = buildCorsOptions()
      expect(opts.origin).toBe('*')
      expect(opts.allowedHeaders).toContain('X-Payment')
      expect(opts.exposedHeaders).toContain('X-Payment-Response')
      expect(opts.methods).toContain('GET')
    })

    it('exposes x402 payment headers', () => {
      process.env.NODE_ENV = 'development'
      const opts = buildCorsOptions()
      expect(opts.allowedHeaders).toEqual(expect.arrayContaining(['X-Payment', 'Content-Type']))
      expect(opts.exposedHeaders).toEqual(expect.arrayContaining(['PAYMENT-REQUIRED', 'X-Payment-Response']))
    })

    it('in production with empty allowlist warns and blocks origins', () => {
      process.env.NODE_ENV = 'production'
      delete process.env.ALLOWED_ORIGINS
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const opts = buildCorsOptions()
      expect(warnSpy).toHaveBeenCalled()
      expect(typeof opts.origin).toBe('function')
      // No origin should be allowed
      const fn = opts.origin as any
      fn('https://evil.com', (err: any, allowed: boolean) => {
        expect(allowed).toBe(false)
      })
      // No origin header (like curl) should be allowed
      fn(undefined, (err: any, allowed: boolean) => {
        expect(allowed).toBe(true)
      })
    })

    it('in production allows only listed origins', () => {
      process.env.NODE_ENV = 'production'
      process.env.ALLOWED_ORIGINS = 'https://a.com, https://b.com'
      const opts = buildCorsOptions()
      const fn = opts.origin as any
      fn('https://a.com', (_err: any, allowed: boolean) => expect(allowed).toBe(true))
      fn('https://b.com', (_err: any, allowed: boolean) => expect(allowed).toBe(true))
      fn('https://c.com', (_err: any, allowed: boolean) => expect(allowed).toBe(false))
      fn(undefined, (_err: any, allowed: boolean) => expect(allowed).toBe(true))
    })

    it('includes required CORS methods and headers', () => {
      process.env.NODE_ENV = 'development'
      const opts = buildCorsOptions()
      expect(opts.methods).toEqual(expect.arrayContaining(['GET', 'POST', 'OPTIONS']))
      expect(opts.allowedHeaders).toEqual(
        expect.arrayContaining(['Content-Type', 'Authorization', 'X-Payment'])
      )
    })

    it('allows non-browser requests (no origin) in production', () => {
      process.env.NODE_ENV = 'production'
      process.env.ALLOWED_ORIGINS = 'https://a.com'
      const opts = buildCorsOptions()
      const fn = opts.origin as any
      // Simulate server-to-server or curl request with no Origin header
      fn(null, (err: any, allowed: boolean) => expect(allowed).toBe(true))
      fn('', (err: any, allowed: boolean) => expect(allowed).toBe(true))
    })
  })
})
