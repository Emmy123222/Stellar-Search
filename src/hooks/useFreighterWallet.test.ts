import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { initI18n, loadNamespace } from '../i18n'

// The hook's error messages route through i18next (#345) — in the real app
// main.tsx initializes it and loads `errors` before anything renders;
// mirror that here so those messages resolve instead of coming back
// undefined.
beforeAll(async () => {
  await initI18n()
  await loadNamespace('errors')
})

const { mockIsConnected, mockRequestAccess, mockGetAddress, mockGetNetwork, mockWatch, mockStop, triggerWatcher } = vi.hoisted(() => {
  let watcherCb: any = null;
  return {
    mockIsConnected: vi.fn(),
    mockRequestAccess: vi.fn(),
    mockGetAddress: vi.fn(),
    mockGetNetwork: vi.fn(),
    mockWatch: vi.fn().mockImplementation((cb) => { watcherCb = cb }),
    mockStop: vi.fn(),
    triggerWatcher: (params: any) => {
      if (watcherCb) watcherCb(params)
    }
  }
})

vi.mock('@stellar/freighter-api', () => ({
  isConnected: (...args: any[]) => mockIsConnected(...args),
  requestAccess: (...args: any[]) => mockRequestAccess(...args),
  getAddress: (...args: any[]) => mockGetAddress(...args),
  getNetwork: (...args: any[]) => mockGetNetwork(...args),
  WatchWalletChanges: class {
    watch(cb: any) { return mockWatch(cb) }
    stop() { return mockStop() }
  }
}))

const { mockLoadAccount, mockOperationsCall, mockTransactionsCall, mockSingleTransactionCall } = vi.hoisted(() => ({
  mockLoadAccount: vi.fn(),
  mockOperationsCall: vi.fn(),
  mockTransactionsCall: vi.fn(),
  mockSingleTransactionCall: vi.fn(),
}))

vi.mock('@stellar/stellar-sdk', async (importOriginal: any) => {
  const orig: any = await importOriginal()
  class MockHorizonServer {
    loadAccount = mockLoadAccount
    operations() {
      return {
        forAccount: () => ({
          order: () => ({
            limit: () => ({
              call: mockOperationsCall,
            }),
          }),
        }),
      }
    }
    transactions() {
      return {
        forAccount: () => ({
          order: () => ({
            limit: () => ({
              call: mockTransactionsCall,
            }),
          }),
        }),
        transaction: (hash: string) => ({
          call: () => mockSingleTransactionCall(hash),
        }),
      }
    }
  }
  return {
    ...orig,
    Horizon: { Server: MockHorizonServer },
  }
})

import { useFreighterWallet, extractSafeMemo } from './useFreighterWallet'

const TEST_ADDRESS = 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3'

describe('extractSafeMemo — transaction memo extraction & normalization', () => {
  it('returns undefined for none memo_type or empty / null values', () => {
    expect(extractSafeMemo('something', 'none')).toBeUndefined()
    expect(extractSafeMemo(null)).toBeUndefined()
    expect(extractSafeMemo(undefined)).toBeUndefined()
    expect(extractSafeMemo('')).toBeUndefined()
    expect(extractSafeMemo('   ')).toBeUndefined()
  })

  it('safely extracts text and trimmed string memos', () => {
    expect(extractSafeMemo('  search query memo  ', 'text')).toBe('search query memo')
    expect(extractSafeMemo('order-123')).toBe('order-123')
  })

  it('safely extracts numeric and ID memo representations', () => {
    expect(extractSafeMemo(123456789, 'id')).toBe('123456789')
    expect(extractSafeMemo(BigInt(987654321))).toBe('987654321')
    expect(extractSafeMemo('99999', 'id')).toBe('99999')
  })

  it('safely extracts buffer and object memo representations without throwing', () => {
    const buf = Buffer.from('hello buffer memo')
    expect(extractSafeMemo(buf)).toBe('hello buffer memo')
    expect(extractSafeMemo({ key: 'val' })).toBe('{"key":"val"}')
  })
})

