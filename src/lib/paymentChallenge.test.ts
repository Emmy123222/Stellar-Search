import { describe, it, expect } from 'vitest'
import {
  CHALLENGE_EXPIRED_MESSAGE,
  DEFAULT_CHALLENGE_TIMEOUT_SECONDS,
  formatCountdown,
  isChallengeExpired,
  readChallengeDeadline,
  remainingMs,
} from './paymentChallenge'

/**
 * Payment challenge deadlines (#114).
 *
 * The x402 `PAYMENT-REQUIRED` payload tells the client how long its signed
 * authorization stays valid. These helpers turn that into a countdown and an
 * expiry gate so the UI can explain an expiration and offer a fresh challenge
 * instead of a generic failure.
 */

describe('readChallengeDeadline', () => {
  const NOW = 1_700_000_000_000

  it('reads maxTimeoutSeconds from the first accepted payment option', () => {
    const deadline = readChallengeDeadline({ accepts: [{ maxTimeoutSeconds: 120 }] }, NOW)
    expect(deadline).toEqual({ issuedAt: NOW, expiresAt: NOW + 120_000, maxTimeoutSeconds: 120 })
  })

  it('falls back to the documented window when the field is absent or invalid', () => {
    for (const accepts of [
      [{}],
      [{ maxTimeoutSeconds: 0 }],
      [{ maxTimeoutSeconds: -5 }],
      [{ maxTimeoutSeconds: '300' }],
      [{ maxTimeoutSeconds: Number.NaN }],
      [{ maxTimeoutSeconds: Number.POSITIVE_INFINITY }],
    ]) {
      const deadline = readChallengeDeadline({ accepts }, NOW)
      expect(deadline?.maxTimeoutSeconds).toBe(DEFAULT_CHALLENGE_TIMEOUT_SECONDS)
      expect(deadline?.expiresAt).toBe(NOW + DEFAULT_CHALLENGE_TIMEOUT_SECONDS * 1000)
    }
  })

  it('returns null when there is nothing to sign', () => {
    expect(readChallengeDeadline({ accepts: [] }, NOW)).toBeNull()
    expect(readChallengeDeadline({}, NOW)).toBeNull()
    expect(readChallengeDeadline({ accepts: 'nope' }, NOW)).toBeNull()
    expect(readChallengeDeadline(null, NOW)).toBeNull()
    expect(readChallengeDeadline(undefined, NOW)).toBeNull()
  })

  it('uses the documented default of 300 seconds (aligned with payment integrity)', () => {
    expect(DEFAULT_CHALLENGE_TIMEOUT_SECONDS).toBe(300)
  })
})

describe('remainingMs / isChallengeExpired', () => {
  const deadline = { issuedAt: 1_000, expiresAt: 5_000, maxTimeoutSeconds: 4 }

  it('reports the time left, clamped at zero', () => {
    expect(remainingMs(deadline, 1_000)).toBe(4_000)
    expect(remainingMs(deadline, 4_999)).toBe(1)
    expect(remainingMs(deadline, 5_000)).toBe(0)
    expect(remainingMs(deadline, 9_999)).toBe(0)
  })

  it('treats a missing deadline as unbounded rather than expired', () => {
    expect(remainingMs(null)).toBeNull()
    expect(remainingMs(undefined)).toBeNull()
    expect(isChallengeExpired(null)).toBe(false)
    expect(isChallengeExpired(undefined)).toBe(false)
  })

  it('expires exactly at expiresAt', () => {
    expect(isChallengeExpired(deadline, 4_999)).toBe(false)
    expect(isChallengeExpired(deadline, 5_000)).toBe(true)
    expect(isChallengeExpired(deadline, 5_001)).toBe(true)
  })
})

describe('formatCountdown', () => {
  it('formats as m:ss with zero padding', () => {
    expect(formatCountdown(300_000)).toBe('5:00')
    expect(formatCountdown(299_000)).toBe('4:59')
    expect(formatCountdown(61_000)).toBe('1:01')
    expect(formatCountdown(9_000)).toBe('0:09')
    expect(formatCountdown(0)).toBe('0:00')
  })

  it('rounds up partial seconds so the display never shows 0:00 while time remains', () => {
    expect(formatCountdown(1)).toBe('0:01')
    expect(formatCountdown(999)).toBe('0:01')
    expect(formatCountdown(1_400)).toBe('0:02')
  })

  it('renders a placeholder for an unknown duration', () => {
    expect(formatCountdown(null)).toBe('--:--')
    expect(formatCountdown(undefined)).toBe('--:--')
    expect(formatCountdown(Number.NaN)).toBe('--:--')
  })

  it('never renders a negative duration', () => {
    expect(formatCountdown(-5_000)).toBe('0:00')
  })
})

describe('CHALLENGE_EXPIRED_MESSAGE', () => {
  it('states that nothing was sent and points at the retry path', () => {
    expect(CHALLENGE_EXPIRED_MESSAGE).toMatch(/expired/i)
    expect(CHALLENGE_EXPIRED_MESSAGE).toMatch(/no payment was sent/i)
    expect(CHALLENGE_EXPIRED_MESSAGE).toMatch(/retry/i)
  })
})
