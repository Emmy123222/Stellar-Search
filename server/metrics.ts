/**
 * Bounded metrics — records per-phase duration & outcome, exposes percentiles without unbounded arrays.
 * Uses a fixed-size circular buffer per phase (default 500 samples) so memory is O(phases * buffer).
 */

import { TimingPhase, TIMING_PHASES, TimingOutcome, percentile } from '../src/lib/timing.js'

const MAX_SAMPLES_PER_PHASE = 500

interface BufferStats {
  count: number
  success: number
  error: number
  sumMs: number
  minMs: number | null
  maxMs: number | null
  // circular buffer
  buf: number[]
  head: number
  size: number
}

const store = new Map<TimingPhase, BufferStats>()

function getOrCreate(phase: TimingPhase): BufferStats {
  let s = store.get(phase)
  if (!s) {
    s = { count: 0, success: 0, error: 0, sumMs: 0, minMs: null, maxMs: null, buf: new Array(MAX_SAMPLES_PER_PHASE), head: 0, size: 0 }
    store.set(phase, s)
  }
  return s
}

export function recordTiming(phase: TimingPhase, durationMs: number, outcome: TimingOutcome = 'success'): void {
  const s = getOrCreate(phase)
  s.count++
  if (outcome === 'success' || outcome === 'cached') s.success++
  else s.error++
  s.sumMs += durationMs
  if (s.minMs === null || durationMs < s.minMs) s.minMs = durationMs
  if (s.maxMs === null || durationMs > s.maxMs) s.maxMs = durationMs

  // circular insert
  s.buf[s.head] = durationMs
  s.head = (s.head + 1) % MAX_SAMPLES_PER_PHASE
  if (s.size < MAX_SAMPLES_PER_PHASE) s.size++
}

function snapshotSorted(s: BufferStats): number[] {
  if (s.size === 0) return []
  if (s.size < MAX_SAMPLES_PER_PHASE) {
    return s.buf.slice(0, s.size).slice().sort((a, b) => a - b)
  }
  // full buffer: need to reorder from head
  const arr = new Array(MAX_SAMPLES_PER_PHASE)
  for (let i = 0; i < MAX_SAMPLES_PER_PHASE; i++) {
    arr[i] = s.buf[(s.head + i) % MAX_SAMPLES_PER_PHASE]
  }
  return arr.sort((a, b) => a - b)
}

export interface MetricsSnapshot {
  phases: Record<string, {
    count: number
    success: number
    error: number
    avgMs: number
    minMs: number | null
    maxMs: number | null
    p50Ms: number | null
    p95Ms: number | null
    p99Ms: number | null
  }>
  total: {
    count: number
    avgMs: number
    p50Ms: number | null
    p95Ms: number | null
    p99Ms: number | null
  } | null
}

export function getMetrics(): MetricsSnapshot {
  const phases: MetricsSnapshot['phases'] = {}
  for (const [phase, s] of store.entries()) {
    const sorted = snapshotSorted(s)
    phases[phase] = {
      count: s.count,
      success: s.success,
      error: s.error,
      avgMs: s.count ? Math.round(s.sumMs / s.count) : 0,
      minMs: s.minMs,
      maxMs: s.maxMs,
      p50Ms: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
      p99Ms: percentile(sorted, 99),
    }
  }
  const total = phases[TIMING_PHASES.TOTAL] ? {
    count: phases[TIMING_PHASES.TOTAL].count,
    avgMs: phases[TIMING_PHASES.TOTAL].avgMs,
    p50Ms: phases[TIMING_PHASES.TOTAL].p50Ms,
    p95Ms: phases[TIMING_PHASES.TOTAL].p95Ms,
    p99Ms: phases[TIMING_PHASES.TOTAL].p99Ms,
  } : null
  return { phases, total }
}

// Legacy compatibility: expose avgLatencyMs as total avg
export function getAvgLatencyMs(): number {
  const total = store.get(TIMING_PHASES.TOTAL)
  if (!total || total.count === 0) return 0
  return Math.round(total.sumMs / total.count)
}

export function getLatencySamplesCount(): number {
  const total = store.get(TIMING_PHASES.TOTAL)
  return total?.size ?? 0
}

export function resetMetrics(): void {
  store.clear()
}

export const __testing = { store, MAX_SAMPLES_PER_PHASE, snapshotSorted }
