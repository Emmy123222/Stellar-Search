import { describe, it, expect } from 'vitest'
import { sha256 } from './hashing'

describe('sha256', () => {
  it('produces a 64-character hex string', async () => {
    const hash = await sha256('hello')
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('is deterministic for the same input', async () => {
    expect(await sha256('test')).toBe(await sha256('test'))
  })

  it('produces different hashes for different inputs', async () => {
    expect(await sha256('hello')).not.toBe(await sha256('world'))
  })

  it('hashes empty string correctly', async () => {
    const hash = await sha256('')
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('hashes ASCII string correctly', async () => {
    const hash = await sha256('abc')
    expect(hash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('handles multi-byte UTF-8 characters', async () => {
    const hash = await sha256('é€𝄞')
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('handles long strings that produce multiple 512-bit blocks', async () => {
    const longString = 'a'.repeat(200)
    const hash = await sha256(longString)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })
})
