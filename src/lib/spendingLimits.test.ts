import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  SPEND_CONFIG_KEY,
  SPEND_USAGE_KEY,
  DEFAULT_SESSION_CAP_USDC,
  DEFAULT_DAILY_CAP_USDC,
  SESSION_WINDOW_MS,
  RESERVATION_TTL_MS,
  getSpendConfig,
  setSpendConfig,
  getSpendUsage,
  resetSpendUsage,
  checkSpendLimit,
  reserveSpend,
  settleSpend,
  releaseSpend,
  parseUsdc,
  fmtUsdc,
} from './spendingLimits'

// This test environment's window.localStorage has every method undefined (a
// pre-existing jsdom/vitest quirk, see useSearch.test.ts), so stub an
// in-memory implementation — exactly what a real browser tab provides.
function stubLocalStorage() {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
  })
  return store
}

// Fixed "now" — Sep 1, 2026 12:00 local time.
const T0 = new Date(2026, 8, 1, 12, 0, 0).getTime()
const HOUR = 60 * 60 * 1000

describe('spendingLimits — config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stubLocalStorage()
  })

  it('returns safe defaults when nothing is stored', () => {
    expect(getSpendConfig()).toEqual({
      enabled: true,
      sessionCap: DEFAULT_SESSION_CAP_USDC,
      dailyCap: DEFAULT_DAILY_CAP_USDC,
    })
  })

  it('falls back to defaults for corrupt JSON', () => {
    localStorage.setItem(SPEND_CONFIG_KEY, '{not json')
    expect(getSpendConfig().sessionCap).toBe(DEFAULT_SESSION_CAP_USDC)
    expect(getSpendConfig().dailyCap).toBe(DEFAULT_DAILY_CAP_USDC)
    expect(getSpendConfig().enabled).toBe(true)
  })

  it('normalizes invalid fields per-field and never widens the guard', () => {
    localStorage.setItem(
      SPEND_CONFIG_KEY,
      JSON.stringify({ enabled: false, sessionCap: '-5', dailyCap: 'abc' })
    )
    const config = getSpendConfig()
    expect(config.enabled).toBe(false)
    expect(config.sessionCap).toBe(DEFAULT_SESSION_CAP_USDC) // negative → default
    expect(config.dailyCap).toBe(DEFAULT_DAILY_CAP_USDC)      // non-numeric → default
  })

  it('round-trips a valid custom config (normalized to 3 decimals)', () => {
    const saved = setSpendConfig({ enabled: true, sessionCap: '0.02', dailyCap: '0.100' })
    expect(saved.sessionCap).toBe('0.02')
    expect(saved.dailyCap).toBe('0.1')
    expect(getSpendConfig()).toEqual(saved)
  })
})

describe('spendingLimits — usage ledger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stubLocalStorage()
  })

  it('starts empty with today’s date', () => {
    const usage = getSpendUsage(T0)
    expect(usage.date).toBe('2026-09-01')
    expect(usage.sessionSpent).toBe('0')
    expect(usage.dailySpent).toBe('0')
    expect(usage.reservations).toEqual([])
  })

  it('resets the daily bucket when the local date changes', () => {
    settleSpend('0.001', T0)
    const today = getSpendUsage(T0)
    expect(today.dailySpent).toBe('0.001')

    const nextDay = T0 + 24 * HOUR
    const rolled = getSpendUsage(nextDay)
    expect(rolled.date).toBe('2026-09-02')
    expect(rolled.dailySpent).toBe('0')
  })

  it('resets the session bucket after the sliding window goes idle', () => {
    settleSpend('0.001', T0)
    expect(getSpendUsage(T0).sessionSpent).toBe('0.001')

    // A spend within the window keeps the session.
    expect(getSpendUsage(T0 + 10 * 60 * 1000).sessionSpent).toBe('0.001')

    // Past the window the session resets.
    const reset = getSpendUsage(T0 + SESSION_WINDOW_MS + 1000)
    expect(reset.sessionSpent).toBe('0')
    expect(reset.dailySpent).toBe('0.001') // daily bucket unaffected
  })

  it('expires stale reservations (crashed tabs) after their TTL', () => {
    reserveSpend('0.001', T0)
    expect(getSpendUsage(T0).reservations).toHaveLength(1)
    expect(getSpendUsage(T0 + RESERVATION_TTL_MS + 1).reservations).toHaveLength(0)
  })

  it('recovers from corrupt usage JSON', () => {
    localStorage.setItem(SPEND_USAGE_KEY, 'garbage')
    const usage = getSpendUsage(T0)
    expect(usage.dailySpent).toBe('0')
    expect(usage.reservations).toEqual([])
  })

  it('resetSpendUsage clears the ledger', () => {
    settleSpend('0.001', T0)
    reserveSpend('0.001', T0)
    const cleared = resetSpendUsage(T0)
    expect(cleared.sessionSpent).toBe('0')
    expect(cleared.dailySpent).toBe('0')
    expect(cleared.reservations).toEqual([])
  })

  it('rejects malformed reservation entries', () => {
    localStorage.setItem(
      SPEND_USAGE_KEY,
      JSON.stringify({
        date: '2026-09-01',
        dailySpent: '0.001',
        sessionId: 's',
        sessionStartedAt: T0,
        sessionLastSpendAt: T0,
        sessionSpent: '0.001',
        reservations: [
          { amount: '0.001', startedAt: T0, expiresAt: T0 + 1000 },
          { amount: 'oops' },
          null,
        ],
      })
    )
    const usage = getSpendUsage(T0)
    expect(usage.reservations).toHaveLength(1)
    expect(usage.reservations[0].amount).toBe('0.001')
  })
})

