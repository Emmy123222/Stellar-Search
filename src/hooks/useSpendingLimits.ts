/**
 * useSpendingLimits.ts
 * React wrapper around src/lib/spendingLimits — the client-side per-session
 * and daily USDC spending guard (#313).
 *
 * The guard itself always re-reads the shared localStorage ledger on every
 * call, so it is correct across tabs without any event plumbing. This hook
 * additionally:
 *  - exposes reactive `config`/`usage` state for the dashboard UI,
 *  - syncs that state across tabs via the `storage` event.
 *
 * Integration: useSearch calls `recordSearchStart(cost)` before starting the
 * x402 flow (blocking when a cap is hit — before any Freighter prompt), then
 * `recordSearchSettled(cost, txHash)` once the server responds — settling
 * only verified payments (non-null txHash), releasing otherwise.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  getSpendConfig,
  getSpendUsage,
  setSpendConfig,
  reserveSpend,
  settleSpend,
  releaseSpend,
  SPEND_CONFIG_KEY,
  SPEND_USAGE_KEY,
  checkSpendLimit,
  type SpendCheck,
  type SpendConfig,
  type SpendUsage,
} from '../lib/spendingLimits'

export interface SpendingLimits {
  config: SpendConfig
  usage: SpendUsage
  /** Guard check for the next search; reserves the cost when allowed. */
  recordSearchStart: (costUsdc: string) => SpendCheck
  /** Settles a verified payment (txHash) or releases the reservation. */
  recordSearchSettled: (costUsdc: string, txHash: string | null) => void
  /** Persists a new config (callers must confirm cap increases first). */
  updateConfig: (config: SpendConfig) => void
  /** Re-reads the ledger (after settling, or when returning to the tab). */
  refresh: () => void
}

export function useSpendingLimits(): SpendingLimits {
  const [config, setConfig] = useState<SpendConfig>(() => getSpendConfig())
  const [usage, setUsage] = useState<SpendUsage>(() => getSpendUsage())

  // Cross-tab sync: another tab changed the config or the ledger.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SPEND_CONFIG_KEY) setConfig(getSpendConfig())
      if (e.key === SPEND_USAGE_KEY) setUsage(getSpendUsage())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const refresh = useCallback(() => {
    setConfig(getSpendConfig())
    setUsage(getSpendUsage())
  }, [])

  const recordSearchStart = useCallback((costUsdc: string): SpendCheck => {
    const freshConfig = getSpendConfig()
    const freshUsage = getSpendUsage()
    const result = checkSpendLimit(freshConfig, freshUsage, costUsdc)
    if (result.allowed && freshConfig.enabled) {
      setUsage(reserveSpend(costUsdc))
    } else {
      // Even when blocked/disabled, surface the freshest numbers for UI.
      setUsage(freshUsage)
    }
    setConfig(freshConfig)
    return result
  }, [])

  const recordSearchSettled = useCallback((costUsdc: string, txHash: string | null) => {
    // Only *verified* payments (server returned a txHash) count against the
    // caps; anything else releases the in-flight reservation (#313).
    setUsage(txHash ? settleSpend(costUsdc) : releaseSpend(costUsdc))
  }, [])

  const updateConfig = useCallback((next: SpendConfig) => {
    setConfig(setSpendConfig(next))
  }, [])

  return { config, usage, recordSearchStart, recordSearchSettled, updateConfig, refresh }
}
