import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { CircuitBreaker, CircuitOpenError } from './circuitBreaker'

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stays closed and passes calls through while under the failure threshold', async () => {
    const breaker = new CircuitBreaker({ name: 'test', failureThreshold: 3, openDurationMs: 1000 })

    await expect(breaker.execute(async () => 'ok')).resolves.toBe('ok')
    await expect(breaker.execute(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    await expect(breaker.execute(async () => { throw new Error('boom') })).rejects.toThrow('boom')

    expect(breaker.getSnapshot().state).toBe('closed')
    expect(breaker.getSnapshot().failureCount).toBe(2)
  })

  it('trips open after `failureThreshold` consecutive failures and fails fast', async () => {
    const breaker = new CircuitBreaker({ name: 'test', failureThreshold: 2, openDurationMs: 5000 })

    await expect(breaker.execute(async () => { throw new Error('e1') })).rejects.toThrow('e1')
    await expect(breaker.execute(async () => { throw new Error('e2') })).rejects.toThrow('e2')

    expect(breaker.getSnapshot().state).toBe('open')

    const fn = vi.fn(async () => 'should not run')
    await expect(breaker.execute(fn)).rejects.toBeInstanceOf(CircuitOpenError)
    expect(fn).not.toHaveBeenCalled()
  })

  it('a single success resets the consecutive failure counter', async () => {
    const breaker = new CircuitBreaker({ name: 'test', failureThreshold: 3, openDurationMs: 1000 })

    await expect(breaker.execute(async () => { throw new Error('e') })).rejects.toThrow()
    await expect(breaker.execute(async () => { throw new Error('e') })).rejects.toThrow()
    await expect(breaker.execute(async () => 'ok')).resolves.toBe('ok')

    expect(breaker.getSnapshot().failureCount).toBe(0)
    expect(breaker.getSnapshot().state).toBe('closed')
  })

  it('uses the isFailure classifier to count resolved-but-bad results as failures', async () => {
    const breaker = new CircuitBreaker({ name: 'test', failureThreshold: 1, openDurationMs: 1000 })

    await breaker.execute(async () => ({ status: 500 }), (r) => r.status >= 500)

    expect(breaker.getSnapshot().state).toBe('open')
  })

  it('does not count a resolved result as a failure unless isFailure says so', async () => {
    const breaker = new CircuitBreaker({ name: 'test', failureThreshold: 1, openDurationMs: 1000 })

    await breaker.execute(async () => ({ status: 404 }), (r) => r.status >= 500)

    expect(breaker.getSnapshot().state).toBe('closed')
  })

  it('moves to half-open after openDurationMs and allows a bounded probe through', async () => {
    const breaker = new CircuitBreaker({ name: 'test', failureThreshold: 1, openDurationMs: 10_000, halfOpenMaxProbes: 1 })

    await expect(breaker.execute(async () => { throw new Error('e') })).rejects.toThrow()
    expect(breaker.getSnapshot().state).toBe('open')

    vi.advanceTimersByTime(9_999)
    expect(breaker.getSnapshot().state).toBe('open')

    vi.advanceTimersByTime(1)
    expect(breaker.getSnapshot().state).toBe('half-open')

    await expect(breaker.execute(async () => 'recovered')).resolves.toBe('recovered')
    expect(breaker.getSnapshot().state).toBe('closed')
  })

  it('re-opens immediately if the half-open probe fails', async () => {
    const breaker = new CircuitBreaker({ name: 'test', failureThreshold: 1, openDurationMs: 5000 })

    await expect(breaker.execute(async () => { throw new Error('e') })).rejects.toThrow()
    vi.advanceTimersByTime(5000)
    expect(breaker.getSnapshot().state).toBe('half-open')

    await expect(breaker.execute(async () => { throw new Error('still down') })).rejects.toThrow('still down')
    expect(breaker.getSnapshot().state).toBe('open')
  })

  it('limits concurrent half-open probes to halfOpenMaxProbes', async () => {
    const breaker = new CircuitBreaker({ name: 'test', failureThreshold: 1, openDurationMs: 5000, halfOpenMaxProbes: 1 })

    await expect(breaker.execute(async () => { throw new Error('e') })).rejects.toThrow()
    vi.advanceTimersByTime(5000)
    expect(breaker.getSnapshot().state).toBe('half-open')

    let releaseFirst: () => void = () => {}
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve })
    const firstProbe = breaker.execute(async () => { await gate; return 'first' })

    // A second call while the first probe is still in flight should be rejected fast.
    await expect(breaker.execute(async () => 'second')).rejects.toBeInstanceOf(CircuitOpenError)

    releaseFirst()
    await expect(firstProbe).resolves.toBe('first')
  })

  it('exposes retryAfterMs on CircuitOpenError reflecting remaining open time', async () => {
    const breaker = new CircuitBreaker({ name: 'test', failureThreshold: 1, openDurationMs: 10_000 })
    await expect(breaker.execute(async () => { throw new Error('e') })).rejects.toThrow()

    vi.advanceTimersByTime(4000)
    try {
      await breaker.execute(async () => 'x')
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(CircuitOpenError)
      expect((err as CircuitOpenError).retryAfterMs).toBe(6000)
    }
  })

  it('reset() forces the breaker back to closed', async () => {
    const breaker = new CircuitBreaker({ name: 'test', failureThreshold: 1, openDurationMs: 10_000 })
    await expect(breaker.execute(async () => { throw new Error('e') })).rejects.toThrow()
    expect(breaker.getSnapshot().state).toBe('open')

    breaker.reset()
    expect(breaker.getSnapshot()).toMatchObject({ state: 'closed', failureCount: 0, openedAt: null })
  })

  it('getSnapshot exposes configured thresholds for health/metrics endpoints', () => {
    const breaker = new CircuitBreaker({ name: 'serper', failureThreshold: 5, openDurationMs: 30_000, halfOpenMaxProbes: 2 })
    const snap = breaker.getSnapshot()
    expect(snap).toMatchObject({
      name: 'serper',
      state: 'closed',
      failureThreshold: 5,
      openDurationMs: 30_000,
      halfOpenMaxProbes: 2,
    })
  })
})
