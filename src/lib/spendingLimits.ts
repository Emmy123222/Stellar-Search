/**
 * spendingLimits.ts
 * Client-side per-session and daily USDC spending caps (#313).
 *
 * A local guardrail against accidental repeated searches. The guard is
 * advisory: it runs in the browser before a paid search starts, reserves the
 * expected cost, and only counts a spend once the search settles with a
 * verified on-chain txHash (the receipt that x402 produced). It never
 * bypasses the Freighter approval popup or x402 settlement — it only blocks
 * the request *before* the payment flow is initiated.
 *
 * Multi-tab handling:
 *  - All state lives in localStorage, so every tab re-reads the same ledger
 *    on each guard check (localStorage is shared, writes are synchronous).
 *  - In-flight payments are tracked as *reservations* with a TTL. A search in
 *    tab A reserves its cost, so tab B's guard check sees it as pending and
 *    cannot double-spend past the cap. Stale reservations (crashed tabs)
 *    expire automatically after RESERVATION_TTL_MS.
 *  - Cross-tab UI sync uses the `storage` event in useSpendingLimits; the
 *    guard itself always reads fresh state, so it needs no event.
 *
 * Amounts are USDC strings (matching the rest of the codebase, e.g.
 * AMOUNT_USDC = '0.001'). Arithmetic is done on numbers rounded to 3 decimal
 * places (USDC micro-amount precision for this app is 0.001).
 */

export const SPEND_CONFIG_KEY = 'stellarsearch_spend_config'
export const SPEND_USAGE_KEY  = 'stellarsearch_spend_usage'

// Safe defaults: 0.001 USDC per query → 10 queries/session, 50 queries/day.
export const DEFAULT_SESSION_CAP_USDC = '0.01'
export const DEFAULT_DAILY_CAP_USDC   = '0.05'
export const DEFAULT_ENABLED          = true

// A "session" is a sliding window of activity: it resets after this much
// time passes without a settled spend.
export const SESSION_WINDOW_MS = 30 * 60 * 1000

// In-flight payment reservations older than this are treated as abandoned
// (e.g. the tab was closed mid-payment) and no longer count against caps.
export const RESERVATION_TTL_MS = 5 * 60 * 1000

export interface SpendConfig {
  /** Master switch — when false the guard lets every search through. */
  enabled: boolean
  /** Per-session cap in USDC. '0' (or absent) means no session limit. */
  sessionCap: string
  /** Per-calendar-day cap in USDC. '0' (or absent) means no daily limit. */
  dailyCap: string
}

export interface SpendReservation {
  /** USDC amount reserved for an in-flight (not yet settled) search. */
  amount: string
  startedAt: number
  expiresAt: number
}

export interface SpendUsage {
  /** Local calendar day (YYYY-MM-DD) the daily bucket belongs to. */
  date: string
  /** Verified spend so far today, in USDC. */
  dailySpent: string
  /** Opaque id for the current session window (debugging/display only). */
  sessionId: string
  sessionStartedAt: number
  /** Last time a spend settled into this session (drives the sliding window). */
  sessionLastSpendAt: number
  /** Verified spend in the current session window, in USDC. */
  sessionSpent: string
  /** In-flight payments that have not yet settled or been released. */
  reservations: SpendReservation[]
}

export type SpendLimitKind = 'session' | 'daily' | 'none'

export interface SpendCheck {
  allowed: boolean
  /** Which cap would be exceeded ('none' when allowed). */
  kind: SpendLimitKind
  sessionSpent: string
  dailySpent: string
  sessionCap: string
  dailyCap: string
}

// ─── low-level storage helpers ───────────────────────────────────────────────

function getStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

