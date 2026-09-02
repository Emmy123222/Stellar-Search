import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}))

const { mockGetNetworkDetails, mockSignAuthEntry } = vi.hoisted(() => ({
  mockGetNetworkDetails: vi.fn(),
  mockSignAuthEntry: vi.fn(),
}))
vi.mock('@stellar/freighter-api', () => ({
  getNetworkDetails: (...args: any[]) => mockGetNetworkDetails(...args),
  signAuthEntry: (...args: any[]) => mockSignAuthEntry(...args),
}))

vi.mock('@stellar/stellar-sdk', () => ({
  Networks: { PUBLIC: 'Public Global Stellar Network ; September 2015', TESTNET: 'Test SDF Network ; September 2015' },
}))

const { mockCreatePaymentPayload, mockGetPaymentRequiredResponse, mockEncodePaymentSignatureHeader } = vi.hoisted(() => ({
  mockCreatePaymentPayload: vi.fn(),
  mockGetPaymentRequiredResponse: vi.fn(),
  mockEncodePaymentSignatureHeader: vi.fn(),
}))
vi.mock('@x402/fetch', () => ({
  x402Client: class {
    register() {
      return this
    }
    createPaymentPayload(...args: any[]) {
      return mockCreatePaymentPayload(...args)
    }
  },
  x402HTTPClient: class {
    getPaymentRequiredResponse(...args: any[]) {
      return mockGetPaymentRequiredResponse(...args)
    }
    encodePaymentSignatureHeader(...args: any[]) {
      return mockEncodePaymentSignatureHeader(...args)
    }
  },
}))
vi.mock('@x402/stellar/exact/client', () => ({
  ExactStellarScheme: class {},
}))

vi.mock('../lib/stellar', () => ({
  IS_MAINNET: false,
  EXPECTED_WALLET_NETWORK: 'TESTNET',
  explorerTxUrl: (hash: string) => `https://stellar.expert/tx/${hash}`,
}))

import { useSearch } from './useSearch'

const WALLET = 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3'
const SEARCH_LOCK_KEY = 'stellarsearch_search_lock'

// This test environment's window.localStorage has every method undefined
// (a pre-existing jsdom/vitest quirk, not introduced here — see
// useFreighterWallet's sibling issue in the StellarCred repo for the same
// class of bug). useSearch.ts's own receipt persistence already wraps
// localStorage access in try/catch for exactly this kind of failure, so it
// silently no-ops rather than throwing — but that also means the real
// storage can't be used to verify the receipt actually gets written. Stub a
// minimal in-memory implementation instead.
function stubLocalStorage() {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
  })
}

describe('useSearch — lazy-loaded x402 payment flow (#336)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stubLocalStorage()
    mockGetNetworkDetails.mockResolvedValue({ network: 'TESTNET' })
    mockCreatePaymentPayload.mockResolvedValue({ payload: 'signed' })
    mockGetPaymentRequiredResponse.mockReturnValue({ accepts: [] })
    mockEncodePaymentSignatureHeader.mockReturnValue({ 'X-PAYMENT': 'encoded' })
  })

  it('errors immediately without a connected wallet, never loading the payment SDKs', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useSearch(null))
    await act(async () => {
      await result.current.search('test query')
    })

    expect(result.current.session.status).toBe('error')
    expect(mockGetNetworkDetails).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('rejects when Freighter is on the wrong network', async () => {
    mockGetNetworkDetails.mockResolvedValue({ network: 'PUBLIC' })
    vi.stubGlobal('fetch', vi.fn())

    const { result } = renderHook(() => useSearch(WALLET))
    await act(async () => {
      await result.current.search('test query')
    })

    expect(result.current.session.status).toBe('error')
    expect(result.current.session.error).toMatch(/Switch Freighter to TESTNET/)
    vi.unstubAllGlobals()
  })

  it('returns results directly when the server responds without a 402 challenge', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ results: [{ title: 'Result A' }], suggestions: [] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useSearch(WALLET))
    await act(async () => {
      await result.current.search('free query')
    })

    await waitFor(() => expect(result.current.session.status).toBe('complete'))
    expect(result.current.session.results).toEqual([{ title: 'Result A' }])
    expect(result.current.session.txHash).toBeNull()
    vi.unstubAllGlobals()
  })

  it('completes the full 402 payment flow and persists a receipt', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        status: 402,
        headers: { get: () => null },
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({
          results: [{ title: 'Paid Result' }],
          suggestions: [],
          txHash: 'deadbeef',
          paidAmount: '0.001',
          network: 'stellar:testnet',
        }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useSearch(WALLET))
    await act(async () => {
      await result.current.search('paid query')
    })

    await waitFor(() => expect(result.current.session.status).toBe('complete'))
    expect(result.current.session.txHash).toBe('deadbeef')
    expect(mockCreatePaymentPayload).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const receipts = JSON.parse(localStorage.getItem('stellarsearch_receipts') || '[]')
    expect(receipts).toHaveLength(1)
    expect(receipts[0].txHash).toBe('deadbeef')
    vi.unstubAllGlobals()
  })

  it('reset returns the session to idle', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ results: [], suggestions: [] }),
    }))

    const { result } = renderHook(() => useSearch(WALLET))
    await act(async () => {
      await result.current.search('q')
    })
    await waitFor(() => expect(result.current.session.status).toBe('complete'))

    act(() => {
      result.current.reset()
    })
    expect(result.current.session.status).toBe('idle')
    vi.unstubAllGlobals()
  })
})

