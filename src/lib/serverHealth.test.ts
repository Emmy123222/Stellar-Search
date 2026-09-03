/**
 * src/lib/serverHealth.test.ts
 *
 * Covers the shared `/health` statistics contract (#226).
 *
 * The whole point of the contract is one distinction: a statistic a runtime
 * measured and found to be zero is NOT the same as a statistic the runtime
 * never measured. These tests pin that distinction, the declarations each
 * runtime makes, and the degraded paths — unreachable server, malformed
 * payload, and a deployment that predates the contract.
 */

import { describe, it, expect } from 'vitest'
import {
  MEASURED_STAT_FIELDS,
  SERVERLESS_STATS_UNAVAILABLE_REASON,
  UNDECLARED_STAT_REASON,
  SERVER_UNREACHABLE_REASON,
  declareStatsSupported,
  declareStatsUnsupported,
  resolveStat,
  hasAnyStats,
  statsUnavailableReason,
} from './serverHealth'

const CONFIG = {
  status: 'ok' as const,
  network: 'stellar:testnet',
  pricePerQuery: '0.001 USDC',
  protocol: 'x402' as const,
  facilitator: 'https://www.x402.org/facilitator',
  serperApiConfigured: true,
  groqApiConfigured: true,
  receivingAddressConfigured: true,
}

/** An Express payload: real counters, declared as measured. */
const expressHealth = (stats: Partial<Record<string, unknown>> = {}) => ({
  ...CONFIG,
  totalQueries: 12,
  totalUsdcSettled: '0.0120',
  avgLatencyMs: 384,
  uptime: '7m',
  ...declareStatsSupported(),
  ...stats,
})

/** A Vercel payload: configuration only, gaps declared. */
const serverlessHealth = () => ({
  ...CONFIG,
  timestamp: '2026-09-02T12:00:00.000Z',
  ...declareStatsUnsupported(SERVERLESS_STATS_UNAVAILABLE_REASON),
})

// ─── Declarations ────────────────────────────────────────────────────────────

describe('stat declarations', () => {
  it('declareStatsSupported marks every field as measured', () => {
    expect(declareStatsSupported()).toEqual({ statsSupported: true, unsupportedFields: [] })
  })

  it('declareStatsUnsupported lists every measured field with a reason', () => {
    const declaration = declareStatsUnsupported(SERVERLESS_STATS_UNAVAILABLE_REASON)
    expect(declaration.statsSupported).toBe(false)
    expect(declaration.unsupportedFields).toEqual([...MEASURED_STAT_FIELDS])
    expect(declaration.statsUnavailableReason).toBe(SERVERLESS_STATS_UNAVAILABLE_REASON)
  })

  it('returns a fresh array so a caller cannot mutate the shared field list', () => {
    const first = declareStatsUnsupported('because')
    first.unsupportedFields.push('totalQueries')
    expect(declareStatsUnsupported('because').unsupportedFields).toEqual([...MEASURED_STAT_FIELDS])
  })

  it('names the four fields the UI renders', () => {
    expect(MEASURED_STAT_FIELDS).toEqual(['totalQueries', 'totalUsdcSettled', 'avgLatencyMs', 'uptime'])
  })
})

// ─── The distinction this contract exists for ────────────────────────────────

describe('resolveStat — a measured zero is not an unmeasured field', () => {
  it('resolves a genuine zero from a freshly started server as an available 0', () => {
    // The regression this contract prevents: a brand-new Express server really
    // has served no queries, and that IS a measurement worth showing.
    const fresh = expressHealth({ totalQueries: 0, totalUsdcSettled: '0.0000', avgLatencyMs: 0, uptime: '3s' })

    expect(resolveStat(fresh, 'totalQueries')).toEqual({ available: true, value: 0 })
    expect(resolveStat(fresh, 'avgLatencyMs')).toEqual({ available: true, value: 0 })
    expect(resolveStat(fresh, 'totalUsdcSettled')).toEqual({ available: true, value: '0.0000' })
    expect(resolveStat(fresh, 'uptime')).toEqual({ available: true, value: '3s' })
  })

  it('resolves a serverless deployment as unavailable, never as zero', () => {
    const health = serverlessHealth()
    for (const field of MEASURED_STAT_FIELDS) {
      const resolved = resolveStat(health, field)
      expect(resolved.available).toBe(false)
      expect(resolved).not.toHaveProperty('value')
      if (!resolved.available) expect(resolved.reason).toBe(SERVERLESS_STATS_UNAVAILABLE_REASON)
    }
  })

  it('resolves real Express counters as available', () => {
    const health = expressHealth()
    expect(resolveStat(health, 'totalQueries')).toEqual({ available: true, value: 12 })
    expect(resolveStat(health, 'totalUsdcSettled')).toEqual({ available: true, value: '0.0120' })
    expect(resolveStat(health, 'avgLatencyMs')).toEqual({ available: true, value: 384 })
    expect(resolveStat(health, 'uptime')).toEqual({ available: true, value: '7m' })
  })
})

