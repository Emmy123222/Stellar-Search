import { describe, expect, it } from 'vitest'
import { ConcurrencyGate } from './concurrency'

describe('ConcurrencyGate', () => {
  it('queues work until a slot is released', async () => {
    const gate = new ConcurrencyGate(1)
    const release = await gate.acquire(20)
    const waiting = gate.acquire(100)
    await expect(Promise.race([waiting.then(() => 'granted'), Promise.resolve('waiting')])).resolves.toBe('waiting')
    release()
    const nextRelease = await waiting
    nextRelease()
  })

  it('rejects queued work after its deadline', async () => {
    const gate = new ConcurrencyGate(1)
    const release = await gate.acquire(20)
    await expect(gate.acquire(1)).rejects.toThrow('provider capacity unavailable')
    release()
  })
})
