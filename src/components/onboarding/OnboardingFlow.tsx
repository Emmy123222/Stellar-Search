/**
 * OnboardingFlow.tsx — First-run setup guide (#342)
 *
 * Walks a new user through the three things required for a paid search to
 * work: connect Freighter, establish a USDC trustline, fund it. Every step's
 * completion is derived from existing public wallet state (see
 * lib/onboarding.ts) — nothing here collects or touches a secret key, and
 * nothing here builds or signs a transaction; trustline/funding are
 * point-and-click via Freighter/external tools, keeping payment-signing
 * code exactly where it already lives (useSearch's x402 flow).
 */
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, Circle, ExternalLink, Wallet, X } from 'lucide-react'
import {
  getOnboardingSteps,
  isOnboardingComplete,
  isOnboardingDismissed,
  dismissOnboarding,
  type OnboardingStepId,
} from '../../lib/onboarding'
import { IS_MAINNET, USDC_ISSUER, AMOUNT_USDC, truncateAddress } from '../../lib/stellar'
import type { WalletState } from '../../types'

interface Props {
  wallet: WalletState
  onConnectWallet: () => void
  /** Controlled from App.tsx so a Navbar button can reopen the guide even
   *  after it's been dismissed or completed. */
  open: boolean
  onOpenChange: (open: boolean) => void
}

const STEP_KEYS: Record<OnboardingStepId, string> = {
  wallet: 'steps.wallet',
  trustline: 'steps.trustline',
  payment: 'steps.payment',
}

/** Renders nothing until called for — used by App.tsx to decide whether to
 *  auto-open the guide on first run (never auto-reopens once dismissed). */
export function shouldAutoOpenOnboarding(wallet: WalletState): boolean {
  return !isOnboardingDismissed() && !isOnboardingComplete(wallet)
}

export function OnboardingFlow({ wallet, onConnectWallet, open, onOpenChange }: Props) {
  const { t } = useTranslation('onboarding')
  const steps = getOnboardingSteps(wallet)
  const complete = steps.every((s) => s.complete)

  // Auto-close the moment every step completes, so a user who finishes
  // setup mid-flow (e.g. funds their trustline in another tab) isn't stuck
  // looking at a stale "all done, dismiss me" modal.
  useEffect(() => {
    if (complete && open) onOpenChange(false)
  }, [complete, open, onOpenChange])

  if (!open) return null

  const handleSkip = () => {
    dismissOnboarding()
    onOpenChange(false)
  }

  const handleClose = () => {
    // Closing without finishing isn't the same as "skip" — it can still
    // auto-reopen next visit unless the user explicitly skipped. Reopening
    // (e.g. via a Navbar button) clears the dismissal flag itself — see
    // App.tsx's handleReopenOnboarding.
    onOpenChange(false)
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.7)' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        onClick={handleClose}
      >
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.97 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md rounded-2xl overflow-hidden"
          style={{
            background: 'rgba(6,13,20,0.97)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(0,245,255,0.15)',
          }}
        >
          <div className="p-5 border-b border-white/5 flex items-start justify-between">
            <div>
              <h2 id="onboarding-title" className="font-display text-sm text-white tracking-wider">
                {t('title')}
              </h2>
              <p className="text-xs text-white/40 mt-1">
                {t('subtitle')}
              </p>
            </div>
            <button
              onClick={handleClose}
              aria-label={t('close')}
              className="p-1.5 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/5 transition-colors flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-5 space-y-4">
            {steps.map((step, i) => {
              const key = STEP_KEYS[step.id]
              return (
                <div key={step.id} className="flex gap-3">
                  <div className="flex-shrink-0 mt-0.5">
                    {step.complete ? (
                      <CheckCircle2 className="w-5 h-5 text-neon-green" />
                    ) : (
                      <Circle className="w-5 h-5 text-white/20" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`font-display text-xs tracking-wide ${step.complete ? 'text-white/40 line-through' : 'text-white'}`}>
                      {i + 1}. {t(`${key}.title`)}
                    </p>
                    {!step.complete && (
                      <p className="text-xs text-white/40 mt-1 leading-relaxed">
                        {t(`${key}.description`, { amount: AMOUNT_USDC })}
                      </p>
                    )}

                    {step.id === 'wallet' && !step.complete && (
                      <button
                        onClick={onConnectWallet}
                        disabled={wallet.loading}
                        className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neon-cyan/30 bg-neon-cyan/5 text-neon-cyan font-display text-[11px] tracking-wider hover:bg-neon-cyan/10 transition-colors disabled:opacity-50"
                      >
                        <Wallet className="w-3 h-3" />
                        {wallet.loading ? t('steps.wallet.connecting') : t('steps.wallet.cta')}
                      </button>
                    )}

                    {step.id === 'trustline' && steps[0].complete && !step.complete && (
                      <div className="mt-2 space-y-1.5">
                        <p className="text-[10px] text-white/30 font-mono break-all">
                          {t('steps.trustline.issuerLabel', { issuer: truncateAddress(USDC_ISSUER, 10) })}
                        </p>
                      </div>
                    )}

                    {step.id === 'payment' && steps[1].complete && !step.complete && (
                      <a
                        href={
                          IS_MAINNET
                            ? 'https://www.circle.com/en/usdc'
                            : 'https://laboratory.stellar.org/#account-creator?network=test'
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neon-amber/30 bg-neon-amber/5 text-neon-amber font-display text-[11px] tracking-wider hover:bg-neon-amber/10 transition-colors"
                      >
                        {IS_MAINNET ? t('steps.payment.buyUsdc') : t('steps.payment.fundTestnet')} <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Testnet/mainnet are explicitly distinguished, not just via the
              per-step funding links above — a banner makes it unmissable
              which kind of funds are in play (#342). */}
          <div
            className={`mx-5 mb-4 px-3 py-2 rounded-lg text-[11px] font-display tracking-wide ${
              IS_MAINNET
                ? 'bg-neon-amber/5 border border-neon-amber/20 text-neon-amber/80'
                : 'bg-neon-cyan/5 border border-neon-cyan/20 text-neon-cyan/80'
            }`}
          >
            {IS_MAINNET ? t('banner.mainnet') : t('banner.testnet')}
          </div>

          <div className="p-5 pt-0">
            <button
              onClick={handleSkip}
              className="text-xs text-white/30 hover:text-white/50 transition-colors font-display tracking-wide"
            >
              {t('skip')}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