// ─── Boundaries ──────────────────────────────────────────────────────────────

describe('resolveStat — boundaries', () => {
  it('honours a per-field opt-out while other fields stay available', () => {
    const partial = { ...expressHealth(), statsSupported: true, unsupportedFields: ['avgLatencyMs'], statsUnavailableReason: 'Latency sampling is disabled.' }

    expect(resolveStat(partial, 'totalQueries')).toEqual({ available: true, value: 12 })
    expect(resolveStat(partial, 'avgLatencyMs')).toEqual({ available: false, reason: 'Latency sampling is disabled.' })
  })

  it('lets an explicit declaration win over a stale value left in the payload', () => {
    // A runtime that stops measuring must not keep publishing the last number.
    const stale = { ...serverlessHealth(), totalQueries: 999 }
    expect(resolveStat(stale, 'totalQueries')).toEqual({
      available: false,
      reason: SERVERLESS_STATS_UNAVAILABLE_REASON,
    })
  })

  it('treats an absent field on a pre-contract deployment as undeclared, not zero', () => {
    const legacy = { ...CONFIG } // no declaration, no counters
    for (const field of MEASURED_STAT_FIELDS) {
      expect(resolveStat(legacy, field)).toEqual({ available: false, reason: UNDECLARED_STAT_REASON })
    }
  })

  it('still reads values from a pre-contract Express deployment', () => {
    const legacy = { ...CONFIG, totalQueries: 4, totalUsdcSettled: '0.0040', avgLatencyMs: 210, uptime: '2m' }
    expect(resolveStat(legacy, 'totalQueries')).toEqual({ available: true, value: 4 })
    expect(resolveStat(legacy, 'uptime')).toEqual({ available: true, value: '2m' })
  })

  it('falls back to the undeclared reason when a declaration omits its explanation', () => {
    const noReason = { ...CONFIG, statsSupported: false, unsupportedFields: [...MEASURED_STAT_FIELDS] }
    expect(resolveStat(noReason, 'uptime')).toEqual({ available: false, reason: UNDECLARED_STAT_REASON })

    const blankReason = { ...noReason, statsUnavailableReason: '   ' }
    expect(resolveStat(blankReason, 'uptime')).toEqual({ available: false, reason: UNDECLARED_STAT_REASON })
  })
})

// ─── Failure paths ───────────────────────────────────────────────────────────

describe('resolveStat — failure paths', () => {
  it('reports an unreachable server rather than throwing', () => {
    for (const bad of [null, undefined, 'not json', 42, true]) {
      expect(resolveStat(bad, 'totalQueries')).toEqual({ available: false, reason: SERVER_UNREACHABLE_REASON })
    }
  })

  it('rejects a non-finite or wrongly typed value instead of rendering it', () => {
    for (const value of [NaN, Infinity, -Infinity, null, {}, [], '', '   ']) {
      const resolved = resolveStat({ ...CONFIG, ...declareStatsSupported(), avgLatencyMs: value }, 'avgLatencyMs')
      expect(resolved).toEqual({ available: false, reason: UNDECLARED_STAT_REASON })
    }
  })

  it('survives an unsupportedFields value that is not an array', () => {
    const malformed = { ...expressHealth(), unsupportedFields: 'totalQueries' }
    expect(resolveStat(malformed, 'totalQueries')).toEqual({ available: true, value: 12 })
  })
})

// ─── Panel-level helpers ─────────────────────────────────────────────────────

describe('hasAnyStats / statsUnavailableReason', () => {
  it('reports statistics as available for Express, including an all-zero server', () => {
    expect(hasAnyStats(expressHealth())).toBe(true)
    expect(hasAnyStats(expressHealth({ totalQueries: 0, avgLatencyMs: 0 }))).toBe(true)
    expect(statsUnavailableReason(expressHealth())).toBeNull()
  })

  it('reports a single panel-level reason for a serverless deployment', () => {
    expect(hasAnyStats(serverlessHealth())).toBe(false)
    expect(statsUnavailableReason(serverlessHealth())).toBe(SERVERLESS_STATS_UNAVAILABLE_REASON)
  })

  it('reports statistics as available when only some fields are opted out', () => {
    const partial = { ...expressHealth(), unsupportedFields: ['avgLatencyMs'] }
    expect(hasAnyStats(partial)).toBe(true)
    expect(statsUnavailableReason(partial)).toBeNull()
  })

  it('reports the unreachable reason when there is no payload', () => {
    expect(hasAnyStats(null)).toBe(false)
    expect(statsUnavailableReason(null)).toBe(SERVER_UNREACHABLE_REASON)
  })
})