/** A fetch stub that resolves the first (402) request immediately, but only resolves the paid retry once `release()` is called — lets tests hold the flow open mid-payment to simulate a race. */
function makeGatedFetch() {
  let releasePaid: () => void = () => {}
  const paidGate = new Promise<void>((resolve) => {
    releasePaid = resolve
  })

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (!init?.headers) {
      // Unpaid probe request
      return {
        status: 402,
        ok: false,
        headers: { get: () => null },
      } as unknown as Response
    }
    await paidGate
    return {
      status: 200,
      ok: true,
      json: async () => ({ results: [], txHash: '0xabc', paidAmount: '0.001' }),
    } as unknown as Response
  })

  return { fetchMock, releasePaid: () => releasePaid() }
}

describe('useSearch — duplicate payment prevention', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stubLocalStorage()
    mockGetNetworkDetails.mockResolvedValue({ network: 'TESTNET' })
    mockCreatePaymentPayload.mockResolvedValue({ payload: 'signed' })
    mockGetPaymentRequiredResponse.mockReturnValue({ accepts: [] })
    mockEncodePaymentSignatureHeader.mockReturnValue({ 'X-PAYMENT': 'encoded' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('ignores a second call fired before the first finishes (double Enter / double click)', async () => {
    const { fetchMock, releasePaid } = makeGatedFetch()
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useSearch(WALLET))

    act(() => {
      result.current.search('stellar')
      result.current.search('stellar') // fired synchronously right after, before any state flush
    })

    await waitFor(() => expect(result.current.session.status).toBe('searching'))

    // Only one 402 probe should have gone out despite two calls.
    const probeCalls = fetchMock.mock.calls.filter((c) => !c[1]?.headers)
    expect(probeCalls).toHaveLength(1)

    releasePaid()
    await waitFor(() => expect(result.current.session.status).toBe('complete'))
  })

  it('releases the mutex after completion so a subsequent search is allowed', async () => {
    const { fetchMock, releasePaid } = makeGatedFetch()
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useSearch(WALLET))

    act(() => {
      result.current.search('first query')
    })
    await waitFor(() => expect(result.current.session.status).toBe('searching'))
    releasePaid()
    await waitFor(() => expect(result.current.session.status).toBe('complete'))

    expect(localStorage.getItem(SEARCH_LOCK_KEY)).toBeNull()

    const { fetchMock: fetchMock2, releasePaid: releasePaid2 } = makeGatedFetch()
    vi.stubGlobal('fetch', fetchMock2)

    act(() => {
      result.current.search('second query')
    })
    await waitFor(() => expect(result.current.session.status).toBe('searching'))
    releasePaid2()
    await waitFor(() => expect(result.current.session.status).toBe('complete'))
    expect(result.current.session.query).toBe('second query')
  })

  it('blocks a search when another tab already holds the mutex', async () => {
    // Simulate another (still in-flight, non-expired) tab holding the lock.
    localStorage.setItem(SEARCH_LOCK_KEY, JSON.stringify({ id: 'other-tab', ts: Date.now() }))

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useSearch(WALLET))

    await act(async () => {
      await result.current.search('stellar')
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.session.status).toBe('idle')
  })

  it('allows a search once a stale lock (past TTL) is present', async () => {
    localStorage.setItem(
      SEARCH_LOCK_KEY,
      JSON.stringify({ id: 'crashed-tab', ts: Date.now() - 60_000 })
    )

    const { fetchMock, releasePaid } = makeGatedFetch()
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useSearch(WALLET))

    act(() => {
      result.current.search('stellar')
    })

    await waitFor(() => expect(result.current.session.status).toBe('searching'))
    releasePaid()
    await waitFor(() => expect(result.current.session.status).toBe('complete'))
  })

  it('survives React StrictMode double-invocation without double-charging', async () => {
    const { fetchMock, releasePaid } = makeGatedFetch()
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useSearch(WALLET), {
      wrapper: ({ children }) => children as React.ReactElement,
    })

    // StrictMode re-invokes effects/handlers, but our guard is keyed off a
    // ref + the shared lock, not render count, so simulate the same rapid
    // re-entry StrictMode would produce.
    act(() => {
      result.current.search('stellar')
    })
    act(() => {
      result.current.search('stellar')
    })

    await waitFor(() => expect(result.current.session.status).toBe('searching'))
    const probeCalls = fetchMock.mock.calls.filter((c) => !c[1]?.headers)
    expect(probeCalls).toHaveLength(1)

    releasePaid()
    await waitFor(() => expect(result.current.session.status).toBe('complete'))
  })
})
