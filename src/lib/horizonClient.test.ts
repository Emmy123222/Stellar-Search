import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  HorizonError,
  HorizonTimeoutError,
  HorizonRateLimitError,
  HorizonNotFoundError,
  HorizonNetworkError,
  classifyHorizonError,
  withHorizonRetry,
  fetchHorizonWithRetry,
} from './horizonClient'

describe('horizonClient — error classification & jittered retries (Issue #130)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('classifyHorizonError', () => {
    it('preserves existing HorizonError instances', () => {
      const err = new HorizonRateLimitError('custom 429')
      expect(classifyHorizonError(err)).toBe(err)
    })

    it('identifies timeout errors by name, code, or message', () => {
      const abortErr = new Error('The user aborted a request.')
      abortErr.name = 'AbortError'
      expect(classifyHorizonError(abortErr)).toBeInstanceOf(HorizonTimeoutError)

      const timedOutErr = new Error('request timed out')
      expect(classifyHorizonError(timedOutErr)).toBeInstanceOf(HorizonTimeoutError)
    })

    it('identifies HTTP 429 rate limit errors', () => {
      const rateLimitErr = { status: 429, message: 'Too Many Requests' }
      const classified = classifyHorizonError(rateLimitErr)
      expect(classified).toBeInstanceOf(HorizonRateLimitError)
      expect(classified.code).toBe('RATE_LIMITED')
      expect(classified.isTransient).toBe(true)
    })

    it('identifies HTTP 404 not found errors', () => {
      const notFoundErr = { status: 404, message: 'Account not found' }
      const classified = classifyHorizonError(notFoundErr)
      expect(classified).toBeInstanceOf(HorizonNotFoundError)
      expect(classified.code).toBe('NOT_FOUND')
      expect(classified.isTransient).toBe(false)
    })

    it('identifies 5xx server and network errors as transient', () => {
      const serverErr = { status: 503, message: 'Service Unavailable' }
      const classified = classifyHorizonError(serverErr)
      expect(classified).toBeInstanceOf(HorizonNetworkError)
      expect(classified.code).toBe('NETWORK_ERROR')
      expect(classified.isTransient).toBe(true)
    })
  })

  describe('withHorizonRetry', () => {
    it('executes successfully on the first attempt without retrying', async () => {
      const fn = vi.fn().mockResolvedValue('success')
      const result = await withHorizonRetry(fn, { maxRetries: 3 })
      expect(result).toBe('success')
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('retries on transient failure and resolves when subsequent attempt succeeds', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce({ status: 503, message: 'Transient 503' })
        .mockResolvedValueOnce('recovered')

      const result = await withHorizonRetry(fn, {
        maxRetries: 2,
        baseDelayMs: 10,
        maxDelayMs: 50,
      })

      expect(result).toBe('recovered')
      expect(fn).toHaveBeenCalledTimes(2)
    })

    it('does not retry permanent errors (e.g. 404 Not Found)', async () => {
      const fn = vi.fn().mockRejectedValue({ status: 404, message: 'Not Found' })

      await expect(
        withHorizonRetry(fn, { maxRetries: 3, baseDelayMs: 10 })
      ).rejects.toBeInstanceOf(HorizonNotFoundError)

      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('throws HorizonTimeoutError when operation exceeds timeoutMs', async () => {
      const slowFn = () => new Promise((resolve) => setTimeout(resolve, 500))

      await expect(
        withHorizonRetry(slowFn, { timeoutMs: 50, maxRetries: 0 })
      ).rejects.toBeInstanceOf(HorizonTimeoutError)
    })
  })

  describe('fetchHorizonWithRetry', () => {
    it('fetches successfully and returns Response', async () => {
      const mockResponse = new Response(JSON.stringify({ id: 'GA123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
      global.fetch = vi.fn().mockResolvedValue(mockResponse)

      const res = await fetchHorizonWithRetry('https://horizon-testnet.stellar.org/accounts/GA123', {
        maxRetries: 1,
      })

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toEqual({ id: 'GA123' })
    })

    it('throws HorizonRateLimitError when response status is 429', async () => {
      global.fetch = vi.fn().mockResolvedValue(new Response('Rate limited', { status: 429 }))

      await expect(
        fetchHorizonWithRetry('https://horizon-testnet.stellar.org/accounts/GA123', {
          maxRetries: 1,
          baseDelayMs: 5,
        })
      ).rejects.toBeInstanceOf(HorizonRateLimitError)
    })
  })
})
