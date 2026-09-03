import { describe, it, expect, beforeEach } from 'vitest'
import { recordTiming, getMetrics, resetMetrics, getAvgLatencyMs } from './metrics.js'
import { TIMING_PHASES } from '../src/lib/timing.js'

describe('bounded metrics — percentiles without unbounded arrays', () => {
  beforeEach(() => resetMetrics())

  it('records phase durations with shared vocabulary and exposes percentiles', () => {
    // record 10 samples for total: 10..100
    for (let i = 1; i <= 10; i++) recordTiming(TIMING_PHASES.TOTAL, i * 10, 'success')
    for (let i = 1; i <= 5; i++) recordTiming(TIMING_PHASES.SERPER, i * 20, 'success')
    recordTiming(TIMING_PHASES.VALIDATION, 2, 'success')
    recordTiming(TIMING_PHASES.GROQ_SUGGESTIONS, 50, 'success')

    const m = getMetrics()
    expect(m.phases[TIMING_PHASES.TOTAL].count).toBe(10)
    expect(m.phases[TIMING_PHASES.TOTAL].avgMs).toBe(55)
    expect(m.phases[TIMING_PHASES.TOTAL].p50Ms).toBe(50)
    expect(m.phases[TIMING_PHASES.TOTAL].p95Ms).toBe(100)
    expect(m.phases[TIMING_PHASES.SERPER].count).toBe(5)
    expect(m.phases[TIMING_PHASES.VALIDATION].count).toBe(1)
    expect(m.total).not.toBeNull()
    expect(m.total!.avgMs).toBe(55)
  })

  it('does not grow unbounded — buffer caps at 500', () => {
    for (let i = 0; i < 600; i++) recordTiming(TIMING_PHASES.TOTAL, i, 'success')
    const m = getMetrics()
    // count tracks all, but buffer size is capped; p50 should reflect last 500 (100..599)
    expect(m.phases[TIMING_PHASES.TOTAL].count).toBe(600)
    // avg over all 600
    expect(m.phases[TIMING_PHASES.TOTAL].avgMs).toBe(Math.round((599 * 600) / 2 / 600))
    // p50 over bounded window should be around 350 (100 + 250)
    const p50 = m.phases[TIMING_PHASES.TOTAL].p50Ms!
    expect(p50).toBeGreaterThanOrEqual(300)
    expect(p50).toBeLessThanOrEqual(400)
    expect(getAvgLatencyMs()).toBe(m.phases[TIMING_PHASES.TOTAL].avgMs)
  })

  it('tracks outcome counts', () => {
    recordTiming(TIMING_PHASES.TOTAL, 10, 'success')
    recordTiming(TIMING_PHASES.TOTAL, 20, 'error')
    recordTiming(TIMING_PHASES.TOTAL, 30, 'success')
    const m = getMetrics()
    expect(m.phases[TIMING_PHASES.TOTAL].success).toBe(2)
    expect(m.phases[TIMING_PHASES.TOTAL].error).toBe(1)
  })
})
