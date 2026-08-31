import { describe, expect, it } from 'vitest'
import { validateAndNormalizeUrl } from './urlSanitizer'

describe('validateAndNormalizeUrl', () => {
  it('accepts valid http and https URLs and normalizes them', () => {
    const res1 = validateAndNormalizeUrl('https://example.com/path?q=1')
    expect(res1.isValid).toBe(true)
    expect(res1.normalizedUrl).toBe('https://example.com/path?q=1')
    expect(res1.source).toBe('example.com')
    expect(res1.error).toBeUndefined()

    const res2 = validateAndNormalizeUrl('HTTP://WWW.STELLAR.ORG/blog')
    expect(res2.isValid).toBe(true)
    expect(res2.normalizedUrl).toBe('http://www.stellar.org/blog')
    expect(res2.source).toBe('stellar.org')
  })

  it('rejects non-http and non-https schemes', () => {
    const maliciousSchemes = [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'ftp://files.example.com',
      'blob:https://example.com/guid',
      'vbscript:msgbox(1)',
      'ws://websocket.example.com',
    ]

    for (const url of maliciousSchemes) {
      const res = validateAndNormalizeUrl(url)
      expect(res.isValid).toBe(false)
      expect(res.normalizedUrl).toBeNull()
      expect(res.error).toBe('non_http_protocol')
    }
  })

  it('rejects credential-bearing URLs', () => {
    const credentialUrls = [
      'http://user:password@example.com/resource',
      'https://admin@secure.com',
      'https://:secretpass@example.com',
      'http://user:@example.com',
    ]

    for (const url of credentialUrls) {
      const res = validateAndNormalizeUrl(url)
      expect(res.isValid).toBe(false)
      expect(res.normalizedUrl).toBeNull()
      expect(res.error).toBe('credential_bearing')
    }
  })

  it('rejects malformed URLs and non-strings', () => {
    const malformed = [
      'not a url',
      'http://',
      'https://',
      '',
      '   ',
      null,
      undefined,
      123,
    ]

    for (const val of malformed) {
      const res = validateAndNormalizeUrl(val)
      expect(res.isValid).toBe(false)
      expect(res.normalizedUrl).toBeNull()
      expect(res.error).toBe('malformed')
    }
  })
})
