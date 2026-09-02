/**
 * onboarding.ts — First-run onboarding step detection (#342)
 *
 * Pure functions, no React and no secrets: every check reads only the
 * already-public wallet state (connection flag, network, balances) that
 * useFreighterWallet already exposes. Nothing here ever touches a private
 * key or asks the user for one.
 */

import { AMOUNT_USDC } from './constants'
import type { WalletState } from '../types'

export type OnboardingStepId = 'wallet' | 'trustline' | 'payment'

export interface OnboardingStep {
  id: OnboardingStepId
  complete: boolean
}

const DISMISSED_KEY = 'stellar-search:onboarding-dismissed'

/**
 * The three first-run steps, each derived from existing wallet state:
 *  1. wallet    — Freighter connected
 *  2. trustline — a USDC trustline exists on the connected account
 *  3. payment   — that trustline is funded with at least one query's worth
 *                 of USDC, i.e. an actual x402 payment could settle
 *
 * Each step requires the previous one, so a wallet state that's connected
 * but (impossibly) reports a payment-ready trustline without a live
 * connection still can't skip ahead — completion is derived bottom-up.
 */
export function getOnboardingSteps(
  wallet: Pick<WalletState, 'connected' | 'hasUsdcTrustline' | 'usdcBalance'>,
): OnboardingStep[] {
  const walletConnected = wallet.connected
  const trustlineEstablished = walletConnected && wallet.hasUsdcTrustline
  const paymentReady =
    trustlineEstablished && parseFloat(wallet.usdcBalance || '0') >= parseFloat(AMOUNT_USDC)

  return [
    { id: 'wallet', complete: walletConnected },
    { id: 'trustline', complete: trustlineEstablished },
    { id: 'payment', complete: paymentReady },
  ]
}

export function isOnboardingComplete(
  wallet: Pick<WalletState, 'connected' | 'hasUsdcTrustline' | 'usdcBalance'>,
): boolean {
  return getOnboardingSteps(wallet).every((step) => step.complete)
}

/** Has the user explicitly dismissed onboarding on this browser before?
 *  Safe to call during SSR/tests — returns false if localStorage isn't
 *  available rather than throwing. */
export function isOnboardingDismissed(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

export function dismissOnboarding(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, '1')
  } catch {
    // localStorage unavailable (private browsing, SSR, etc.) — the user can
    // still reopen/skip manually within the session, just won't be
    // remembered across page loads.
  }
}

/** Clears the dismissal flag — used when the user explicitly reopens the
 *  guide, so it doesn't immediately re-hide itself as "already dismissed". */
export function clearOnboardingDismissed(): void {
  try {
    localStorage.removeItem(DISMISSED_KEY)
  } catch {
    // See dismissOnboarding.
  }
}
