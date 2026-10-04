/**
 * useFreighterWallet.ts
 * Real Freighter wallet integration using @stellar/freighter-api
 * Fetches live balances from Stellar Horizon
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import {
  isConnected,
  requestAccess,
  getAddress,
  getNetwork,
  WatchWalletChanges,
} from '@stellar/freighter-api'
import { Horizon } from '@stellar/stellar-sdk'
import { HORIZON_URL, USDC_ISSUER } from '../lib/stellar'

declare global {
  interface Window {
    __STELLAR_SEARCH_E2E_WALLET__?: boolean
  }
}

export interface ResourceState {
  loading: boolean
  error: string | null
  lastUpdated: string | null
}

export interface WalletState {
  publicKey: string | null
  connected: boolean
  network: string
  xlmBalance: string
  usdcBalance: string
  hasUsdcTrustline?: boolean
  accountExists?: boolean
  accountStatus?: string
  loading: boolean
  error: string | null
}

export interface StellarTransaction {
  id: string
  hash: string
  type: string
  amount: string
  asset: string
  from: string
  to: string
  timestamp: string
  memo?: string
  direction?: 'inbound' | 'outbound'
  counterparty?: string
}

const horizon = new Horizon.Server(HORIZON_URL)

export const TRANSACTIONS_PAGE_SIZE = 15

export function extractSafeMemo(memo?: any, memoType?: string): string | undefined {
  if (memoType === 'none' || memo === null || memo === undefined) return undefined
  if (typeof memo === 'string') {
    const trimmed = memo.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  if (typeof memo === 'number' || typeof memo === 'bigint') {
    return String(memo)
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(memo)) {
    return memo.toString('utf-8')
  }
  if (typeof memo === 'object') {
    try {
      return JSON.stringify(memo)
    } catch {
      return undefined
    }
  }
  return undefined
}

export function useFreighterWallet() {
  const [wallet, setWallet] = useState<WalletState>({
    publicKey: null,
    connected: false,
    network: 'TESTNET',
    xlmBalance: '0',
    usdcBalance: '0',
    hasUsdcTrustline: false,
    accountExists: false,
    accountStatus: 'unfunded',
    loading: false,
    error: null,
  })
  const [transactions, setTransactions] = useState<StellarTransaction[]>([])
  const [txLoading, setTxLoading] = useState(false)
  const [txHasMore, setTxHasMore] = useState(false)
  const [txLoadingMore, setTxLoadingMore] = useState(false)
  const [txError, setTxError] = useState<string | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)
  const [balanceError, setBalanceError] = useState<string | null>(null)
  const [txLastUpdated, setTxLastUpdated] = useState<string | null>(null)
  const [balanceLastUpdated, setBalanceLastUpdated] = useState<string | null>(null)
  const [connectionLastUpdated, setConnectionLastUpdated] = useState<string | null>(null)
  const nextCursorRef = useRef<string | null>(null)

  // Fetch real balances from Horizon
  const fetchBalances = useCallback(async (publicKey: string) => {
    setBalanceLoading(true)
    setBalanceError(null)
    try {
      const account = await horizon.loadAccount(publicKey)

      let xlm = '0'
      let usdc = '0'
      let hasUsdcTrustline = false

      for (const balance of account.balances) {
        if (balance.asset_type === 'native') {
          xlm = parseFloat(balance.balance).toFixed(4)
        } else if (
          balance.asset_type === 'credit_alphanum4' &&
          (balance as any).asset_code === 'USDC' &&
          (balance as any).asset_issuer === USDC_ISSUER
        ) {
          hasUsdcTrustline = true
          usdc = parseFloat(balance.balance).toFixed(6)
        }
      }

      setWallet(prev => ({
        ...prev,
        xlmBalance: xlm,
        usdcBalance: usdc,
        hasUsdcTrustline,
        accountExists: true,
        accountStatus: parseFloat(usdc) > 0 ? 'funded' : hasUsdcTrustline ? 'unfunded_trustline' : 'no_trustline',
        error: null,
      }))
      setBalanceLastUpdated(new Date().toISOString())
    } catch (err: any) {
      const msg = err.message || 'Failed to load account'
      setBalanceError(msg)
      setWallet(prev => ({
        ...prev,
        error: msg,
      }))
    } finally {
      setBalanceLoading(false)
    }
  }, [])

  // Fetch real transaction history from Horizon
  const fetchTransactions = useCallback(async (publicKey: string) => {
    setTxLoading(true)
    setTxError(null)
    nextCursorRef.current = null
    try {
      const ops = await horizon
        .operations()
        .forAccount(publicKey)
        .order('desc')
        .limit(TRANSACTIONS_PAGE_SIZE)
        .call()

      if (ops.records.length > 0) {
        const last: any = ops.records[ops.records.length - 1]
        nextCursorRef.current = last.paging_token || last.id || null
      }
      setTxHasMore(ops.records.length === TRANSACTIONS_PAGE_SIZE)

      const txs: StellarTransaction[] = ops.records
        .filter((op: any) => {
          if (op.type !== 'payment' && op.type !== 'create_account') return false
          if (op.type === 'payment') {
            const isNative = op.asset_type === 'native'
            const matchesCode = op.asset_code === 'USDC'
            const matchesIssuer = op.asset_issuer === USDC_ISSUER
            return isNative || (matchesCode && matchesIssuer)
          }
          return true
        })
        .map((op: any) => {
          const fromAddr = op.from || op.funder || ''
          const toAddr = op.to || op.account || ''
          const isOutbound = fromAddr === publicKey
          const direction = isOutbound ? 'outbound' : 'inbound'
          const counterparty = isOutbound ? toAddr : fromAddr

          return {
          id: op.id,
          hash: op.transaction_hash,
          type: op.type,
          amount: op.amount ? parseFloat(op.amount).toFixed(4) : '—',
          asset:
            op.asset_type === 'native'
              ? 'XLM'
              : op.asset_code || 'Unknown',
            from: fromAddr,
            to: toAddr,
          timestamp: op.created_at,
          memo: op.transaction?.memo,
            direction,
            counterparty,
          }
        })

      setTransactions(txs)
      setTxLastUpdated(new Date().toISOString())
    } catch (err: any) {
      setTransactions([])
      setTxError(err?.message || 'Failed to load transactions')
    } finally {
      setTxLoading(false)
    }
  }, [])

  const loadMore = useCallback(async () => {
    if (!wallet.publicKey || txLoading || txLoadingMore || !txHasMore) return
    setTxLoadingMore(true)
    try {
      let req = horizon.operations().forAccount(wallet.publicKey).order('desc').limit(TRANSACTIONS_PAGE_SIZE)
      if (nextCursorRef.current) {
        req = req.cursor(nextCursorRef.current)
      }
      const ops = await req.call()
      if (ops.records.length > 0) {
        const last: any = ops.records[ops.records.length - 1]
        nextCursorRef.current = last.paging_token || last.id || null
      }
      setTxHasMore(ops.records.length === TRANSACTIONS_PAGE_SIZE)
      const txs: StellarTransaction[] = ops.records
        .filter((op: any) => op.type === 'payment' || op.type === 'create_account')
        .map((op: any) => ({
          id: op.id,
          hash: op.transaction_hash,
          type: op.type,
          amount: op.amount ? parseFloat(op.amount).toFixed(4) : '—',
          asset: op.asset_type === 'native' ? 'XLM' : op.asset_code || 'Unknown',
          from: op.from || op.funder || '',
          to: op.to || op.account || '',
          timestamp: op.created_at,
          memo: extractSafeMemo(op.transaction?.memo),
        }))
      setTransactions(prev => {
        const seen = new Set(prev.map(p => p.id))
        const deduped = txs.filter(t => !seen.has(t.id))
        return [...prev, ...deduped]
      })
      setTxError(null)
    } catch (err: any) {
      setTxError(err?.message || 'Failed to load more transactions')
    } finally {
      setTxLoadingMore(false)
    }
  }, [wallet.publicKey, txLoading, txLoadingMore, txHasMore])

  // Connect Freighter wallet
  const connect = useCallback(async (): Promise<void> => {
    setWallet(prev => ({ ...prev, loading: true, error: null }))

    try {
      if (typeof window !== 'undefined' && window.__STELLAR_SEARCH_E2E_WALLET__) {
        setWallet(prev => ({
          ...prev,
          publicKey: 'GTESTWALLET7E2ESEARCHFIXTURE7E2ESEARCHFIXTURE7E2ESEARCH',
          connected: true,
          network: 'TESTNET',
          xlmBalance: '100.0000',
          usdcBalance: '10.000000',
          hasUsdcTrustline: true,
          accountExists: true,
          accountStatus: 'funded',
          loading: false,
          error: null,
        }))
        return
      }

      const connected = await isConnected()
      if (!connected.isConnected) {
        throw new Error(
          'Freighter extension not found. Install it from freighter.app'
        )
      }

      const accessResult = await requestAccess()
      if (accessResult.error) {
        throw new Error(accessResult.error.message)
      }

      const addressResult = await getAddress()
      if (addressResult.error || !addressResult.address) {
        throw new Error('Could not get wallet address')
      }

      const networkResult = await getNetwork()
      const network = networkResult.network || 'TESTNET'

      setWallet(prev => ({
        ...prev,
        publicKey: addressResult.address,
        connected: true,
        network,
        loading: false,
        error: null,
      }))
      setConnectionLastUpdated(new Date().toISOString())

      // Fetch live data after connect
      await fetchBalances(addressResult.address)
      await fetchTransactions(addressResult.address)
    } catch (err: any) {
      setWallet(prev => ({
        ...prev,
        loading: false,
        connected: false,
        error: err.message || 'Connection failed',
      }))
    }
  }, [fetchBalances, fetchTransactions])

  const disconnect = useCallback(() => {
    setWallet({
      publicKey: null,
      connected: false,
      network: 'TESTNET',
      xlmBalance: '0',
      usdcBalance: '0',
      hasUsdcTrustline: false,
      accountExists: false,
      accountStatus: 'unfunded',
      loading: false,
      error: null,
    })
    setTransactions([])
    setTxError(null)
    setTxLastUpdated(null)
    setBalanceError(null)
    setBalanceLastUpdated(null)
    setConnectionLastUpdated(null)
    setTxLoading(false)
    setBalanceLoading(false)
  }, [])

  const refresh = useCallback(async () => {
    if (wallet.publicKey) {
      await fetchBalances(wallet.publicKey)
      await fetchTransactions(wallet.publicKey)
    }
  }, [wallet.publicKey, fetchBalances, fetchTransactions])

  // Auto-check if already connected on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && window.__STELLAR_SEARCH_E2E_WALLET__) return

    const check = async () => {
      try {
        const connected = await isConnected()
        if (connected.isConnected) {
          const addr = await getAddress()
          if (addr.address) {
            const net = await getNetwork()
            setWallet(prev => ({
              ...prev,
              publicKey: addr.address,
              connected: true,
              network: net.network || 'TESTNET',
            }))
            fetchBalances(addr.address)
            fetchTransactions(addr.address)
          }
        }
      } catch {
        // Freighter not installed, silent fail
      }
    }
    check()
  }, [fetchBalances, fetchTransactions])

  // Freighter only reports the selected network during a request unless we
  // explicitly watch for changes. Keep the UI in sync so callers can stop a
  // payment flow before a signature from the old network is submitted.
  useEffect(() => {
    if (typeof window === 'undefined' || window.__STELLAR_SEARCH_E2E_WALLET__) {
      return
    }

    const watcher = new WatchWalletChanges()
    watcher.watch(({ network }) => {
      if (!network) return

      setWallet(prev => (
        prev.connected && prev.network !== network
          ? { ...prev, network, error: null }
          : prev
      ))
    })

    return () => watcher.stop()
  }, [])

  const connection: ResourceState = {
    loading: wallet.loading,
    error: wallet.error,
    lastUpdated: connectionLastUpdated,
  }
  const balance: ResourceState = {
    loading: balanceLoading,
    error: balanceError,
    lastUpdated: balanceLastUpdated,
  }
  const history: ResourceState = {
    loading: txLoading,
    error: txError,
    lastUpdated: txLastUpdated,
  }

  const refreshBalances = useCallback(async () => {
    if (wallet.publicKey) {
      await fetchBalances(wallet.publicKey)
    }
  }, [wallet.publicKey, fetchBalances])

  const refreshHistory = useCallback(async () => {
    if (wallet.publicKey) {
      await fetchTransactions(wallet.publicKey)
    }
  }, [wallet.publicKey, fetchTransactions])

  return {
    wallet,
    transactions,
    txLoading,
    txLoadingMore,
    txHasMore,
    txError,
    txLastUpdated,
    balanceLoading,
    balanceError,
    balanceLastUpdated,
    connectionLastUpdated,
    connection,
    balance,
    history,
    loadMore,
    fetchTransactions,
    refreshBalances,
    refreshHistory,
    connect,
    disconnect,
    refresh,
  }
}
