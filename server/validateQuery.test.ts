import { describe, it, expect, vi } from 'vitest'

// Use vi.hoisted to ensure env is set before vi.mock hoisting triggers module loads
vi.hoisted(() => {
  process.env.STELLAR_RECEIVING_ADDRESS = 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3'
  process.env.SERPER_API_KEY = 'test-serper-key'
  process.env.GROQ_API_KEY = 'gsk_test'
})

vi.mock('@x402/express', () => ({
  paymentMiddlewareFromConfig: () => (_req: any, _res: any, next: any) => next(),
}))
vi.mock('@x402/core/server', () => ({
  HTTPFacilitatorClient: class { constructor(_opts: any) {} },
}))
vi.mock('@x402/stellar/exact/server', () => ({
  ExactStellarScheme: class { constructor() {} },
}))
vi.mock('groq-sdk', () => ({
  default: class { chat = { completions: { create: vi.fn() } } },
}))
vi.mock('./logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { validateQuery, MAX_QUERY_LENGTH } from './index'

describe('validateQuery — x402 paid route input validation', () => {
  it('accepts valid query and trims', () => {
    expect(validateQuery('  hello world  ')).toEqual({ ok: true, cleanQ: 'hello world' })
  })

  it('rejects missing q (undefined)', () => {
    expect(validateQuery(undefined)).toEqual({ ok: false, error: 'Missing required parameter: q' })
  })

  it('rejects missing q (null)', () => {
    expect(validateQuery(null as any)).toEqual({ ok: false, error: 'Missing required parameter: q' })
  })

  it('rejects non-string q (number)', () => {
    expect(validateQuery(123 as any)).toEqual({ ok: false, error: 'Missing required parameter: q' })
  })

  it('rejects empty string', () => {
    expect(validateQuery('')).toEqual({ ok: false, error: 'Missing required parameter: q' })
  })

  it('rejects whitespace-only string', () => {
    expect(validateQuery('   ')).toEqual({ ok: false, error: 'Missing required parameter: q' })
  })

  it('rejects query too long', () => {
    const long = 'a'.repeat(MAX_QUERY_LENGTH + 1)
    expect(validateQuery(long)).toEqual({
      ok: false,
      error: `Query too long. Maximum ${MAX_QUERY_LENGTH} characters.`,
    })
  })

  it('accepts query exactly at max length', () => {
    const exact = 'a'.repeat(MAX_QUERY_LENGTH)
    const res = validateQuery(exact)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.cleanQ.length).toBe(MAX_QUERY_LENGTH)
  })

  it('strips null bytes and control characters', () => {
    const withControls = 'hello\x00\x01\x1Fworld\x7F'
    const res = validateQuery(withControls)
    expect(res).toEqual({ ok: true, cleanQ: 'helloworld' })
  })

  it('rejects query that becomes empty after stripping controls', () => {
    expect(validateQuery('\x00\x01\x1F\x7F   ')).toEqual({
      ok: false,
      error: 'Query contains no valid characters.',
    })
  })

  it('strips controls then trims', () => {
    expect(validateQuery('\x00  hello \x1F ')).toEqual({ ok: true, cleanQ: 'hello' })
  })

  it('preserves normal punctuation and unicode', () => {
    const q = 'Stellar blockchain — pay-per-query & 0.001 USDC!'
    expect(validateQuery(q)).toEqual({ ok: true, cleanQ: q })
  })

  it('preserves x402 settlement semantics — only validates q, not payment', () => {
    // validateQuery is payment-agnostic; x402 middleware handles payment before this
    // Ensure validation does not interfere with payment amount/network checks
    expect(validateQuery('valid query').ok).toBe(true)
    expect(MAX_QUERY_LENGTH).toBe(256)
  })
})
