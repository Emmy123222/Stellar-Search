import { describe, it, expect } from 'vitest'
import { redact, REDACTED } from './redactor'

describe('redactor — recursive, case-variant, header/key/address/query', () => {
  it('redacts known header keys case-insensitively', () => {
    const input = {
      Authorization: 'Bearer secret123',
      'X-Payment': 'some-payment-header',
      'x-payment-response': 'txhash',
      'PAYMENT-REQUIRED': 'challenge',
    }
    const out: any = redact(input)
    expect(out.Authorization).toBe(REDACTED)
    expect(out['X-Payment']).toBe(REDACTED)
    expect(out['x-payment-response']).toBe(REDACTED)
    expect(out['PAYMENT-REQUIRED']).toBe(REDACTED)
  })

  it('redacts API keys and secrets case-variant', () => {
    const input = {
      SERPER_API_KEY: 'abc123def456abc123def456abc12345',
      groq_api_key: 'gsk_test1234567890abcdef1234567890',
      ApiKey: 'some-key',
      token: 'tok_123',
      SECRET: 'shhh',
    }
    const out: any = redact(input)
    expect(out.SERPER_API_KEY).toBe(REDACTED)
    expect(out.groq_api_key).toBe(REDACTED)
    expect(out.ApiKey).toBe(REDACTED)
    expect(out.token).toBe(REDACTED)
    expect(out.SECRET).toBe(REDACTED)
  })

  it('redacts wallet/address fields case-variant', () => {
    const input = {
      walletAddress: 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3',
      ADDRESS: 'GDXA3V2LI3VN3GBH5BMOF25QSFJV7S7ZOWMHHQMJRPP4BVORDDRTIIMU',
      receiving_address: 'GBXXX',
      payTo: 'GABC',
      signerAddress: 'GSIGN',
    }
    const out: any = redact(input)
    expect(out.walletAddress).toBe(REDACTED)
    expect(out.ADDRESS).toBe(REDACTED)
    expect(out.receiving_address).toBe(REDACTED)
    expect(out.payTo).toBe(REDACTED)
    expect(out.signerAddress).toBe(REDACTED)
  })

  it('redacts query/search/content fields case-variant', () => {
    const input = {
      q: 'my private search',
      Query: 'Stellar blockchain',
      TEXT: 'some text',
      content: 'provider message',
      messages: [{ role: 'user', content: 'hello' }],
      prompt: 'do something',
    }
    const out: any = redact(input)
    expect(out.q).toBe(REDACTED)
    expect(out.Query).toBe(REDACTED)
    expect(out.TEXT).toBe(REDACTED)
    expect(out.content).toBe(REDACTED)
    expect(out.messages).toBe(REDACTED)
    expect(out.prompt).toBe(REDACTED)
  })

  it('recursively redacts nested objects and arrays', () => {
    const input = {
      headers: {
        Authorization: 'Bearer token',
        nested: {
          'X-Payment': 'pay',
          deeper: [{ 'X-API-KEY': 'key123' }, { ok: 'keep' }],
        },
      },
      body: {
        query: 'search text',
        walletAddress: 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3',
        safe: 'keep me',
      },
      list: [{ q: 'secret' }, { safe: 'ok' }],
    }
    const out: any = redact(input)
    expect(out.headers.Authorization).toBe(REDACTED)
    expect(out.headers.nested['X-Payment']).toBe(REDACTED)
    expect(out.headers.nested.deeper[0]['X-API-KEY']).toBe(REDACTED)
    expect(out.headers.nested.deeper[1].ok).toBe('keep')
    expect(out.body.query).toBe(REDACTED)
    expect(out.body.walletAddress).toBe(REDACTED)
    expect(out.body.safe).toBe('keep me')
    expect(out.list[0].q).toBe(REDACTED)
    expect(out.list[1].safe).toBe('ok')
  })

  it('redacts standalone sensitive values even under generic keys', () => {
    const input = {
      someField: 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3', // Stellar address
      another: 'gsk_1234567890abcdef1234567890abcdef1234567890', // Groq key
      bearer: 'Bearer eyJhbGciOi...',
    }
    const out: any = redact(input)
    expect(out.someField).toBe(REDACTED)
    expect(out.another).toBe(REDACTED)
    expect(out.bearer).toBe(REDACTED) // already via key, but also value pattern
  })

  it('preserves non-sensitive fields', () => {
    const input = { url: 'https://example.com', count: 5, safe: 'hello', nested: { safe: 'world' } }
    const out: any = redact(input)
    expect(out.url).toBe('https://example.com')
    expect(out.count).toBe(5)
    expect(out.safe).toBe('hello')
    expect(out.nested.safe).toBe('world')
  })

  it('handles circular refs without throwing', () => {
    const a: any = { q: 'secret' }
    a.self = a
    const out: any = redact(a)
    expect(out.q).toBe(REDACTED)
    expect(out.self).toBe(REDACTED)
  })

  it('is case-variant for mixed headers like Payment-Signature', () => {
    const input = { 'payment-signature': 'sig', 'Payment-Signature': 'sig2', 'PAYMENT_SIGNATURE': 'sig3' }
    const out: any = redact(input)
    expect(out['payment-signature']).toBe(REDACTED)
    expect(out['Payment-Signature']).toBe(REDACTED)
    expect(out['PAYMENT_SIGNATURE']).toBe(REDACTED)
  })
})
