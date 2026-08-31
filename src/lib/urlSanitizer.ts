/**
 * urlSanitizer.ts
 * Utility for normalizing and validating search result URLs.
 * Enforces http/https protocols only, rejects credential-bearing and malformed URLs,
 * and provides safe diagnostics.
 */

export interface UrlValidationResult {
  isValid: boolean
  normalizedUrl: string | null
  source: string
  error?: 'non_http_protocol' | 'credential_bearing' | 'malformed'
}

/**
 * Validates and normalizes a URL string.
 *
 * Acceptance Criteria:
 * - Scheme must be http: or https:
 * - Rejects credential-bearing URLs (e.g. http://user:pass@domain.com)
 * - Rejects malformed URLs (e.g. javascript:, data:, invalid syntax, missing hostname)
 * - Normalizes valid URLs
 *
 * @param rawUrl Raw URL string from upstream or user input
 * @returns UrlValidationResult detailing status, normalized URL, source hostname, or rejection reason
 */
export function validateAndNormalizeUrl(rawUrl: unknown): UrlValidationResult {
  if (typeof rawUrl !== 'string') {
    return {
      isValid: false,
      normalizedUrl: null,
      source: 'blocked',
      error: 'malformed',
    }
  }

  const trimmed = rawUrl.trim()
  if (!trimmed) {
    return {
      isValid: false,
      normalizedUrl: null,
      source: 'blocked',
      error: 'malformed',
    }
  }

  try {
    const parsed = new URL(trimmed)

    // Rejects schemes other than http and https (case-insensitive)
    const protocol = parsed.protocol.toLowerCase()
    if (protocol !== 'http:' && protocol !== 'https:') {
      return {
        isValid: false,
        normalizedUrl: null,
        source: 'blocked',
        error: 'non_http_protocol',
      }
    }

    // Rejects credential-bearing URLs
    if (parsed.username !== '' || parsed.password !== '') {
      return {
        isValid: false,
        normalizedUrl: null,
        source: 'blocked',
        error: 'credential_bearing',
      }
    }

    // Must have a valid non-empty hostname
    if (!parsed.hostname) {
      return {
        isValid: false,
        normalizedUrl: null,
        source: 'blocked',
        error: 'malformed',
      }
    }

    const source = parsed.hostname.replace(/^www\./i, '')

    return {
      isValid: true,
      normalizedUrl: parsed.href,
      source,
    }
  } catch {
    return {
      isValid: false,
      normalizedUrl: null,
      source: 'blocked',
      error: 'malformed',
    }
  }
}
