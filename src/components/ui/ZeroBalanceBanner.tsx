import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Coins, ExternalLink, X, AlertCircle } from 'lucide-react'
import { IS_MAINNET } from '../../lib/stellar'
import type { WalletAccountStatus } from '../../types'

export interface ZeroBalanceBannerProps {
  connected: boolean
  publicKey: string | null
  usdcBalance: string
  accountExists?: boolean
  hasUsdcTrustline?: boolean
  accountStatus?: WalletAccountStatus
}

const FAUCET_URL = 'https://laboratory.stellar.org/#account-creator?network=test'
const TRUSTLINE_GUIDE_URL =
  'https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/accounts#trustlines'
const ACCOUNT_RESERVE_GUIDE_URL =
  'https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/accounts#minimum-account-balance'

const dismissKey = (publicKey: string) => `zero-balance-banner-dismissed:${publicKey}`

export function ZeroBalanceBanner({
  connected,
  publicKey,
  usdcBalance,
  accountExists,
  hasUsdcTrustline,
  accountStatus,
}: ZeroBalanceBannerProps) {
  const [dismissed, setDismissed] = useState(false)

  // Reset / restore dismissal state when the connected account changes.
  useEffect(() => {
    if (!publicKey) {
      setDismissed(false)
      return
    }
    setDismissed(sessionStorage.getItem(dismissKey(publicKey)) === '1')
  }, [publicKey])

  // Derive explicit account status
  const status: WalletAccountStatus =
    accountStatus ??
    (accountExists === false
      ? 'unfunded'
      : hasUsdcTrustline === false
        ? 'no_trustline'
        : parseFloat(usdcBalance || '0') === 0
          ? 'zero_balance'
          : 'funded')

  const visible = connected && !IS_MAINNET && status !== 'funded' && !dismissed

  const onDismiss = () => {
    if (publicKey) sessionStorage.setItem(dismissKey(publicKey), '1')
    setDismissed(true)
  }

  const renderContent = () => {
    switch (status) {
      case 'unfunded':
        return (
          <>
            <p className="text-sm text-neon-amber/90 leading-relaxed">
              Your Stellar account is not funded.{' '}
              <a
                href={FAUCET_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline underline-offset-2 hover:text-neon-amber transition-colors inline-flex items-center gap-1"
              >
                Fund account on Stellar Lab <ExternalLink className="w-3 h-3" />
              </a>
            </p>
            <p className="text-xs text-white/45">
              Stellar accounts require a minimum XLM reserve to exist on-chain.{' '}
              <a
                href={ACCOUNT_RESERVE_GUIDE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-neon-cyan/80 hover:text-neon-cyan transition-colors inline-flex items-center gap-1"
              >
                Account reserve guide <ExternalLink className="w-3 h-3" />
              </a>
            </p>
          </>
        )

      case 'no_trustline':
        return (
          <>
            <p className="text-sm text-neon-amber/90 leading-relaxed">
              Your account is active, but you need a USDC trustline to hold and spend USDC.{' '}
              <a
                href={TRUSTLINE_GUIDE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline underline-offset-2 hover:text-neon-amber transition-colors inline-flex items-center gap-1"
              >
                USDC trustline setup guide <ExternalLink className="w-3 h-3" />
              </a>
            </p>
            <p className="text-xs text-white/45">
              Add the USDC trustline in your Freighter wallet or via{' '}
              <a
                href={FAUCET_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-neon-cyan/80 hover:text-neon-cyan transition-colors inline-flex items-center gap-1"
              >
                Stellar Laboratory <ExternalLink className="w-3 h-3" />
              </a>
            </p>
          </>
        )

      case 'zero_balance':
      default:
        return (
          <>
            <p className="text-sm text-neon-amber/90 leading-relaxed">
              You need testnet USDC to search.{' '}
              <a
                href={FAUCET_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline underline-offset-2 hover:text-neon-amber transition-colors inline-flex items-center gap-1"
              >
                Get free USDC <ExternalLink className="w-3 h-3" />
              </a>
            </p>
            <p className="text-xs text-white/45">
              New to Stellar?{' '}
              <a
                href={TRUSTLINE_GUIDE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-neon-cyan/80 hover:text-neon-cyan transition-colors inline-flex items-center gap-1"
              >
                USDC trustline setup guide <ExternalLink className="w-3 h-3" />
              </a>
            </p>
          </>
        )
    }
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="relative flex items-start gap-3 p-4 pr-10 rounded-xl border border-neon-amber/25 bg-neon-amber/5"
          style={{ boxShadow: '0 0 20px rgba(255,193,7,0.06)' }}
          role="status"
          data-account-status={status}
        >
          {status === 'unfunded' ? (
            <AlertCircle className="w-4 h-4 mt-0.5 text-neon-amber flex-shrink-0" />
          ) : (
            <Coins className="w-4 h-4 mt-0.5 text-neon-amber flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0 space-y-2">{renderContent()}</div>
          <button
            onClick={onDismiss}
            aria-label="Dismiss zero-balance notice"
            className="absolute top-3 right-3 p-1 rounded text-white/30 hover:text-white/70 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
