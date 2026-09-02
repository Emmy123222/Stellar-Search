/**
 * serverHealth.ts
 *
 * The shared `/health` statistics contract (issue #226).
 *
 * Express keeps in-process counters (`totalQueries`, `totalUsdcSettled`,
 * `avgLatencyMs`, `uptime`) and reports them. Vercel functions cannot: they are
 * stateless, scale to zero, and each invocation may land on a fresh instance,
 * so an in-memory counter there would report the current instance's lifetime
 * rather than the deployment's activity.
 *
 * Before this contract existed, the serverless handler simply omitted those
 * four fields and the UI coalesced the absent values to `0` / `'0.00'` — so a
 * Vercel deployment rendered "0 queries, $0.00 settled, 0ms" beside a green
 * "SERVER ONLINE" indicator. Those are not measurements; they are missing data
 * presented as fact.
 *
 * So every runtime now *declares* what it measures:
 *
 *   - Express            → `statsSupported: true`,  `unsupportedFields: []`
 *   - Vercel serverless  → `statsSupported: false`, `unsupportedFields: [...]`
 *                          plus a human-readable `statsUnavailableReason`
 *
 * Consumers (the browser StatsGrid and the MCP `get_search_stats` tool) call
 * `resolveStat()` rather than reading the fields directly, so an unmeasured
 * field can never be mistaken for a real zero.
 *
 * This contract covers reporting only. It does not touch the paid routes or
 * their verified x402 settlement semantics.
 */

/** The activity statistics a `/health` response may report. */
export const MEASURED_STAT_FIELDS = [
  'totalQueries',
  'totalUsdcSettled',
  'avgLatencyMs',
  'uptime',
] as const

export type MeasuredStatField = (typeof MEASURED_STAT_FIELDS)[number]

/** Why a stateless serverless deployment reports no activity counters. */
export const SERVERLESS_STATS_UNAVAILABLE_REASON =
  'Serverless functions are stateless and scale to zero, so per-instance counters would reset on every cold start instead of reporting deployment activity. Run the Express server (npm run server) for live counters.'

/** Shown when a deployment omits a field without declaring anything. */
export const UNDECLARED_STAT_REASON =
  'This deployment did not report the metric and did not declare whether it measures it.'

/** Shown when the health endpoint could not be reached at all. */
export const SERVER_UNREACHABLE_REASON = 'The server health endpoint could not be reached.'

/**
 * The stats half of a `/health` payload: what this runtime measures, and — when
 * it measures nothing — why.
 */
export interface HealthStatsDeclaration {
  /** True when this runtime measures and reports every `MEASURED_STAT_FIELDS` entry. */
  statsSupported: boolean
  /** Fields this runtime does not measure. Empty when `statsSupported` is true. */
  unsupportedFields: MeasuredStatField[]
  /** Human-readable explanation. Present only when a field is unsupported. */
  statsUnavailableReason?: string
}

/** The activity counters themselves, present only on a runtime that measures them. */
export interface HealthStats {
  totalQueries: number
  /** Fixed-point USDC string, e.g. `"0.0040"`. */
  totalUsdcSettled: string
  avgLatencyMs: number
  /** Compact duration, e.g. `"42s"`, `"7m"`, `"3h"`. */
  uptime: string
}

/** Configuration and settlement facts every runtime reports. */
export interface HealthConfig {
  status: 'ok'
  network: string
  pricePerQuery: string
  protocol: 'x402'
  facilitator: string
  serperApiConfigured: boolean
  groqApiConfigured: boolean
  receivingAddressConfigured: boolean
  timestamp?: string
}

export type ServerHealthResponse = HealthConfig & HealthStatsDeclaration & Partial<HealthStats>

/**
 * Declares that this runtime measures every statistic — used by Express, which
 * holds counters in the process serving the paid routes.
 *
 * @returns The declaration to spread into a `/health` response.
 */
export function declareStatsSupported(): HealthStatsDeclaration {
  return { statsSupported: true, unsupportedFields: [] }
}

/**
 * Declares that this runtime measures none of the activity statistics — used by
 * the Vercel functions, which have nowhere durable to keep a counter.
 *
 * @param reason Why the statistics are unavailable here.
 * @returns The declaration to spread into a `/health` response.
 */
export function declareStatsUnsupported(reason: string): HealthStatsDeclaration {
  return {
    statsSupported: false,
    unsupportedFields: [...MEASURED_STAT_FIELDS],
    statsUnavailableReason: reason,
  }
}

/** One statistic, resolved to either a real measurement or an explained absence. */
export type StatResolution =
  | { available: true; value: number | string }
  | { available: false; reason: string }

/**
 * Reads one statistic from a health payload, keeping a genuine measurement
 * distinct from an unmeasured field.
 *
 * A real `0` — a freshly started Express server that has served no queries —
 * resolves as `{ available: true, value: 0 }`. A field the runtime does not
 * measure resolves as `{ available: false, reason }`, never as zero.
 *
 * Tolerates a health payload from a deployment that predates this contract:
 * present values are trusted, absent ones are reported as undeclared rather
 * than assumed to be zero.
 *
 * @param health Parsed `/health` body, or `null` when the request failed.
 * @param field Which statistic to read.
 * @returns The resolved statistic.
 */
export function resolveStat(health: unknown, field: MeasuredStatField): StatResolution {
  if (!health || typeof health !== 'object') {
    return { available: false, reason: SERVER_UNREACHABLE_REASON }
  }

  const payload = health as Partial<ServerHealthResponse> & Record<string, unknown>

  // An explicit declaration always wins, even if a stale value is also present.
  const unsupported = Array.isArray(payload.unsupportedFields) && payload.unsupportedFields.includes(field)
  if (payload.statsSupported === false || unsupported) {
    return {
      available: false,
      reason: typeof payload.statsUnavailableReason === 'string' && payload.statsUnavailableReason.trim() !== ''
        ? payload.statsUnavailableReason
        : UNDECLARED_STAT_REASON,
    }
  }

  const value = payload[field]
  if (typeof value === 'number' && Number.isFinite(value)) return { available: true, value }
  if (typeof value === 'string' && value.trim() !== '') return { available: true, value }

  // Declared as supported but absent, or a pre-contract deployment: either way
  // there is no measurement here, so do not invent one.
  return { available: false, reason: UNDECLARED_STAT_REASON }
}

/**
 * True when the payload reports at least one real statistic, so a caller can
 * label the whole panel rather than repeating a reason on every card.
 *
 * @param health Parsed `/health` body, or `null`.
 * @returns Whether any measured statistic is available.
 */
export function hasAnyStats(health: unknown): boolean {
  return MEASURED_STAT_FIELDS.some((field) => resolveStat(health, field).available)
}

/**
 * The single explanation to show when a reachable deployment reports no
 * statistics at all.
 *
 * @param health Parsed `/health` body, or `null`.
 * @returns The reason, or `null` when statistics are available.
 */
export function statsUnavailableReason(health: unknown): string | null {
  if (hasAnyStats(health)) return null
  const [first] = MEASURED_STAT_FIELDS
  const resolved = resolveStat(health, first)
  return resolved.available ? null : resolved.reason
}
