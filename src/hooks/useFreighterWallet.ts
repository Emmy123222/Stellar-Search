/**
 * useFreighterWallet.ts
 * Real Freighter wallet integration using @stellar/freighter-api
 * Fetches live balances from Stellar Horizon
 */

import { useState, useCallback, useEffect } from 'react'
import {
  isConnected,
  requestAccess,
  getAddress,
  getNetwork,
} from '@stellar/freighter-api'
import { Horizon } from '@stellar/stellar-sdk'
import { HORIZON_URL, USDC_ISSUER } from '../lib/stellar'
import type { WalletState, StellarTransaction } from '../types'

export type { WalletState, StellarTransaction }

const horizon = new Horizon.Server(HORIZON_URL)

/**
 * Safely extracts and normalizes transaction memo data from Horizon transaction records or embedded operation objects.
 * Handles missing memo, text memo, and non-text memo (ID, hash, return) cases.
 */
export function extractSafeMemo(
  memo: unknown,
  memoType?: unknown
): string | undefined {
  if (memoType === 'none') {
    return undefined
  }

  if (memo === null || memo === undefined) {
    return undefined
  }

  if (typeof memo === 'string') {
    const trimmed = memo.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }

  if (typeof memo === 'number' || typeof memo === 'bigint') {
    return String(memo)
  }

  if (typeof memo === 'object') {
    try {
      if (typeof Buffer !== 'undefined' && Buffer.isBuffer(memo)) {
        const str = memo.toString('utf8').trim()
        return str.length > 0 ? str : undefined
      }
      const json = JSON.stringify(memo)
      return json !== '{}' ? json : undefined
    } catch {
      return undefined
    }
  }

  return undefined
}

/**
 * Custom React hook to manage connection, balances (XLM & USDC), and recent transaction history for the Freighter wallet on Stellar.
 *
 * @returns Object containing the current wallet state (`wallet`), list of recent transactions (`transactions`),
 * transaction loading state (`txLoading`), and action callbacks (`connect`, `disconnect`, `refresh`).
 */
export function useFreighterWallet() {
  const [wallet, setWallet] = useState<WalletState>({
    publicKey: null,
    connected: false,
    network: 'TESTNET',
    xlmBalance: '0',
    usdcBalance: '0',
    loading: false,
    error: null,
  })
  const [transactions, setTransactions] = useState<StellarTransaction[]>([])
  const [txLoading, setTxLoading] = useState(false)

  // Fetch real balances from Horizon
  const fetchBalances = useCallback(async (publicKey: string) => {
    try {
      const account = await horizon.loadAccount(publicKey)

      let xlm = '0'
      let usdc = '0'

      for (const balance of account.balances) {
        if (balance.asset_type === 'native') {
          xlm = parseFloat(balance.balance).toFixed(4)
        } else if (
          balance.asset_type === 'credit_alphanum4' &&
          (balance as any).asset_code === 'USDC' &&
          (balance as any).asset_issuer === USDC_ISSUER
        ) {
          usdc = parseFloat(balance.balance).toFixed(6)
        }
      }

      setWallet((prev: WalletState) => ({
        ...prev,
        xlmBalance: xlm,
        usdcBalance: usdc,
        error: null,
      }))
    } catch (err: any) {
      setWallet((prev: WalletState) => ({
        ...prev,
        error: err.message || 'Failed to load account',
      }))
    }
  }, [])

  // Fetch real transaction history from Horizon with expanded transaction memo lookup
  const fetchTransactions = useCallback(async (publicKey: string) => {
    setTxLoading(true)
    try {
      const ops = await horizon
        .operations()
        .forAccount(publicKey)
        .order('desc')
        .limit(15)
        .call()

      // Expanded transaction lookup to reliably retrieve memos
      const txMap = new Map<string, { memo?: unknown; memo_type?: unknown }>()
      try {
        const txPage = await horizon
          .transactions()
          .forAccount(publicKey)
          .order('desc')
          .limit(15)
          .call()

        for (const txRecord of txPage.records) {
          if (txRecord && typeof txRecord === 'object' && 'hash' in txRecord) {
            txMap.set((txRecord as any).hash, {
              memo: (txRecord as any).memo,
              memo_type: (txRecord as any).memo_type,
            })
          }
        }
      } catch {
        // Fallback to individual transaction lookups or embedded op transactions
      }

      // Fallback lookup for individual transactions if not included in recent txPage
      const missingHashes = Array.from(
        new Set(
          ops.records
            .map((op: any) => op.transaction_hash)
            .filter((hash: string | undefined): hash is string => Boolean(hash) && !txMap.has(hash!))
        )
      )

      if (missingHashes.length > 0) {
        await Promise.allSettled(
          missingHashes.map(async (hash) => {
            try {
              const txRecord = await horizon.transactions().transaction(hash).call()
              if (txRecord && typeof txRecord === 'object') {
                txMap.set(hash, {
                  memo: (txRecord as any).memo,
                  memo_type: (txRecord as any).memo_type,
                })
              }
            } catch {
              // Ignore single lookup failures
            }
          })
        )
      }

      const txs: StellarTransaction[] = ops.records
        .filter((op: any) => op.type === 'payment' || op.type === 'create_account')
        .map((op: any) => {
          const txDetails = txMap.get(op.transaction_hash)
          const rawMemo = txDetails ? txDetails.memo : op.transaction?.memo
          const rawMemoType = txDetails ? txDetails.memo_type : op.transaction?.memo_type

          return {
            id: op.id,
            hash: op.transaction_hash,
            type: op.type,
            amount: op.amount ? parseFloat(op.amount).toFixed(4) : '—',
            asset:
              op.asset_type === 'native'
                ? 'XLM'
                : op.asset_code || 'Unknown',
            from: op.from || op.funder || '',
            to: op.to || op.account || '',
            timestamp: op.created_at,
            memo: extractSafeMemo(rawMemo, rawMemoType),
          }
        })

      setTransactions(txs)
    } catch {
      setTransactions([])
    } finally {
      setTxLoading(false)
    }
  }, [])

  // Connect Freighter wallet
  const connect = useCallback(async () => {
    setWallet((prev: WalletState) => ({ ...prev, loading: true, error: null }))

    try {
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

      setWallet((prev: WalletState) => ({
        ...prev,
        publicKey: addressResult.address,
        connected: true,
        network,
        loading: false,
        error: null,
      }))

      // Fetch live data after connect
      await fetchBalances(addressResult.address)
      await fetchTransactions(addressResult.address)
    } catch (err: any) {
      setWallet((prev: WalletState) => ({
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
      loading: false,
      error: null,
    })
    setTransactions([])
  }, [])

  const refresh = useCallback(async () => {
    if (wallet.publicKey) {
      await fetchBalances(wallet.publicKey)
      await fetchTransactions(wallet.publicKey)
    }
  }, [wallet.publicKey, fetchBalances, fetchTransactions])

  // Auto-check if already connected on mount
  useEffect(() => {
    const check = async () => {
      try {
        const connected = await isConnected()
        if (connected.isConnected) {
          const addr = await getAddress()
          if (addr.address) {
            const net = await getNetwork()
            setWallet((prev: WalletState) => ({
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

  return {
    wallet,
    transactions,
    txLoading,
    connect,
    disconnect,
    refresh,
  }
}