describe('spendingLimits — guard checks', () => {
  const config = { enabled: true, sessionCap: '0.01', dailyCap: '0.05' }

  beforeEach(() => {
    vi.clearAllMocks()
    stubLocalStorage()
  })

  it('allows a single search under the caps', () => {
    const usage = getSpendUsage(T0)
    const check = checkSpendLimit(config, usage, '0.001')
    expect(check.allowed).toBe(true)
    expect(check.kind).toBe('none')
  })

  it('blocks when the session cap would be exceeded', () => {
    // 10 settled searches = 0.01 sessionSpent == session cap.
    for (let i = 0; i < 10; i++) settleSpend('0.001', T0)
    const usage = getSpendUsage(T0)
    const check = checkSpendLimit(config, usage, '0.001')
    expect(check.allowed).toBe(false)
    expect(check.kind).toBe('session')
    expect(check.sessionSpent).toBe('0.01')
    expect(check.sessionCap).toBe('0.01')
  })

  it('blocks when the daily cap would be exceeded even if the session is fresh', () => {
    // Seed a fresh session but an exhausted daily bucket (e.g. from earlier
    // in the day via a different session window).
    for (let i = 0; i < 50; i++) settleSpend('0.001', T0 - 40 * 60 * 1000)
    const usage = getSpendUsage(T0)
    expect(usage.dailySpent).toBe('0.05')
    expect(usage.sessionSpent).toBe('0') // fresh session
    const check = checkSpendLimit(config, usage, '0.001')
    expect(check.allowed).toBe(false)
    expect(check.kind).toBe('daily')
  })

  it('counts pending reservations from other tabs against the caps', () => {
    // "Tab A" starts 10 searches and reserves them (0.01 pending == session cap).
    for (let i = 0; i < 10; i++) reserveSpend('0.001', T0)
    const usage = getSpendUsage(T0)
    const check = checkSpendLimit(config, usage, '0.001')
    expect(check.allowed).toBe(false)
    expect(check.kind).toBe('session')
    expect(usage.reservations).toHaveLength(10)
  })

  it('allows exactly up to the cap (spent + cost == cap)', () => {
    for (let i = 0; i < 9; i++) settleSpend('0.001', T0)
    const usage = getSpendUsage(T0)
    expect(checkSpendLimit(config, usage, '0.001').allowed).toBe(true) // 0.009 + 0.001 = 0.01
    expect(checkSpendLimit(config, usage, '0.002').allowed).toBe(false) // 0.009 + 0.002 > 0.01
  })

  it('a cap of 0 means no limit for that bucket', () => {
    const unlimited = { enabled: true, sessionCap: '0', dailyCap: '0' }
    for (let i = 0; i < 100; i++) settleSpend('0.001', T0)
    const usage = getSpendUsage(T0)
    const check = checkSpendLimit(unlimited, usage, '0.001')
    expect(check.allowed).toBe(true)
    expect(check.sessionCap).toBe('0')
  })

  it('disabled config always allows', () => {
    const disabled = { enabled: false, sessionCap: '0.01', dailyCap: '0.05' }
    for (let i = 0; i < 50; i++) settleSpend('0.001', T0)
    const usage = getSpendUsage(T0)
    expect(checkSpendLimit(disabled, usage, '0.001').allowed).toBe(true)
  })
})

