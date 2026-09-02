import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getOnboardingSteps,
  isOnboardingComplete,
  isOnboardingDismissed,
  dismissOnboarding,
  clearOnboardingDismissed,
} from './onboarding'
import type { WalletState } from '../types'

function wallet(overrides: Partial<WalletState> = {}): Pick<WalletState, 'connected' | 'hasUsdcTrustline' | 'usdcBalance'> {
  return {
    connected: false,
    hasUsdcTrustline: false,
    usdcBalance: '0',
    ...overrides,
  }
}

describe('getOnboardingSteps (#342)', () => {
  it('marks every step incomplete for a disconnected wallet', () => {
    const steps = getOnboardingSteps(wallet())
    expect(steps.map((s) => s.complete)).toEqual([false, false, false])
  })

  it('marks only the wallet step complete once connected, with no trustline yet', () => {
    const steps = getOnboardingSteps(wallet({ connected: true }))
    expect(steps.find((s) => s.id === 'wallet')!.complete).toBe(true)
    expect(steps.find((s) => s.id === 'trustline')!.complete).toBe(false)
    expect(steps.find((s) => s.id === 'payment')!.complete).toBe(false)
  })

  it('does not credit a trustline to a disconnected wallet even if hasUsdcTrustline is somehow true', () => {
    // Defensive case: bottom-up derivation means a later step can never be
    // "ahead of" a step it depends on.
    const steps = getOnboardingSteps(wallet({ connected: false, hasUsdcTrustline: true }))
    expect(steps.find((s) => s.id === 'trustline')!.complete).toBe(false)
  })

  it('marks trustline complete once connected with a trustline but an unfunded (0) balance', () => {
    const steps = getOnboardingSteps(
      wallet({ connected: true, hasUsdcTrustline: true, usdcBalance: '0' }),
    )
    expect(steps.find((s) => s.id === 'trustline')!.complete).toBe(true)
    expect(steps.find((s) => s.id === 'payment')!.complete).toBe(false)
  })

  it('marks payment complete once the balance covers at least one query (AMOUNT_USDC)', () => {
    const steps = getOnboardingSteps(
      wallet({ connected: true, hasUsdcTrustline: true, usdcBalance: '0.001' }),
    )
    expect(steps.find((s) => s.id === 'payment')!.complete).toBe(true)
  })

  it('isOnboardingComplete is true only once every step is', () => {
    expect(isOnboardingComplete(wallet())).toBe(false)
    expect(
      isOnboardingComplete(
        wallet({ connected: true, hasUsdcTrustline: true, usdcBalance: '0.001' }),
      ),
    ).toBe(true)
  })
})

// This project's test environment doesn't reliably provide a working
// native `localStorage` (Node's own experimental Web Storage global can be
// present but non-functional without a backing file — distinct from
// jsdom's, and whichever wins here doesn't implement removeItem/clear).
// Stub a real, deterministic in-memory implementation for this block
// rather than depend on host/environment localStorage behavior.
function createMemoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => void store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size
    },
  } as Storage
}

describe('onboarding dismissal persistence', () => {
  let store: Storage

  beforeEach(() => {
    store = createMemoryStorage()
    vi.stubGlobal('localStorage', store)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('is not dismissed by default', () => {
    expect(isOnboardingDismissed()).toBe(false)
  })

  it('dismissOnboarding() persists across calls until cleared', () => {
    dismissOnboarding()
    expect(isOnboardingDismissed()).toBe(true)

    clearOnboardingDismissed()
    expect(isOnboardingDismissed()).toBe(false)
  })

  it('never collects or reads a secret key — only ever touches its own localStorage flag', () => {
    const setItemSpy = vi.spyOn(store, 'setItem')
    dismissOnboarding()

    expect(setItemSpy).toHaveBeenCalledTimes(1)
    expect(setItemSpy).toHaveBeenCalledWith('stellar-search:onboarding-dismissed', '1')
  })

  it('degrades gracefully if localStorage throws (private browsing, etc.)', () => {
    vi.spyOn(store, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(isOnboardingDismissed()).toBe(false)

    vi.spyOn(store, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => dismissOnboarding()).not.toThrow()
  })
})
