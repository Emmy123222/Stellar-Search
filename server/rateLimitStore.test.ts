import { describe, expect, it, vi } from 'vitest'
import { createSharedRateLimitStore, RedisRestRateLimitStore } from './rateLimitStore'

describe('rate limit store adapters', () => {
  it('retains the zero-setup memory adapter by default', () => {
    expect(createSharedRateLimitStore({} as NodeJS.ProcessEnv)).toBeUndefined()
  })

  it('requires both Redis REST credentials when selected', () => {
    expect(() => createSharedRateLimitStore({ RATE_LIMIT_STORE: 'redis' } as NodeJS.ProcessEnv)).toThrow(/requires UPSTASH/)
  })

  it('uses one atomic script to increment and establish expiry', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: [3, 42_000] }) })
    const store = new RedisRestRateLimitStore({
      url: 'https://redis.example', token: 'secret', windowMs: 60_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const result = await store.increment('client')
    expect(result.totalHits).toBe(3)
    expect(result.resetTime).toBeInstanceOf(Date)
    const command = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(command[0]).toBe('EVAL')
    expect(command).toContain('stellar-search:rate-limit:client')
  })

  it('surfaces failures for express-rate-limit to log and fail open', async () => {
    const store = new RedisRestRateLimitStore({
      url: 'https://redis.example', token: 'secret', windowMs: 60_000,
      fetchImpl: vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch,
    })
    await expect(store.increment('client')).rejects.toThrow(/store unavailable/)
  })
})
