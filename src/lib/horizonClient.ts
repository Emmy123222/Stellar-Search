/**
 * horizonClient.ts
 * Robust Horizon HTTP and SDK client with timeout, retry classification, and 429 handling.
 */

export type HorizonErrorCode =
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'NETWORK_ERROR'
  | 'UNKNOWN'

export class HorizonError extends Error {
  code: HorizonErrorCode
  statusCode?: number
  isTransient: boolean

  constructor(
    message: string,
    code: HorizonErrorCode,
    statusCode?: number,
    isTransient = false
  ) {
    super(message)
    this.name = 'HorizonError'
    this.code = code
    this.statusCode = statusCode
    this.isTransient = isTransient
  }
}

export class HorizonTimeoutError extends HorizonError {
  constructor(timeoutMs: number) {
    super(
      `Horizon request timed out after ${timeoutMs}ms`,
      'TIMEOUT',
      undefined,
      true
    )
    this.name = 'HorizonTimeoutError'
  }
}

export class HorizonRateLimitError extends HorizonError {
  constructor(message = 'Horizon rate limit exceeded (HTTP 429). Please retry shortly.') {
    super(message, 'RATE_LIMITED', 429, true)
    this.name = 'HorizonRateLimitError'
  }
}

export class HorizonNotFoundError extends HorizonError {
  constructor(message = 'Account or resource not found on Horizon (HTTP 404).') {
    super(message, 'NOT_FOUND', 404, false)
    this.name = 'HorizonNotFoundError'
  }
}

export class HorizonNetworkError extends HorizonError {
  constructor(message: string, statusCode?: number) {
    super(message, 'NETWORK_ERROR', statusCode, true)
    this.name = 'HorizonNetworkError'
  }
}

export interface HorizonRetryOptions {
  timeoutMs?: number
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
}

const DEFAULT_OPTIONS: Required<HorizonRetryOptions> = {
  timeoutMs: 8000,
  maxRetries: 3,
  baseDelayMs: 300,
  maxDelayMs: 3000,
}

/**
 * Classifies an arbitrary error into a structured HorizonError.
 */
export function classifyHorizonError(err: unknown): HorizonError {
  if (err instanceof HorizonError) {
    return err
  }

  const errObj = err as any
  const status = errObj?.status || errObj?.response?.status || errObj?.statusCode
  const message = errObj?.message || String(err)

  if (
    errObj?.name === 'AbortError' ||
    errObj?.code === 'ETIMEDOUT' ||
    message.toLowerCase().includes('timeout') ||
    message.toLowerCase().includes('timed out')
  ) {
    return new HorizonTimeoutError(DEFAULT_OPTIONS.timeoutMs)
  }

  if (status === 429 || message.includes('429') || message.toLowerCase().includes('rate limit')) {
    return new HorizonRateLimitError(message)
  }

  if (status === 404 || message.includes('404') || message.toLowerCase().includes('not found')) {
    return new HorizonNotFoundError(message)
  }

  if (
    status >= 500 ||
    errObj?.code === 'ECONNRESET' ||
    errObj?.code === 'ENOTFOUND' ||
    errObj?.code === 'ECONNREFUSED' ||
    message.toLowerCase().includes('network') ||
    message.toLowerCase().includes('fetch failed')
  ) {
    return new HorizonNetworkError(message, status)
  }

  return new HorizonError(message, 'UNKNOWN', status, false)
}

/**
 * Executes an async operation with bounded timeout and jittered exponential retry backoff.
 */
export async function withHorizonRetry<T>(
  fn: (signal?: AbortSignal) => Promise<T>,
  options?: HorizonRetryOptions
): Promise<T> {
  const { timeoutMs, maxRetries, baseDelayMs, maxDelayMs } = {
    ...DEFAULT_OPTIONS,
    ...options,
  }

  let attempt = 0

  while (true) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
    let timer: any = null

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          if (controller) controller.abort()
          reject(new HorizonTimeoutError(timeoutMs))
        }, timeoutMs)
      })

      const result = await Promise.race([
        fn(controller?.signal),
        timeoutPromise,
      ])

      clearTimeout(timer)
      return result
    } catch (err: unknown) {
      if (timer) clearTimeout(timer)
      const classified = classifyHorizonError(err)

      attempt++
      if (!classified.isTransient || attempt > maxRetries) {
        throw classified
      }

      // Jittered exponential backoff: base * 1.5^attempt + random jitter
      const jitter = Math.random() * 100
      const delay = Math.min(baseDelayMs * Math.pow(1.5, attempt - 1) + jitter, maxDelayMs)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
}

/**
 * Fetches an endpoint from Horizon with timeout, retry backoff, and error classification.
 */
export async function fetchHorizonWithRetry(
  url: string,
  options?: HorizonRetryOptions & RequestInit
): Promise<Response> {
  return withHorizonRetry(async (signal) => {
    const res = await fetch(url, {
      ...options,
      signal: signal || options?.signal,
    })

    if (!res.ok) {
      if (res.status === 404) {
        throw new HorizonNotFoundError(`Horizon returned 404 Not Found for ${url}`)
      }
      if (res.status === 429) {
        throw new HorizonRateLimitError(`Horizon rate limit exceeded (HTTP 429) for ${url}`)
      }
      if (res.status >= 500) {
        throw new HorizonNetworkError(`Horizon server error (HTTP ${res.status})`, res.status)
      }
      throw new HorizonError(`Horizon returned HTTP ${res.status}`, 'UNKNOWN', res.status, false)
    }

    return res
  }, options)
}
