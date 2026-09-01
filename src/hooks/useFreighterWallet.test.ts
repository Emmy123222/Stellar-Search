import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const { mockIsConnected, mockRequestAccess, mockGetAddress, mockGetNetwork } = vi.hoisted(() => ({
  mockIsConnected: vi.fn(),
  mockRequestAccess: vi.fn(),
  mockGetAddress: vi.fn(),
  mockGetNetwork: vi.fn(),
}))

vi.mock('@stellar/freighter-api', () => ({
  isConnected: (...args: any[]) => mockIsConnected(...args),
  requestAccess: (...args: any[]) => mockRequestAccess(...args),
  getAddress: (...args: any[]) => mockGetAddress(...args),
  getNetwork: (...args: any[]) => mockGetNetwork(...args),
}))

const { mockLoadAccount, mockOperationsCall, mockTransactionsCall, mockSingleTransactionCall } = vi.hoisted(() => ({
  mockLoadAccount: vi.fn(),
  mockOperationsCall: vi.fn(),
  mockTransactionsCall: vi.fn(),
  mockSingleTransactionCall: vi.fn(),
}))

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
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

  it('connect succeeds and fetches balances', async () => {
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
})