function readStorage(key: string): string | null {
  try {
    return getStorage()?.getItem(key) ?? null
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string): boolean {
  try {
    getStorage()?.setItem(key, value)
    return true
  } catch {
    // Storage unavailable (private mode, test env, SSR) — the ledger simply
    // won't persist, the guard still runs for the current in-memory check.
    return false
  }
}

// ─── amount helpers ──────────────────────────────────────────────────────────

/** Parses a USDC string to a number, or NaN when invalid. */
export function parseUsdc(value: string): number {
  const n = parseFloat(value)
  return Number.isFinite(n) ? n : NaN
}

/** Rounds to USDC micro precision (3 decimals) and back to a string. */
export function fmtUsdc(n: number): string {
  if (!Number.isFinite(n)) return '0'
  return String(Math.round(n * 1000) / 1000)
}

function localDateKey(now: Date): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function newSessionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function sumUsdc(values: string[]): string {
  let total = 0
  for (const v of values) {
    const n = parseUsdc(v)
    if (Number.isFinite(n)) total += n
  }
  return fmtUsdc(total)
}

// ─── config ──────────────────────────────────────────────────────────────────

const EMPTY_CONFIG: SpendConfig = {
  enabled: DEFAULT_ENABLED,
  sessionCap: DEFAULT_SESSION_CAP_USDC,
  dailyCap: DEFAULT_DAILY_CAP_USDC,
}

/** Validates a stored config value, falling back to defaults per field. */
function normalizeConfig(raw: unknown): SpendConfig {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const fallback: SpendConfig = { ...EMPTY_CONFIG }

  const sessionCap = typeof obj.sessionCap === 'string' ? parseUsdc(obj.sessionCap) : NaN
  const dailyCap   = typeof obj.dailyCap   === 'string' ? parseUsdc(obj.dailyCap)   : NaN

  return {
    enabled: typeof obj.enabled === 'boolean' ? obj.enabled : fallback.enabled,
    sessionCap: Number.isFinite(sessionCap) && sessionCap >= 0 ? fmtUsdc(sessionCap) : fallback.sessionCap,
    dailyCap:   Number.isFinite(dailyCap)   && dailyCap   >= 0 ? fmtUsdc(dailyCap)   : fallback.dailyCap,
  }
}

/**
 * Reads the current spend config. Corrupt/invalid values fall back to the
 * safe defaults per field, so a bad write can never widen the guard.
 */
export function getSpendConfig(): SpendConfig {
  const raw = readStorage(SPEND_CONFIG_KEY)
  if (raw === null) return { ...EMPTY_CONFIG }
  try {
    return normalizeConfig(JSON.parse(raw))
  } catch {
    return { ...EMPTY_CONFIG }
  }
}

export function setSpendConfig(config: SpendConfig): SpendConfig {
  const normalized = normalizeConfig(config)
  writeStorage(SPEND_CONFIG_KEY, JSON.stringify(normalized))
  return normalized
}

// ─── usage ledger ────────────────────────────────────────────────────────────

function emptyUsage(now: number): SpendUsage {
  return {
    date: localDateKey(new Date(now)),
    dailySpent: '0',
    sessionId: newSessionId(),
    sessionStartedAt: now,
    sessionLastSpendAt: 0,
    sessionSpent: '0',
    reservations: [],
  }
}

function normalizeUsage(raw: unknown, now: number): SpendUsage {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>

  const toSpent = (v: unknown, fallback: string): string => {
    const n = typeof v === 'string' ? parseUsdc(v) : NaN
    return Number.isFinite(n) && n >= 0 ? fmtUsdc(n) : fallback
  }
  const toNum = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback

  const reservations = Array.isArray(obj.reservations)
    ? obj.reservations.filter(
        (r): r is SpendReservation =>
          !!r && typeof r === 'object' &&
          typeof (r as SpendReservation).amount === 'string' &&
          typeof (r as SpendReservation).startedAt === 'number' &&
          typeof (r as SpendReservation).expiresAt === 'number'
      )
    : []

  return {
    date: typeof obj.date === 'string' ? obj.date : localDateKey(new Date(now)),
    dailySpent: toSpent(obj.dailySpent, '0'),
    sessionId: typeof obj.sessionId === 'string' ? obj.sessionId : newSessionId(),
    sessionStartedAt: toNum(obj.sessionStartedAt, now),
    sessionLastSpendAt: toNum(obj.sessionLastSpendAt, 0),
    sessionSpent: toSpent(obj.sessionSpent, '0'),
    reservations,
  }
}

/**
 * Reads and reconciles the usage ledger for `now`:
 *  - rolls the daily bucket when the local date changed,
 *  - resets the session window after SESSION_WINDOW_MS without a spend,
 *  - drops reservations that outlived their TTL.
 */
export function getSpendUsage(now: number = Date.now()): SpendUsage {
  const raw = readStorage(SPEND_USAGE_KEY)
  let usage: SpendUsage
  if (raw === null) {
    usage = emptyUsage(now)
  } else {
    try {
      usage = normalizeUsage(JSON.parse(raw), now)
    } catch {
      usage = emptyUsage(now)
    }
  }

  const today = localDateKey(new Date(now))
  if (usage.date !== today) {
    usage = { ...usage, date: today, dailySpent: '0' }
  }

  const idle = now - usage.sessionLastSpendAt
  if (usage.sessionLastSpendAt === 0 || idle > SESSION_WINDOW_MS) {
    usage = {
      ...usage,
      sessionId: newSessionId(),
      sessionStartedAt: now,
      sessionLastSpendAt: 0,
      sessionSpent: '0',
    }
  }

  const live = usage.reservations.filter((r) => r.expiresAt > now)
  if (live.length !== usage.reservations.length) {
    usage = { ...usage, reservations: live }
  }

  return usage
}

function writeSpendUsage(usage: SpendUsage): void {
  writeStorage(SPEND_USAGE_KEY, JSON.stringify(usage))
}

/** Clears the ledger (used by tests and the dashboard "reset" affordance). */
export function resetSpendUsage(now: number = Date.now()): SpendUsage {
  const usage = emptyUsage(now)
  writeSpendUsage(usage)
  return usage
}

// ─── guard checks ────────────────────────────────────────────────────────────

function sessionPending(usage: SpendUsage): string {
  return sumUsdc(usage.reservations.map((r) => r.amount))
}

/**
 * Pure guard check: would spending `costUsdc` now stay under both caps?
 * Pending reservations count toward the caps, so a search already in flight
 * in another tab is not double-spendable.
 *
 * A cap of '0' means "no limit" for that bucket. `config.enabled === false`
 * always allows.
 */
export function checkSpendLimit(
  config: SpendConfig,
  usage: SpendUsage,
  costUsdc: string
): SpendCheck {
  const sessionSpent = parseUsdc(usage.sessionSpent)
  const dailySpent   = parseUsdc(usage.dailySpent)
  const pending      = parseUsdc(sessionPending(usage))
  const cost         = parseUsdc(costUsdc)

  const sessionCap = parseUsdc(config.sessionCap)
  const dailyCap   = parseUsdc(config.dailyCap)

  const sessionCapNum = Number.isFinite(sessionCap) ? sessionCap : 0
  const dailyCapNum   = Number.isFinite(dailyCap)   ? dailyCap   : 0
  const spent = (n: number) => (Number.isFinite(n) ? n : 0)

  let kind: SpendLimitKind = 'none'
  if (config.enabled) {
    const sessionTotal = spent(sessionSpent) + spent(pending) + spent(cost)
    const dailyTotal   = spent(dailySpent)   + spent(pending) + spent(cost)
    // 0.001 granularity; tolerate float noise below half a micro-unit.
    if (sessionCapNum > 0 && sessionTotal > sessionCapNum + 0.0005) {
      kind = 'session'
    } else if (dailyCapNum > 0 && dailyTotal > dailyCapNum + 0.0005) {
      kind = 'daily'
    }
  }

  return {
    allowed: kind === 'none',
    kind,
    sessionSpent: usage.sessionSpent,
    dailySpent: usage.dailySpent,
    sessionCap: fmtUsdc(sessionCapNum),
    dailyCap: fmtUsdc(dailyCapNum),
  }
}

// ─── reservations & settlement ───────────────────────────────────────────────

/**
 * Records an in-flight payment. Called right before the x402 flow starts so
 * other tabs (and this one) treat the cost as pending until it settles or is
 * released. Returns the reconciled usage.
 */
export function reserveSpend(costUsdc: string, now: number = Date.now()): SpendUsage {
  const usage = getSpendUsage(now)
  const amount = fmtUsdc(parseUsdc(costUsdc))
  if (parseUsdc(amount) <= 0) return usage
  const next: SpendUsage = {
    ...usage,
    reservations: [
      ...usage.reservations,
      { amount, startedAt: now, expiresAt: now + RESERVATION_TTL_MS },
    ],
  }
  writeSpendUsage(next)
  return next
}

/**
 * Marks a *verified* search settled (server returned a txHash): removes its
 * reservation and adds the cost to the session and daily buckets. Only call
 * this for payments that actually settled — otherwise use `releaseSpend`.
 * Returns the reconciled usage.
 */
export function settleSpend(costUsdc: string, now: number = Date.now()): SpendUsage {
  const usage = getSpendUsage(now)
  const amount = fmtUsdc(parseUsdc(costUsdc))
  const amountNum = parseUsdc(amount)

  const reservations = [...usage.reservations]
  const idx = reservations.findIndex((r) => r.amount === amount)
  if (idx >= 0) reservations.splice(idx, 1)

  let next: SpendUsage = { ...usage, reservations }

  if (amountNum > 0) {
    next = {
      ...next,
      sessionLastSpendAt: now,
      sessionSpent: fmtUsdc(parseUsdc(next.sessionSpent) + amountNum),
      dailySpent: fmtUsdc(parseUsdc(next.dailySpent) + amountNum),
    }
  }

  writeSpendUsage(next)
  return next
}

/**
 * Releases a reservation without counting the spend (search failed, was
 * free, or never reached settlement). Returns the reconciled usage.
 */
export function releaseSpend(costUsdc: string, now: number = Date.now()): SpendUsage {
  const usage = getSpendUsage(now)
  const amount = fmtUsdc(parseUsdc(costUsdc))
  const reservations = [...usage.reservations]
  const idx = reservations.findIndex((r) => r.amount === amount)
  if (idx >= 0) reservations.splice(idx, 1)
  const next: SpendUsage = { ...usage, reservations }
  writeSpendUsage(next)
  return next
}
