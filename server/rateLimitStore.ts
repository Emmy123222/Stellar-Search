import type { Store, ClientRateLimitInfo } from 'express-rate-limit'

const INCREMENT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
`

export interface SharedStoreOptions {
  url: string
  token: string
  windowMs: number
  fetchImpl?: typeof fetch
}

/** Atomic Redis REST store for horizontally scaled Express instances. */
export class RedisRestRateLimitStore implements Store {
  localKeys = false
  prefix = 'stellar-search:rate-limit:'
  private readonly fetchImpl: typeof fetch

  constructor(private readonly options: SharedStoreOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    try {
      const response = await this.command(['EVAL', INCREMENT_SCRIPT, '1', `${this.prefix}${key}`, String(this.options.windowMs)])
      const [totalHits, ttl] = response as [number, number]
      return { totalHits: Number(totalHits), resetTime: new Date(Date.now() + Math.max(Number(ttl), 0)) }
    } catch (error) {
      // Fail open so a Redis outage does not turn into an application outage.
      // The limiter's passOnStoreError option determines this behavior.
      throw new Error(`Shared rate-limit store unavailable: ${error instanceof Error ? error.message : 'unknown error'}`)
    }
  }

  async decrement(key: string): Promise<void> {
    await this.command(['DECR', `${this.prefix}${key}`])
  }

  async resetKey(key: string): Promise<void> {
    await this.command(['DEL', `${this.prefix}${key}`])
  }

  private async command(command: string[]): Promise<unknown> {
    const response = await this.fetchImpl(this.options.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.options.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    })
    if (!response.ok) throw new Error(`Redis REST returned ${response.status}`)
    const payload = await response.json() as { result?: unknown; error?: string }
    if (payload.error) throw new Error(payload.error)
    return payload.result
  }
}

export function createSharedRateLimitStore(env: NodeJS.ProcessEnv = process.env): Store | undefined {
  if ((env.RATE_LIMIT_STORE ?? 'memory').toLowerCase() !== 'redis') return undefined
  const url = env.UPSTASH_REDIS_REST_URL?.trim()
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (!url || !token) throw new Error('RATE_LIMIT_STORE=redis requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN')
  return new RedisRestRateLimitStore({ url, token, windowMs: 60_000 })
}