describe('useFreighterWallet — wallet payment readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsConnected.mockResolvedValue({ isConnected: false })
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    mockLoadAccount.mockResolvedValue({
      balances: [
        { asset_type: 'native', balance: '100.0000' },
        { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', balance: '5.0000000' },
      ],
    })
    mockOperationsCall.mockResolvedValue({ records: [] })
    mockTransactionsCall.mockResolvedValue({ records: [] })
    mockSingleTransactionCall.mockRejectedValue(new Error('Not found'))
  })

  it('initial state is disconnected', () => {
    const { result } = renderHook(() => useFreighterWallet())
    expect(result.current.wallet.connected).toBe(false)
    expect(result.current.wallet.publicKey).toBeNull()
    expect(result.current.wallet.xlmBalance).toBe('0')
    expect(result.current.wallet.usdcBalance).toBe('0')
    expect(result.current.wallet.accountExists).toBe(false)
    expect(result.current.wallet.hasUsdcTrustline).toBe(false)
    expect(result.current.wallet.accountStatus).toBe('unfunded')
    expect(result.current.transactions).toEqual([])
  })

  it('connect throws if Freighter not installed', async () => {
    mockIsConnected.mockResolvedValue({ isConnected: false })
    const { result } = renderHook(() => useFreighterWallet())
    await act(async () => {
      await result.current.connect()
    })
    expect(result.current.wallet.connected).toBe(false)
    expect(result.current.wallet.error).toMatch(/Freighter extension not found/)
  })

  it('surfaces a rejected wallet access request without fetching Horizon', async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockRejectedValue(new Error('User rejected wallet access'))
    const { result } = renderHook(() => useFreighterWallet())
    await act(async () => { await result.current.connect() })
    expect(result.current.wallet.connected).toBe(false)
    expect(result.current.wallet.error).toMatch(/rejected|access/i)
    expect(mockLoadAccount).not.toHaveBeenCalled()
  })

  it('connect succeeds and fetches balances with funded account and trustline', async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS, error: undefined })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET', error: undefined })
    mockLoadAccount.mockResolvedValue({
      balances: [
        { asset_type: 'native', balance: '42.1234' },
        { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', balance: '1.5000000' },
      ],
    })
    mockOperationsCall.mockResolvedValue({ records: [] })

    const { result } = renderHook(() => useFreighterWallet())
    await act(async () => {
      await result.current.connect()
    })

    await waitFor(() => expect(result.current.wallet.connected).toBe(true))
    expect(result.current.wallet.publicKey).toBe(TEST_ADDRESS)
    expect(result.current.wallet.network).toBe('TESTNET')
    expect(mockLoadAccount).toHaveBeenCalledWith(TEST_ADDRESS)
    await waitFor(() => expect(result.current.wallet.xlmBalance).toBe('42.1234'))
    await waitFor(() => expect(result.current.wallet.usdcBalance).toBe('1.500000'))
    expect(result.current.wallet.accountExists).toBe(true)
    expect(result.current.wallet.hasUsdcTrustline).toBe(true)
    expect(result.current.wallet.accountStatus).toBe('funded')
  })

  it('handles unfunded account (404 / NotFoundError) cleanly as unfunded state', async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    const notFoundErr = new Error('Resource Missing')
    ;(notFoundErr as any).response = { status: 404 }
    ;(notFoundErr as any).name = 'NotFoundError'
    mockLoadAccount.mockRejectedValue(notFoundErr)

    const { result } = renderHook(() => useFreighterWallet())
    await act(async () => {
      await result.current.connect()
    })

    await waitFor(() => expect(result.current.wallet.connected).toBe(true))
    expect(result.current.wallet.accountExists).toBe(false)
    expect(result.current.wallet.hasUsdcTrustline).toBe(false)
    expect(result.current.wallet.accountStatus).toBe('unfunded')
    expect(result.current.wallet.xlmBalance).toBe('0')
    expect(result.current.wallet.usdcBalance).toBe('0')
    expect(result.current.wallet.error).toBeNull()
  })

  it('detects funded account without USDC trustline (no_trustline state)', async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    mockLoadAccount.mockResolvedValue({
      balances: [
        { asset_type: 'native', balance: '50.0000' },
      ],
    })

    const { result } = renderHook(() => useFreighterWallet())
    await act(async () => {
      await result.current.connect()
    })

    await waitFor(() => expect(result.current.wallet.connected).toBe(true))
    expect(result.current.wallet.accountExists).toBe(true)
    expect(result.current.wallet.hasUsdcTrustline).toBe(false)
    expect(result.current.wallet.accountStatus).toBe('no_trustline')
    expect(result.current.wallet.xlmBalance).toBe('50.0000')
    expect(result.current.wallet.usdcBalance).toBe('0')
  })

  it('detects funded account with USDC trustline but zero balance (zero_balance state)', async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    mockLoadAccount.mockResolvedValue({
      balances: [
        { asset_type: 'native', balance: '25.0000' },
        { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', balance: '0.0000000' },
      ],
    })

    const { result } = renderHook(() => useFreighterWallet())
    await act(async () => {
      await result.current.connect()
    })

    await waitFor(() => expect(result.current.wallet.connected).toBe(true))
    expect(result.current.wallet.accountExists).toBe(true)
    expect(result.current.wallet.hasUsdcTrustline).toBe(true)
    expect(result.current.wallet.accountStatus).toBe('zero_balance')
    expect(result.current.wallet.xlmBalance).toBe('25.0000')
    expect(result.current.wallet.usdcBalance).toBe('0.000000')
  })

  it('handles generic non-404 error during loadAccount', async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    mockLoadAccount.mockRejectedValue(new Error('Internal Horizon 500 error'))

    const { result } = renderHook(() => useFreighterWallet())
    await act(async () => {
      await result.current.connect()
    })

    await waitFor(() => expect(result.current.wallet.error).toBe('Internal Horizon 500 error'))
  })

  it('disconnect resets wallet state', async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    const { result } = renderHook(() => useFreighterWallet())
    await act(async () => {
      await result.current.connect()
    })
    await waitFor(() => expect(result.current.wallet.connected).toBe(true))
    act(() => {
      result.current.disconnect()
    })
    expect(result.current.wallet.connected).toBe(false)
    expect(result.current.wallet.publicKey).toBeNull()
    expect(result.current.wallet.accountExists).toBe(false)
    expect(result.current.wallet.hasUsdcTrustline).toBe(false)
    expect(result.current.wallet.accountStatus).toBe('unfunded')
    expect(result.current.transactions).toEqual([])
  })

  it('refresh fetches balances and transactions when connected', async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    mockLoadAccount.mockResolvedValue({
      balances: [{ asset_type: 'native', balance: '10.0000' }],
    })
    mockOperationsCall.mockResolvedValue({ records: [] })

    const { result } = renderHook(() => useFreighterWallet())
    await act(async () => {
      await result.current.connect()
    })
    await waitFor(() => expect(result.current.wallet.connected).toBe(true))
    mockLoadAccount.mockClear()
    mockOperationsCall.mockClear()
    await act(async () => {
      await result.current.refresh()
    })
    expect(mockLoadAccount).toHaveBeenCalled()
    expect(mockOperationsCall).toHaveBeenCalled()
  })

  it('fetchBalances formats XLM to 4 decimals and USDC to 6', async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    mockLoadAccount.mockResolvedValue({
      balances: [
        { asset_type: 'native', balance: '99.99999' },
        { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', balance: '0.123456789' },
      ],
    })
    const { result } = renderHook(() => useFreighterWallet())
    await act(async () => {
      await result.current.connect()
    })
    await waitFor(() => expect(result.current.wallet.usdcBalance).toBe('0.123457'))
    expect(result.current.wallet.xlmBalance).toBe('100.0000')
  })

  it('handles Horizon payment operations mapping and expanded transaction memo lookup', async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    mockLoadAccount.mockResolvedValue({ balances: [{ asset_type: 'native', balance: '0' }] })
    
    mockOperationsCall.mockResolvedValue({
      records: [
        {
          type: 'payment',
          id: '1',
          transaction_hash: 'abc123',
          amount: '0.001',
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          from: 'GAAA',
          to: TEST_ADDRESS,
          created_at: '2026-01-01T00:00:00Z',
          // op.transaction is omitted by Horizon operations endpoint by default
        },
        {
          type: 'create_account',
          id: '2',
          transaction_hash: 'def456',
          funder: 'GAAA',
          account: TEST_ADDRESS,
          created_at: '2026-01-01T00:00:00Z',
        },
        {
          type: 'payment',
          id: '3',
          transaction_hash: 'ghi789',
          amount: '5.000',
          asset_type: 'native',
          from: 'GBBB',
          to: TEST_ADDRESS,
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
    })

    // horizon.transactions().forAccount() supplies transaction details & memos
    mockTransactionsCall.mockResolvedValue({
      records: [
        { hash: 'abc123', memo: 'x402 search payment', memo_type: 'text' },
        { hash: 'def456', memo: '100200300', memo_type: 'id' },
      ],
    })

    // Single transaction fallback for 'ghi789'
    mockSingleTransactionCall.mockImplementation(async (hash: string) => {
      if (hash === 'ghi789') {
        return { hash: 'ghi789', memo: undefined, memo_type: 'none' }
      }
      throw new Error('Not found')
    })

    const { result } = renderHook(() => useFreighterWallet())
    await act(async () => {
      await result.current.connect()
    })
    await waitFor(() => expect(result.current.transactions.length).toBe(3))
    
    expect(result.current.transactions[0].hash).toBe('abc123')
    expect(result.current.transactions[0].asset).toBe('USDC')
    expect(result.current.transactions[0].memo).toBe('x402 search payment')

    expect(result.current.transactions[1].type).toBe('create_account')
    expect(result.current.transactions[1].memo).toBe('100200300')

    expect(result.current.transactions[2].hash).toBe('ghi789')
    expect(result.current.transactions[2].memo).toBeUndefined()
  })

  it('reacts to freighter account changes atomically', async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    mockLoadAccount.mockResolvedValue({
      balances: [{ asset_type: 'native', balance: '10.0000' }],
    })
    mockOperationsCall.mockResolvedValue({ records: [] })

    const { result } = renderHook(() => useFreighterWallet())
    await act(async () => {
      await result.current.connect()
    })
    await waitFor(() => expect(result.current.wallet.connected).toBe(true))
    expect(mockWatch).toHaveBeenCalled()

    const NEW_ADDRESS = 'GBBB'
    mockLoadAccount.mockResolvedValue({
      balances: [{ asset_type: 'native', balance: '99.0000' }],
    })
    
    await act(async () => {
      triggerWatcher({ address: NEW_ADDRESS, network: 'TESTNET' })
    })

    await waitFor(() => expect(result.current.wallet.publicKey).toBe(NEW_ADDRESS))
    expect(result.current.wallet.xlmBalance).toBe('99.0000')
    expect(mockLoadAccount).toHaveBeenCalledWith(NEW_ADDRESS)
  })
})

