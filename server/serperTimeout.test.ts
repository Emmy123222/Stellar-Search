import { describe, it, expect, vi } from 'vitest'
import { fetchSerper, SerperTimeoutError } from '../src/lib/serperClient'

describe('Serper timeout and 504 behavior', () => {
  it('throws SerperTimeoutError when fetch takes longer than timeoutMs', async () => {
    const originalFetch = global.fetch
    global.fetch = vi.fn().mockImplementation((_url, opts: any) => {
      return new Promise((_, reject) => {
        opts?.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
        })
      })
    })

    try {
      await expect(fetchSerper('https://google.serper.dev/search', { q: 'test' }, 'fake-key', undefined, 10)).rejects.toThrow(SerperTimeoutError)
    } finally {
      global.fetch = originalFetch
    }
  })
})
