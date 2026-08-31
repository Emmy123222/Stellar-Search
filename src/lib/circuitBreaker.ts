/**
 * Generic circuit breaker.
 *
 * Wraps calls to a flaky/slow dependency so that once it starts failing
 * consistently, further calls fail fast (no network round trip, no
 * connection/retry-budget consumption) instead of piling up behind a
 * dependency that isn't going to answer. After `openDurationMs` it lets a
 * bounded number of "probe" calls through to test recovery before fully
 * closing again.
 *
 * States:
 *   closed    → calls pass through; consecutive failures are counted
 *   open      → calls are rejected immediately with CircuitOpenError
 *   half-open → up to `halfOpenMaxProbes` calls are allowed through; a
 *               single failure re-opens the circuit, a success closes it
 */

export type CircuitState = 'closed' | 'open' | 'half-open'

export interface CircuitBreakerOptions {
  /** Label used in error messages / metrics. */
  name?: string
  /** Consecutive failures required to trip the breaker open. */
  failureThreshold: number
  /** How long the breaker stays open before allowing a half-open probe. */
  openDurationMs: number
  /** Concurrent calls allowed through while half-open. Defaults to 1. */
  halfOpenMaxProbes?: number
}

export interface CircuitBreakerSnapshot {
  name: string
  state: CircuitState
  failureCount: number
  failureThreshold: number
  openDurationMs: number
  halfOpenMaxProbes: number
  openedAt: number | null
  /** epoch ms when the breaker will next allow a half-open probe, or null if not open. */
  nextAttemptAt: number | null
}

export class CircuitOpenError extends Error {
  constructor(
    public readonly circuitName: string,
    public readonly retryAfterMs: number
  ) {
    super(`Circuit breaker "${circuitName}" is open — failing fast (retry in ${retryAfterMs}ms)`)
    this.name = 'CircuitOpenError'
  }
}

export class CircuitBreaker {
  private state: CircuitState = 'closed'
  private failureCount = 0
  private openedAt: number | null = null
  private halfOpenProbesInFlight = 0

  private readonly name: string
  private readonly failureThreshold: number
  private readonly openDurationMs: number
  private readonly halfOpenMaxProbes: number

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name ?? 'circuit'
    this.failureThreshold = options.failureThreshold
    this.openDurationMs = options.openDurationMs
    this.halfOpenMaxProbes = options.halfOpenMaxProbes ?? 1
  }

  /** Current state + counters, for health/metrics endpoints. Advances open → half-open as a side effect if the open duration has elapsed. */
  getSnapshot(): CircuitBreakerSnapshot {
    this.maybeEnterHalfOpen()
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      failureThreshold: this.failureThreshold,
      openDurationMs: this.openDurationMs,
      halfOpenMaxProbes: this.halfOpenMaxProbes,
      openedAt: this.openedAt,
      nextAttemptAt: this.openedAt !== null ? this.openedAt + this.openDurationMs : null,
    }
  }

  private maybeEnterHalfOpen(): void {
    if (
      this.state === 'open' &&
      this.openedAt !== null &&
      Date.now() - this.openedAt >= this.openDurationMs
    ) {
      this.state = 'half-open'
      this.halfOpenProbesInFlight = 0
    }
  }

  private retryAfterMs(): number {
    if (this.openedAt === null) return this.openDurationMs
    return Math.max(0, this.openedAt + this.openDurationMs - Date.now())
  }

  /**
   * Runs `fn` if the circuit allows it, otherwise throws CircuitOpenError
   * without calling `fn` at all. `isFailure` classifies a *resolved* value
   * as a failure worth counting (e.g. an HTTP 500 Response) — a thrown
   * error/rejected promise always counts as a failure regardless.
   */
  async execute<T>(fn: () => Promise<T>, isFailure: (result: T) => boolean = () => false): Promise<T> {
    this.maybeEnterHalfOpen()

    if (this.state === 'open') {
      throw new CircuitOpenError(this.name, this.retryAfterMs())
    }

    const isProbe = this.state === 'half-open'
    if (isProbe) {
      if (this.halfOpenProbesInFlight >= this.halfOpenMaxProbes) {
        throw new CircuitOpenError(this.name, this.retryAfterMs())
      }
      this.halfOpenProbesInFlight++
    }

    try {
      const result = await fn()
      if (isFailure(result)) {
        this.onFailure()
      } else {
        this.onSuccess()
      }
      return result
    } catch (err) {
      this.onFailure()
      throw err
    } finally {
      if (isProbe) this.halfOpenProbesInFlight = Math.max(0, this.halfOpenProbesInFlight - 1)
    }
  }

  private onSuccess(): void {
    this.failureCount = 0
    this.state = 'closed'
    this.openedAt = null
  }

  private onFailure(): void {
    if (this.state === 'half-open') {
      this.trip()
      return
    }
    this.failureCount++
    if (this.failureCount >= this.failureThreshold) {
      this.trip()
    }
  }

  private trip(): void {
    this.state = 'open'
    this.openedAt = Date.now()
    this.halfOpenProbesInFlight = 0
  }

  /** Forces the breaker back to a clean closed state. Mainly for tests. */
  reset(): void {
    this.state = 'closed'
    this.failureCount = 0
    this.openedAt = null
    this.halfOpenProbesInFlight = 0
  }
}
