import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSearch } from './useSearch'

// `vi.mock` factories are hoisted above these declarations, so the mocks have
// to be created with `vi.hoisted` — referencing plain top-level consts throws
// "Cannot access 'x' before initialization".
const { signAuthEntry, getNetworkDetails, fetchMock, createPaymentPayloadMock } = vi.hoisted(() => ({
  signAuthEntry: vi.fn(),
  getNetworkDetails: vi.fn(),
  fetchMock: vi.fn(),
  createPaymentPayloadMock: vi.fn(),
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@stellar/freighter-api', () => ({ signAuthEntry, getNetworkDetails }))
vi.mock('@x402/stellar/exact/client', () => ({ ExactStellarScheme: vi.fn() }))
const paymentRequiredMock = vi.hoisted(() => ({ value: { accepts: [] as unknown[] } }))

vi.mock('@x402/fetch', () => ({
  x402Client: class {
    register() { return this }
    createPaymentPayload = createPaymentPayloadMock
  },
  x402HTTPClient: class {
    getPaymentRequiredResponse() { return paymentRequiredMock.value }
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
    paymentRequiredMock.value = { accepts: [] }
    localStorage.clear()
  })

  it('completes the 402, sign, and retry flow', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 402 })).mockResolvedValueOnce(paidResponse())
    const { result } = renderHook(() => useSearch('GTEST'))
    await result.current.search('stellar')
    await waitFor(() => expect(result.current.session.status).toBe('complete'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // The paid retry carries the encoded payment headers (plus an AbortSignal so
    // a Freighter network switch can cancel it).
    expect(fetchMock.mock.calls[1][1].headers).toEqual({ 'X-PAYMENT': 'signed' })
    expect(fetchMock.mock.calls[1][1].signal).toBeDefined()
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

  // ─── Challenge expiration & fresh-challenge retry (#114) ────────────────

  it('surfaces the challenge deadline while signing and settlement are in flight', async () => {
    paymentRequiredMock.value = { accepts: [{ maxTimeoutSeconds: 300 }] }
    let resolvePayment: ((value: unknown) => void) | undefined
    createPaymentPayloadMock.mockImplementationOnce(
      () => new Promise((resolve) => { resolvePayment = resolve }),
    )
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 402 }))

    const { result } = renderHook(() => useSearch('GTEST'))
    let pending: Promise<void>
    act(() => { pending = result.current.search('stellar') })

    await waitFor(() => expect(result.current.session.challenge).toBeTruthy())
    expect(result.current.session.challenge?.maxTimeoutSeconds).toBe(300)
    expect(result.current.session.challenge!.expiresAt).toBeGreaterThan(Date.now() - 1)

    resolvePayment?.({ signed: true })
    fetchMock.mockResolvedValueOnce(paidResponse())
    await act(async () => { await pending! })
    await waitFor(() => expect(result.current.session.status).toBe('complete'))
    // The deadline is retained on the completed session for display.
    expect(result.current.session.challenge?.maxTimeoutSeconds).toBe(300)
  })

  it('does not invent a deadline when the challenge carries no payment options', async () => {
    paymentRequiredMock.value = { accepts: [] }
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 402 })).mockResolvedValueOnce(paidResponse())

    const { result } = renderHook(() => useSearch('GTEST'))
    await act(async () => { await result.current.search('stellar') })

    await waitFor(() => expect(result.current.session.status).toBe('complete'))
    expect(result.current.session.challenge).toBeNull()
  })

  it('refuses to present an authorization whose challenge expired while signing', async () => {
    // 20ms window; the Freighter prompt (mocked) takes far longer.
    paymentRequiredMock.value = { accepts: [{ maxTimeoutSeconds: 0.02 }] }
    createPaymentPayloadMock.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve({ signed: true }), 80)),
    )
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 402 }))

    const { result } = renderHook(() => useSearch('GTEST'))
    await act(async () => { await result.current.search('stellar') })

    await waitFor(() => expect(result.current.session.status).toBe('error'))
    expect(result.current.session.challengeExpired).toBe(true)
    expect(result.current.session.error).toMatch(/expired/i)
    expect(result.current.session.error).toMatch(/No payment was sent/i)
    // The expired payload is never presented: one probe, no paid retry.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retry() re-runs the same query and obtains a fresh challenge', async () => {
    paymentRequiredMock.value = { accepts: [{ maxTimeoutSeconds: 0.02 }] }
    createPaymentPayloadMock.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve({ signed: true }), 80)),
    )
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 402 }))

    const { result } = renderHook(() => useSearch('GTEST'))
    await act(async () => { await result.current.search('expiring query') })
    await waitFor(() => expect(result.current.session.challengeExpired).toBe(true))

    // Second attempt: a fresh, generous challenge completes normally.
    paymentRequiredMock.value = { accepts: [{ maxTimeoutSeconds: 300 }] },
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 402 })).mockResolvedValueOnce(paidResponse())
    await act(async () => { await result.current.retry() })

    await waitFor(() => expect(result.current.session.status).toBe('complete'))
    expect(result.current.session.query).toBe('expiring query')
    expect(result.current.session.challengeExpired).toBe(false)
    // 1 probe (expired) + 1 probe + 1 paid retry.
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('retry() is a no-op before any search has been run', async () => {
    const { result } = renderHook(() => useSearch('GTEST'))
    await act(async () => { await result.current.retry() })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.session.status).toBe('idle')
  })

  it('reset() clears the challenge state and the retry target', async () => {
    paymentRequiredMock.value = { accepts: [{ maxTimeoutSeconds: 300 }] }
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 402 })).mockResolvedValueOnce(paidResponse())

    const { result } = renderHook(() => useSearch('GTEST'))
    await act(async () => { await result.current.search('stellar') })
    await waitFor(() => expect(result.current.session.status).toBe('complete'))
    expect(result.current.session.challenge).toBeTruthy()

    act(() => { result.current.reset() })

    expect(result.current.session.status).toBe('idle')
    expect(result.current.session.challenge).toBeNull()
    expect(result.current.session.challengeExpired).toBe(false)

    // After a reset there is nothing to retry, so no further request goes out.
    const callsBefore = fetchMock.mock.calls.length
    await act(async () => { await result.current.retry() })
    expect(fetchMock.mock.calls.length).toBe(callsBefore)
  })
})
