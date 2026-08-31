import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useSearch } from './useSearch'

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}))

vi.mock('@stellar/freighter-api', () => ({
  signAuthEntry: vi.fn(),
  getNetworkDetails: vi.fn(async () => ({ network: 'TESTNET' })),
}))

vi.mock('@x402/fetch', () => {
  function x402Client(this: any) {
    this.register = vi.fn().mockReturnThis()
    this.createPaymentPayload = vi.fn(async () => ({}))
  }
  function x402HTTPClient(this: any) {
    this.getPaymentRequiredResponse = vi.fn(() => ({}))
    this.encodePaymentSignatureHeader = vi.fn(() => ({}))
  }
  return { x402Client, x402HTTPClient }
})

vi.mock('@x402/stellar/exact/client', () => ({
  ExactStellarScheme: vi.fn(),
}))

vi.mock('../lib/stellar', () => ({
  IS_MAINNET: false,
  EXPECTED_WALLET_NETWORK: 'TESTNET',
  explorerTxUrl: (hash: string) => `https://stellar.expert/tx/${hash}`,
}))

const SEARCH_LOCK_KEY = 'stellarsearch_search_lock'
const WALLET = 'GABC123'

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

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useSearch — duplicate payment prevention', () => {
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
