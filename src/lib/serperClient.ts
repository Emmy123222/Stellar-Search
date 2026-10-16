/**
 * Shared Serper.dev HTTP client, wrapped in a circuit breaker.
 *
 * Used by every runtime that calls Serper directly (Express `server/index.ts`
 * and the Vercel functions under `api/`). The browser and MCP server never
 * call Serper directly — they call these runtimes' `/search`, `/images`,
 * `/news` endpoints — so protecting the two direct callers protects every
 * surface transitively.
 *
 * A response is only counted as a breaker failure for 5xx / 429 (transient
 * upstream trouble) — a 4xx from a malformed request still means Serper
 * answered, so it doesn't indicate the dependency is unhealthy.
 */
import { CircuitBreaker, CircuitOpenError, type CircuitBreakerSnapshot } from './circuitBreaker'

const SERPER_BASE_URL = 'https://google.serper.dev'

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export const serperBreaker = new CircuitBreaker({
  name: 'serper',
  failureThreshold: envInt('SERPER_BREAKER_FAILURE_THRESHOLD', 5),
  openDurationMs: envInt('SERPER_BREAKER_OPEN_MS', 30_000),
  halfOpenMaxProbes: envInt('SERPER_BREAKER_HALF_OPEN_PROBES', 1),
})

export { CircuitOpenError }
export type { CircuitBreakerSnapshot }

export function getSerperBreakerState(): CircuitBreakerSnapshot {
  return serperBreaker.getSnapshot()
}

function isUpstreamFailure(res: Response): boolean {
  return res.status >= 500 || res.status === 429
}

/**
 * Drop-in replacement for `fetch(\`https://google.serper.dev${path}\`, init)`
 * that fails fast with CircuitOpenError instead of hitting the network once
 * the breaker is open. Non-2xx responses that *do* come back are still
 * returned normally (callers keep their existing status-code handling) —
 * only the breaker's internal accounting is affected.
 */
export async function fetchSerper(path: string, init: RequestInit, timeoutMs = 15_000): Promise<Response> {
  return serperBreaker.execute(async () => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    
    // Merge callers' signal if present
    const callerSignal = init.signal
    if (callerSignal) {
      if (callerSignal.aborted) {
        controller.abort()
      } else {
        callerSignal.addEventListener('abort', () => controller.abort(), { once: true })
      }
    }

    try {
      const res = await fetch(`${SERPER_BASE_URL}${path}`, {
        ...init,
        signal: controller.signal,
      })
      return res
    } catch (err: any) {
      if (controller.signal.aborted && (!callerSignal || callerSignal.aborted)) {
        const timeoutErr = new Error(`Serper request timed out after ${timeoutMs}ms`) as any
        timeoutErr.name = 'TimeoutError'
        timeoutErr.status = 504
        throw timeoutErr
      }
      throw err
    } finally {
      clearTimeout(timeoutId)
    }
  }, isUpstreamFailure)
}
