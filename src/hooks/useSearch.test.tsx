import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const signAuthEntry = vi.fn()
const getNetworkDetails = vi.fn()
const fetchMock = vi.fn()
const createPaymentPayloadMock = vi.fn()

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }), { virtual: true })
vi.mock('@stellar/freighter-api', () => ({ signAuthEntry, getNetworkDetails }))
vi.mock('@x402/stellar/exact/client', () => ({ ExactStellarScheme: vi.fn() }))
vi.mock('@x402/fetch', () => ({
  x402Client: class {
    register() { return this }
    createPaymentPayload = createPaymentPayloadMock
  },
  x402HTTPClient: class {
    getPaymentRequiredResponse() { return { accepts: [] } }
    encodePaymentSignatureHeader() { return { 'X-PAYMENT': 'signed' } }
  },
}))

const paidResponse = () => new Response(JSON.stringify({
  results: [{ id: '1', title: 'Result', url: 'https://example.com', description: 'A result', source: 'example.com', relevanceScore: 1 }],
  paidAmount: '0.001', network: 'stellar:testnet', txHash: 'abc', suggestions: [],
}), { status: 200, headers: { 'content-type': 'application/json' } })

describe('useSearch payment flow', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    getNetworkDetails.mockResolvedValue({ network: 'TESTNET' })
    signAuthEntry.mockResolvedValue({ signedAuthEntry: new Uint8Array(64) })
    createPaymentPayloadMock.mockResolvedValue({ signed: true })
    localStorage.clear()
  })

  it('completes the 402, sign, and retry flow', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 402 })).mockResolvedValueOnce(paidResponse())
    const { result } = renderHook(() => useSearch('GTEST'))
    await result.current.search('stellar')
    await waitFor(() => expect(result.current.session.status).toBe('complete'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][1]).toEqual({ headers: { 'X-PAYMENT': 'signed' } })
  })

  it('surfaces a rejected wallet request', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 402 }))
    const { result } = renderHook(() => useSearch('GTEST'))
    const error = new Error('User rejected the request')
    createPaymentPayloadMock.mockRejectedValueOnce(error)
    await result.current.search('stellar')
    await waitFor(() => expect(result.current.session.status).toBe('error'))
    expect(result.current.session.error).toContain('User rejected')
  })

  it('reports network failures', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Network unavailable'))
    const { result } = renderHook(() => useSearch('GTEST'))
    await result.current.search('stellar')
    await waitFor(() => expect(result.current.session.status).toBe('error'))
    expect(result.current.session.error).toContain('Network unavailable')
  })

  it('rejects a malformed 402 response without retrying', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 402 }))
    const { result } = renderHook(() => useSearch('GTEST'))
    const httpClient = await import('@x402/fetch')
    vi.spyOn(httpClient.x402HTTPClient.prototype, 'getPaymentRequiredResponse').mockImplementationOnce(() => { throw new Error('Missing payment header') })
    await result.current.search('stellar')
    await waitFor(() => expect(result.current.session.status).toBe('error'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