describe('spendingLimits — reservations & settlement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stubLocalStorage()
  })

  it('reserve -> settle moves the cost into both buckets', () => {
    reserveSpend('0.001', T0)
    const before = getSpendUsage(T0)
    expect(before.reservations).toHaveLength(1)

    settleSpend('0.001', T0)
    const after = getSpendUsage(T0)
    expect(after.reservations).toHaveLength(0)
    expect(after.sessionSpent).toBe('0.001')
    expect(after.dailySpent).toBe('0.001')
    expect(after.sessionLastSpendAt).toBe(T0)
  })

  it('release removes the reservation without counting the spend', () => {
    reserveSpend('0.001', T0)
    releaseSpend('0.001', T0)
    const usage = getSpendUsage(T0)
    expect(usage.reservations).toHaveLength(0)
    expect(usage.sessionSpent).toBe('0')
    expect(usage.dailySpent).toBe('0')
  })

  it('reserve/release are no-ops for a zero amount', () => {
    reserveSpend('0', T0)
    expect(getSpendUsage(T0).reservations).toHaveLength(0)
  })

  it('settling without a matching reservation still records the spend', () => {
    // Verified receipts are ground truth even if the reservation expired.
    settleSpend('0.001', T0)
    expect(getSpendUsage(T0).sessionSpent).toBe('0.001')
  })

  it('only removes the matching (oldest) reservation', () => {
    reserveSpend('0.001', T0)
    reserveSpend('0.002', T0 + 1000)
    settleSpend('0.001', T0 + 2000)
    const usage = getSpendUsage(T0 + 2000)
    expect(usage.reservations).toHaveLength(1)
    expect(usage.reservations[0].amount).toBe('0.002')
    expect(usage.sessionSpent).toBe('0.001')
  })

  it('rounds sums to USDC micro precision (3 decimals)', () => {
    settleSpend('0.001', T0)
    settleSpend('0.001', T0 + 1000)
    settleSpend('0.001', T0 + 2000)
    expect(getSpendUsage(T0 + 2000).sessionSpent).toBe('0.003')
  })

  it('simulates two tabs sharing the ledger without double-spending', () => {
    // Tab A reserves 10 searches (0.01 pending); Tab B reads the same
    // storage and sees them pending, so it cannot start an 11th.
    for (let i = 0; i < 10; i++) reserveSpend('0.001', T0)
    const tabBUsage = getSpendUsage(T0)
    expect(checkSpendLimit({ enabled: true, sessionCap: '0.01', dailyCap: '0.05' }, tabBUsage, '0.001').allowed).toBe(false)

    // Once Tab A settles, the pending clears and Tab B can spend again.
    for (let i = 0; i < 10; i++) settleSpend('0.001', T0)
    const afterSettle = getSpendUsage(T0)
    expect(checkSpendLimit({ enabled: true, sessionCap: '0.01', dailyCap: '0.05' }, afterSettle, '0.001').allowed).toBe(false) // 0.01 settled + 0.001 > cap
    expect(afterSettle.reservations).toHaveLength(0)
  })
})

describe('spendingLimits — amount helpers', () => {
  it('parseUsdc returns NaN for junk', () => {
    expect(parseUsdc('abc')).toBeNaN()
    expect(parseUsdc('')).toBeNaN()
    expect(parseUsdc('0.001')).toBe(0.001)
  })

  it('fmtUsdc rounds to 3 decimals', () => {
    expect(fmtUsdc(0.001 + 0.001)).toBe('0.002')
    expect(fmtUsdc(0.1)).toBe('0.1')
    expect(fmtUsdc(Number.NaN)).toBe('0')
    expect(fmtUsdc(Number.POSITIVE_INFINITY)).toBe('0')
  })
})
