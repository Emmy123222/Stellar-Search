import { describe, it, expect } from 'vitest'
import { mapSerperStatus, mapSerperNetworkError } from './serperError'
import { SerperErrorCode } from '../types/index'

describe('mapSerperStatus', () => {
  it('maps 401 to AUTH_FAILURE with 503', () => {
    const result = mapSerperStatus(401)
    expect(result.httpStatus).toBe(503)
    expect(result.body.providerCode).toBe(SerperErrorCode.AUTH_FAILURE)
    expect(result.body.error).toContain('invalid or missing')
  })

  it('maps 403 to QUOTA_EXCEEDED with 503', () => {
    const result = mapSerperStatus(403)
    expect(result.httpStatus).toBe(503)
    expect(result.body.providerCode).toBe(SerperErrorCode.QUOTA_EXCEEDED)
    expect(result.body.error).toContain('quota')
  })

  it('maps 429 to RATE_LIMITED with 429', () => {
    const result = mapSerperStatus(429)
    expect(result.httpStatus).toBe(429)
    expect(result.body.providerCode).toBe(SerperErrorCode.RATE_LIMITED)
    expect(result.body.error).toContain('rate limit')
  })

  it('maps 500 to PROVIDER_ERROR with 502', () => {
    const result = mapSerperStatus(500)
    expect(result.httpStatus).toBe(502)
    expect(result.body.providerCode).toBe(SerperErrorCode.PROVIDER_ERROR)
    expect(result.body.error).toContain('server error')
  })

  it('maps 502 to PROVIDER_ERROR with 502', () => {
    const result = mapSerperStatus(502)
    expect(result.httpStatus).toBe(502)
    expect(result.body.providerCode).toBe(SerperErrorCode.PROVIDER_ERROR)
  })

  it('maps 503 to PROVIDER_ERROR with 502', () => {
    const result = mapSerperStatus(503)
    expect(result.httpStatus).toBe(502)
    expect(result.body.providerCode).toBe(SerperErrorCode.PROVIDER_ERROR)
  })

  it('maps unknown 4xx to PROVIDER_ERROR with 502', () => {
    const result = mapSerperStatus(418)
    expect(result.httpStatus).toBe(502)
    expect(result.body.providerCode).toBe(SerperErrorCode.PROVIDER_ERROR)
  })

  it('always includes providerCode in body', () => {
    for (const status of [401, 403, 429, 500, 502, 503, 418]) {
      const result = mapSerperStatus(status)
      expect(result.body.providerCode).toBeDefined()
      expect(Object.values(SerperErrorCode)).toContain(result.body.providerCode)
    }
  })
})

describe('mapSerperNetworkError', () => {
  it('returns 502 with NETWORK_ERROR code', () => {
    const result = mapSerperNetworkError()
    expect(result.httpStatus).toBe(502)
    expect(result.body.providerCode).toBe(SerperErrorCode.NETWORK_ERROR)
    expect(result.body.error).toContain('Unable to reach')
  })
})

describe('error code stability', () => {
  it('all error codes are unique strings', () => {
    const codes = Object.values(SerperErrorCode)
    const unique = new Set(codes)
    expect(unique.size).toBe(codes.length)
  })

  it('every mapped status produces a stable, client-safe error code', () => {
    const statuses = [401, 403, 429, 500, 502, 503, 418]
    const clientCodes = statuses.map((s) => mapSerperStatus(s).body.providerCode)
    for (const code of clientCodes) {
      expect(code).toMatch(/^SERPER_/)
    }
  })
})
