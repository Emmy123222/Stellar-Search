import { describe, expect, it } from 'vitest'

import { parseCliArgs, redactSecret } from './test-search'

describe('test-search CLI', () => {
  it('parses supported CLI options and mode', () => {
    const args = parseCliArgs([
      'stellar x402',
      '--mode',
      'quote',
      '--count',
      '3',
      '--timeout',
      '2500',
      '--json',
      '--receipt',
      './tmp/quote-receipt.json',
      '--freshness',
      'pw',
    ])

    expect(args).toMatchObject({
      query: 'stellar x402',
      mode: 'quote',
      count: 3,
      timeout: 2500,
      json: true,
      receiptPath: './tmp/quote-receipt.json',
      freshness: 'pw',
    })
  })

  it('rejects unsupported modes', () => {
    expect(() => parseCliArgs(['--mode', 'bogus'])).toThrow(/Unsupported mode/)
  })

  it('redacts sensitive key material before logging', () => {
    expect(redactSecret('S1CR3TKEY123456')).not.toContain('S1CR3TKEY123456')
    expect(redactSecret('S1CR3TKEY123456')).toMatch(/\*{3,}|\.{3}/)
    expect(redactSecret('')).toBe('<empty>')
  })
})
