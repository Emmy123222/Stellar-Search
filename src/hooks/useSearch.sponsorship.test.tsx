import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Fee sponsorship before signing (#312).
 *
 * The challenge's `extra.areFeesSponsored` decides who pays the Stellar network
 * fee. Signing must not begin until the payer has seen the real terms, and when
 * the challenge does not state them — or states something different from the
 * previous challenge — an explicit acknowledgement is required.
 *
 * Mocks are declared per-file with `vi.hoisted` so the factory functions can
 * reference them safely.
 */

const { signAuthEntry, getNetworkDetails, fetchMock, createPaymentPayloadMock, requiredMock } = vi.hoisted(() => ({
  signAuthEntry: vi.fn(),
  getNetworkDetails: vi.fn(),
  fetchMock: vi.fn(),
  createPaymentPayloadMock: vi.fn(),
  // Decoded x402 `PaymentRequired` payload handed to the hook.
  requiredMock: { value: { accepts: [] as unknown[] } },
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@stellar/freighter-api', () => ({ signAuthEntry, getNetworkDetails }))
vi.mock('@stellar/stellar-sdk', () => ({
  Networks: { PUBLIC: 'Public Global Stellar Network ; September 2015', TESTNET: 'Test SDF Network ; September 2015' },
}))
vi.mock('@x402/stellar/exact/client', () => ({ ExactStellarScheme: vi.fn() }))
vi.mock('@x402/fetch', () => ({
  x402Client: class {
    register() { return this }
    createPaymentPayload = createPaymentPayloadMock
  },
  x402HTTPClient: class {
    getPaymentRequiredResponse() { return requiredMock.value }
    encodePaymentSignatureHeader() { return { 'X-PAYMENT': 'signed' } }
  },
}))
vi.mock('../lib/stellar', () => ({
  IS_MAINNET: false,
  EXPECTED_WALLET_NETWORK: 'TESTNET',
  HORIZON_URL: 'https://horizon-testnet.stellar.org',
  explorerTxUrl: (hash: string) => `https://stellar.expert/tx/${hash}`,
}))

import { useSearch } from './useSearch'

const WALLET = 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3'

function challengeWith(extra: Record<string, unknown> | undefined) {
  return {
    accepts: [
      {
        scheme: 'exact',
        network: 'stellar:testnet',
        asset: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
        amount: '10000',
        payTo: WALLET,
        maxTimeoutSeconds: 300,
        extra,
      },
    ],
  }
}

const paidResponse = () =>
  new Response(
    JSON.stringify({ results: [], suggestions: [], txHash: 'abc', paidAmount: '0.001', network: 'stellar:testnet' }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )

describe('useSearch — fee sponsorship before signing (#312)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    getNetworkDetails.mockResolvedValue({ network: 'TESTNET' })
    signAuthEntry.mockResolvedValue({ signedAuthEntry: new Uint8Array(64) })
    createPaymentPayloadMock.mockResolvedValue({ signed: true })
    requiredMock.value = challengeWith({ areFeesSponsored: true })
    localStorage.clear()
  })

  it('reports sponsored fees and signs without an acknowledgement', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 402 })).mockResolvedValueOnce(paidResponse())

    const { result } = renderHook(() => useSearch(WALLET))
    await act(async () => { await result.current.search('stellar') })

    await waitFor(() => expect(result.current.session.status).toBe('complete'))
    expect(result.current.session.sponsorship?.payer).toBe('sponsor')
    expect(result.current.session.sponsorship?.requiresAcknowledgement).toBe(false)
    expect(result.current.session.awaitingSponsorshipAcknowledgement).toBe(false)
    expect(createPaymentPayloadMock).toHaveBeenCalledTimes(1)
  })

  it('surfaces a challenge-provided payer fee estimate', async () => {
    requiredMock.value = challengeWith({ areFeesSponsored: false, estimatedFeeStroops: 100 })
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 402 })).mockResolvedValueOnce(paidResponse())

    const { result } = renderHook(() => useSearch(WALLET))
    await act(async () => { await result.current.search('stellar') })

    await waitFor(() => expect(result.current.session.status).toBe('complete'))
    expect(result.current.session.sponsorship?.payer).toBe('payer')
    expect(result.current.session.sponsorship?.estimatedNetworkFeeXlm).toBe('0.00001')
    expect(createPaymentPayloadMock).toHaveBeenCalledTimes(1)
  })

  it('does not sign an unstated sponsorship until it is acknowledged', async () => {
    requiredMock.value = challengeWith({})
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 402 })).mockResolvedValueOnce(paidResponse())

    const { result } = renderHook(() => useSearch(WALLET))
    let pending: Promise<void>
    act(() => { pending = result.current.search('stellar') })

    await waitFor(() => expect(result.current.session.awaitingSponsorshipAcknowledgement).toBe(true))
    expect(result.current.session.sponsorship?.payer).toBe('unknown')
    expect(result.current.session.sponsorship?.acknowledgementReason).toBe('unknown')
    // Nothing has been signed and the paid retry has not been attempted.
    expect(createPaymentPayloadMock).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    act(() => { result.current.acknowledgeSponsorship() })
    await act(async () => { await pending! })

    await waitFor(() => expect(result.current.session.status).toBe('complete'))
    expect(result.current.session.awaitingSponsorshipAcknowledgement).toBe(false)
    expect(createPaymentPayloadMock).toHaveBeenCalledTimes(1)
  })

  it('requires a fresh acknowledgement when the sponsorship changes between searches', async () => {
    requiredMock.value = challengeWith({ areFeesSponsored: true })
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 402 })).mockResolvedValueOnce(paidResponse())

    const { result } = renderHook(() => useSearch(WALLET))
    await act(async () => { await result.current.search('first') })
    await waitFor(() => expect(result.current.session.status).toBe('complete'))
    expect(result.current.session.sponsorship?.changed).toBe(false)

    // The next challenge stops stating who pays the network fee.
    requiredMock.value = challengeWith({})
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 402 })).mockResolvedValueOnce(paidResponse())

    let pending: Promise<void>
    act(() => { pending = result.current.search('second') })
    await waitFor(() => expect(result.current.session.awaitingSponsorshipAcknowledgement).toBe(true))

    expect(result.current.session.sponsorship?.changed).toBe(true)
    expect(result.current.session.sponsorship?.acknowledgementReason).toBe('changed')
    expect(createPaymentPayloadMock).toHaveBeenCalledTimes(1) // only the first search signed

    act(() => { result.current.acknowledgeSponsorship() })
    await act(async () => { await pending! })
    await waitFor(() => expect(result.current.session.status).toBe('complete'))
    expect(createPaymentPayloadMock).toHaveBeenCalledTimes(2)
  })

  it('acknowledgeSponsorship is a no-op when nothing is pending', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 402 })).mockResolvedValueOnce(paidResponse())

    const { result } = renderHook(() => useSearch(WALLET))
    act(() => { result.current.acknowledgeSponsorship() })
    await act(async () => { await result.current.search('stellar') })

    await waitFor(() => expect(result.current.session.status).toBe('complete'))
    expect(result.current.session.awaitingSponsorshipAcknowledgement).toBe(false)
  })

  it('never signs when the flow is cancelled while awaiting acknowledgement', async () => {
    requiredMock.value = challengeWith({})
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 402 }))

    const { result, rerender } = renderHook(
      ({ network }) => useSearch(WALLET, network),
      { initialProps: { network: 'TESTNET' } },
    )
    let pending: Promise<void>
    act(() => { pending = result.current.search('stellar') })
    await waitFor(() => expect(result.current.session.awaitingSponsorshipAcknowledgement).toBe(true))

    // Simulate a Freighter network switch, which invalidates the payment.
    rerender({ network: 'PUBLIC' })
    await act(async () => { await pending! })

    expect(createPaymentPayloadMock).not.toHaveBeenCalled()
    expect(result.current.session.status).toBe('error')
    expect(result.current.session.error).toMatch(/network changed/i)
    expect(result.current.session.awaitingSponsorshipAcknowledgement).toBe(false)
  })

  it('reset() clears the sponsorship state and releases a paused flow', async () => {
    requiredMock.value = challengeWith({})
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 402 }))

    const { result } = renderHook(() => useSearch(WALLET))
    let pending: Promise<void>
    act(() => { pending = result.current.search('stellar') })
    await waitFor(() => expect(result.current.session.awaitingSponsorshipAcknowledgement).toBe(true))

    act(() => { result.current.reset() })
    await act(async () => { await pending! })

    expect(result.current.session.status).toBe('idle')
    expect(result.current.session.sponsorship).toBeNull()
    expect(result.current.session.awaitingSponsorshipAcknowledgement).toBe(false)
    expect(createPaymentPayloadMock).not.toHaveBeenCalled()
  })
})
