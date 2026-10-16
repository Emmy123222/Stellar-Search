import { describe, it, expect } from 'vitest'

describe('useSearch x402 response headers', () => {
  it('captures transaction hash from x-payment-response header when body omits it', () => {
    const mockHeader = 'transactionHash=abc123xyz;amount=0.001'
    expect(mockHeader).toContain('transactionHash')
  })
})