describe('useFreighterWallet — independent balance/history/connection tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsConnected.mockResolvedValue({ isConnected: false })
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    mockLoadAccount.mockResolvedValue({
      balances: [
        { asset_type: 'native', balance: '100.0000' },
        { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', balance: '5.0000000' },
      ],
    })
    mockOperationsCall.mockResolvedValue({ records: [] })
  })

  it('each resource exposes loading/error/lastUpdated independently after connect', async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    mockLoadAccount.mockResolvedValue({
      balances: [{ asset_type: 'native', balance: '10.0000' }, { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', balance: '1.0000000' }],
    })
    mockOperationsCall.mockResolvedValue({ records: [{ type: 'payment', id: '1', transaction_hash: 'h1', amount: '0.001', asset_type: 'native', from: 'GAAA', to: TEST_ADDRESS, created_at: '2026-01-01T00:00:00Z' }] })

    const { result } = renderHook(() => useFreighterWallet())

    // Initially all null/false
    expect(result.current.connection.loading).toBe(false)
    expect(result.current.connection.error).toBeNull()
    expect(result.current.connection.lastUpdated).toBeNull()
    expect(result.current.balance.loading).toBe(false)
    expect(result.current.balance.error).toBeNull()
    expect(result.current.balance.lastUpdated).toBeNull()
    expect(result.current.history.loading).toBe(false)
    expect(result.current.history.error).toBeNull()
    expect(result.current.history.lastUpdated).toBeNull()

    await act(async () => { await result.current.connect() })

    await waitFor(() => expect(result.current.wallet.connected).toBe(true))
    await waitFor(() => expect(result.current.balance.lastUpdated).not.toBeNull())
    await waitFor(() => expect(result.current.history.lastUpdated).not.toBeNull())

    expect(result.current.connection.error).toBeNull()
    expect(result.current.connection.lastUpdated).not.toBeNull()
    expect(new Date(result.current.connection.lastUpdated!).toString()).not.toBe('Invalid Date')
    expect(result.current.balance.error).toBeNull()
    expect(new Date(result.current.balance.lastUpdated!).toString()).not.toBe('Invalid Date')
    expect(result.current.history.error).toBeNull()
    expect(new Date(result.current.history.lastUpdated!).toString()).not.toBe('Invalid Date')
    // loading false after success
    expect(result.current.connection.loading).toBe(false)
    expect(result.current.balance.loading).toBe(false)
    expect(result.current.history.loading).toBe(false)
    // flat aliases
    expect(result.current.balanceError).toBeNull()
    expect(result.current.txError).toBeNull()
    expect(result.current.txLastUpdated).toBe(result.current.history.lastUpdated)
    expect(result.current.balanceLastUpdated).toBe(result.current.balance.lastUpdated)
  })

  it('refreshing balances does not erase valid history and refreshHistory does not erase balances', async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    mockLoadAccount.mockResolvedValue({
      balances: [{ asset_type: 'native', balance: '50.0000' }, { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', balance: '2.0000000' }],
    })
    mockOperationsCall.mockResolvedValue({
      records: [{ type: 'payment', id: '10', transaction_hash: 'h10', amount: '0.001', asset_type: 'native', from: 'GAAA', to: TEST_ADDRESS, created_at: '2026-01-01T00:00:00Z' }],
    })

    const { result } = renderHook(() => useFreighterWallet())
    await act(async () => { await result.current.connect() })
    await waitFor(() => expect(result.current.wallet.usdcBalance).toBe('2.000000'))
    await waitFor(() => expect(result.current.transactions.length).toBe(1))

    const prevHistory = result.current.transactions[0]
    const prevHistoryLastUpdated = result.current.history.lastUpdated
    const prevBalanceLastUpdated = result.current.balance.lastUpdated

    // Balance refresh with new value — history untouched
    mockLoadAccount.mockResolvedValue({
      balances: [{ asset_type: 'native', balance: '60.0000' }, { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', balance: '3.0000000' }],
    })
    await act(async () => { await result.current.refreshBalances() })
    await waitFor(() => expect(result.current.wallet.usdcBalance).toBe('3.000000'))
    expect(result.current.transactions[0]).toEqual(prevHistory)
    expect(result.current.history.lastUpdated).toBe(prevHistoryLastUpdated)
    expect(result.current.balance.lastUpdated).not.toBe(prevBalanceLastUpdated)

    // History refresh with new tx — balance untouched
    const newHistoryLastUpdatedBefore = result.current.history.lastUpdated
    const balanceBefore = result.current.wallet.xlmBalance
    mockOperationsCall.mockResolvedValue({
      records: [
        { type: 'payment', id: '11', transaction_hash: 'h11', amount: '0.002', asset_type: 'native', from: 'GAAA', to: TEST_ADDRESS, created_at: '2026-02-01T00:00:00Z' },
        { type: 'payment', id: '12', transaction_hash: 'h12', amount: '0.003', asset_type: 'native', from: 'GAAA', to: TEST_ADDRESS, created_at: '2026-02-02T00:00:00Z' },
      ],
    })
    await act(async () => { await result.current.refreshHistory() })
    await waitFor(() => expect(result.current.transactions.length).toBe(2))
    expect(result.current.wallet.xlmBalance).toBe(balanceBefore)
    expect(result.current.history.lastUpdated).not.toBe(newHistoryLastUpdatedBefore)
    expect(result.current.balance.error).toBeNull()
    expect(result.current.history.error).toBeNull()
  })

  it('balance error preserves valid balances and history, sets only balance error/lastUpdated', async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    mockLoadAccount.mockResolvedValue({
      balances: [{ asset_type: 'native', balance: '20.0000' }, { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', balance: '1.0000000' }],
    })
    mockOperationsCall.mockResolvedValue({
      records: [{ type: 'payment', id: '1', transaction_hash: 'h1', amount: '0.001', asset_type: 'native', from: 'GAAA', to: TEST_ADDRESS, created_at: '2026-01-01T00:00:00Z' }],
    })
    const { result } = renderHook(() => useFreighterWallet())
    await act(async () => { await result.current.connect() })
    await waitFor(() => expect(result.current.wallet.usdcBalance).toBe('1.000000'))
    const prevXlm = result.current.wallet.xlmBalance
    const prevUsdc = result.current.wallet.usdcBalance
    const prevTxLen = result.current.transactions.length
    const prevHistoryLastUpdated = result.current.history.lastUpdated
    const prevBalanceLastUpdated = result.current.balance.lastUpdated

    mockLoadAccount.mockRejectedValueOnce(new Error('Horizon balance down'))
    await act(async () => { await result.current.refreshBalances() })
    await waitFor(() => expect(result.current.balance.error).toBe('Horizon balance down'))
    expect(result.current.wallet.xlmBalance).toBe(prevXlm)
    expect(result.current.wallet.usdcBalance).toBe(prevUsdc)
    expect(result.current.transactions.length).toBe(prevTxLen)
    expect(result.current.history.error).toBeNull()
    expect(result.current.history.lastUpdated).toBe(prevHistoryLastUpdated)
    expect(result.current.balance.lastUpdated).toBe(prevBalanceLastUpdated)
    expect(result.current.balance.loading).toBe(false)
    // wallet.error (connection) stays null
    expect(result.current.wallet.error).toBeNull()
    expect(result.current.connection.error).toBeNull()
  })

  it('history error preserves valid history and balances, sets only history error/lastUpdated', async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    mockOperationsCall.mockResolvedValue({
      records: [{ type: 'payment', id: '1', transaction_hash: 'h1', amount: '0.001', asset_type: 'native', from: 'GAAA', to: TEST_ADDRESS, created_at: '2026-01-01T00:00:00Z' }],
    })
    const { result } = renderHook(() => useFreighterWallet())
    await act(async () => { await result.current.connect() })
    await waitFor(() => expect(result.current.transactions.length).toBe(1))
    const prevTx = result.current.transactions[0]
    const prevBalance = result.current.wallet.usdcBalance
    const prevBalanceLastUpdated = result.current.balance.lastUpdated
    const prevHistoryLastUpdated = result.current.history.lastUpdated

    mockOperationsCall.mockRejectedValueOnce(new Error('Horizon history down'))
    await act(async () => { await result.current.refreshHistory() })
    await waitFor(() => expect(result.current.history.error).toBe('Horizon history down'))
    expect(result.current.transactions[0]).toEqual(prevTx)
    expect(result.current.wallet.usdcBalance).toBe(prevBalance)
    expect(result.current.balance.error).toBeNull()
    expect(result.current.balance.lastUpdated).toBe(prevBalanceLastUpdated)
    expect(result.current.history.lastUpdated).toBe(prevHistoryLastUpdated)
    expect(result.current.history.loading).toBe(false)
    expect(result.current.txError).toBe('Horizon history down')
  })

  it('connection error does not clear valid balance and history', async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    mockLoadAccount.mockResolvedValue({
      balances: [{ asset_type: 'native', balance: '10.0000' }],
    })
    mockOperationsCall.mockResolvedValue({ records: [] })
    const { result } = renderHook(() => useFreighterWallet())
    await act(async () => { await result.current.connect() })
    await waitFor(() => expect(result.current.wallet.connected).toBe(true))
    await waitFor(() => expect(result.current.balance.lastUpdated).not.toBeNull())

    const prevBalance = result.current.wallet.xlmBalance
    const prevHistoryLen = result.current.transactions.length
    const prevBalanceLastUpdated = result.current.balance.lastUpdated
    const prevHistoryLastUpdated = result.current.history.lastUpdated

    // Simulate connection failure on next connect attempt (e.g., Freighter not found)
    mockIsConnected.mockResolvedValue({ isConnected: false })
    await act(async () => { await result.current.connect() })
    await waitFor(() => expect(result.current.connection.error).toMatch(/Freighter extension not found/))
    expect(result.current.wallet.xlmBalance).toBe(prevBalance)
    expect(result.current.transactions.length).toBe(prevHistoryLen)
    expect(result.current.balance.lastUpdated).toBe(prevBalanceLastUpdated)
    expect(result.current.history.lastUpdated).toBe(prevHistoryLastUpdated)
    // history and balance errors remain null
    expect(result.current.history.error).toBeNull()
    expect(result.current.balance.error).toBeNull()
  })

  it('balance and history loading states are independent', async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    mockLoadAccount.mockResolvedValue({ balances: [{ asset_type: 'native', balance: '10.0000' }] })
    mockOperationsCall.mockResolvedValue({ records: [] })
    const { result } = renderHook(() => useFreighterWallet())
    await act(async () => { await result.current.connect() })
    await waitFor(() => expect(result.current.wallet.connected).toBe(true))

    // Balance refresh pending — history should not be loading
    let resolveBalance: (v: any) => void
    const balancePending = new Promise(resolve => { resolveBalance = resolve })
    mockLoadAccount.mockReturnValueOnce(balancePending as any)
    let balancePromise: Promise<void>
    act(() => { balancePromise = result.current.refreshBalances() })
    await waitFor(() => expect(result.current.balance.loading).toBe(true))
    expect(result.current.history.loading).toBe(false)

    resolveBalance!({ balances: [{ asset_type: 'native', balance: '5.0000' }] })
    await act(async () => { await balancePromise! })
    await waitFor(() => expect(result.current.balance.loading).toBe(false))
    expect(result.current.history.loading).toBe(false)

    // History refresh pending — balance should not be loading
    let resolveHistory: (v: any) => void
    const historyPending = new Promise(resolve => { resolveHistory = resolve })
    mockOperationsCall.mockReturnValueOnce(historyPending as any)
    let historyPromise: Promise<void>
    act(() => { historyPromise = result.current.refreshHistory() })
    await waitFor(() => expect(result.current.history.loading).toBe(true))
    expect(result.current.balance.loading).toBe(false)

    resolveHistory!({ records: [] })
    await act(async () => { await historyPromise! })
    await waitFor(() => expect(result.current.history.loading).toBe(false))
    expect(result.current.balance.loading).toBe(false)
  })

  it('disconnect clears lastUpdated and errors for all resources', async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    const { result } = renderHook(() => useFreighterWallet())
    await act(async () => { await result.current.connect() })
    await waitFor(() => expect(result.current.connection.lastUpdated).not.toBeNull())
    await waitFor(() => expect(result.current.balance.lastUpdated).not.toBeNull())
    await waitFor(() => expect(result.current.history.lastUpdated).not.toBeNull())

    act(() => { result.current.disconnect() })
    expect(result.current.connection.lastUpdated).toBeNull()
    expect(result.current.balance.lastUpdated).toBeNull()
    expect(result.current.history.lastUpdated).toBeNull()
    expect(result.current.connection.error).toBeNull()
    expect(result.current.balance.error).toBeNull()
    expect(result.current.history.error).toBeNull()
    expect(result.current.wallet.connected).toBe(false)
    expect(result.current.transactions).toEqual([])
  })
})
