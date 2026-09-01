import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSpendingLimits } from './useSpendingLimits'
import {
  SPEND_CONFIG_KEY,
  SPEND_USAGE_KEY,
  settleSpend,
  reserveSpend,
} from '../lib/spendingLimits'

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
  return store
}

// Simulates another tab writing to localStorage (no storage event fires in
// the writing tab, but it does in every other tab).
function dispatchStorage(key: string) {
  const evt = new Event('storage') as StorageEvent
  Object.defineProperty(evt, 'key', { value: key })
  window.dispatchEvent(evt)
}

describe('useSpendingLimits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stubLocalStorage()
  })

  it('starts with safe defaults and an empty ledger', () => {
    const { result } = renderHook(() => useSpendingLimits())
    expect(result.current.config.sessionCap).toBe('0.01')
    expect(result.current.config.dailyCap).toBe('0.05')
    expect(result.current.config.enabled).toBe(true)
    expect(result.current.usage.sessionSpent).toBe('0')
    expect(result.current.usage.reservations).toEqual([])
  })

  it('recordSearchStart reserves the cost and reports allowed', () => {
    const { result } = renderHook(() => useSpendingLimits())
    let check
    act(() => {
      check = result.current.recordSearchStart('0.001')
    })
    expect(check!.allowed).toBe(true)
    expect(result.current.usage.reservations).toHaveLength(1)
    expect(result.current.usage.reservations[0].amount).toBe('0.001')
  })

  it('recordSearchStart blocks and reserves nothing when the session cap is hit', () => {
    for (let i = 0; i < 10; i++) settleSpend('0.001')
    const { result } = renderHook(() => useSpendingLimits())
    let check
    act(() => {
      check = result.current.recordSearchStart('0.001')
    })
    expect(check!.allowed).toBe(false)
    expect(check!.kind).toBe('session')
    expect(result.current.usage.reservations).toHaveLength(0)
  })

  it('recordSearchSettled with a txHash counts the spend; without one it releases', () => {
    const { result } = renderHook(() => useSpendingLimits())
    act(() => {
      result.current.recordSearchStart('0.001')
    })
    expect(result.current.usage.reservations).toHaveLength(1)

    act(() => {
      result.current.recordSearchSettled('0.001', 'deadbeef')
    })
    expect(result.current.usage.sessionSpent).toBe('0.001')
    expect(result.current.usage.dailySpent).toBe('0.001')
    expect(result.current.usage.reservations).toHaveLength(0)

    // A second failed search releases instead of counting.
    act(() => {
      result.current.recordSearchStart('0.001')
      result.current.recordSearchSettled('0.001', null)
    })
    expect(result.current.usage.sessionSpent).toBe('0.001') // unchanged
    expect(result.current.usage.reservations).toHaveLength(0)
  })

  it('updateConfig persists and updates state', () => {
    const { result } = renderHook(() => useSpendingLimits())
    act(() => {
      result.current.updateConfig({ enabled: true, sessionCap: '0.02', dailyCap: '0.1' })
    })
    expect(result.current.config.sessionCap).toBe('0.02')
    expect(JSON.parse(localStorage.getItem(SPEND_CONFIG_KEY) || '{}').sessionCap).toBe('0.02')
  })

  it('syncs config and usage from other tabs via the storage event', () => {
    const { result } = renderHook(() => useSpendingLimits())

    // Another tab raises the session cap and settles a spend.
    localStorage.setItem(SPEND_CONFIG_KEY, JSON.stringify({ enabled: true, sessionCap: '0.02', dailyCap: '0.05' }))
    reserveSpend('0.001')
    act(() => {
      dispatchStorage(SPEND_CONFIG_KEY)
      dispatchStorage(SPEND_USAGE_KEY)
    })

    expect(result.current.config.sessionCap).toBe('0.02')
    expect(result.current.usage.reservations).toHaveLength(1)
  })

  it('refresh re-reads the ledger on demand', () => {
    const { result } = renderHook(() => useSpendingLimits())
    // Simulates a search settling in this same tab through another hook
    // instance (no storage event fires locally).
    settleSpend('0.001')
    act(() => {
      result.current.refresh()
    })
    expect(result.current.usage.sessionSpent).toBe('0.001')
  })
})
