import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Coins, ExternalLink, X } from 'lucide-react'
import { IS_MAINNET } from '../../lib/stellar'

interface Props {
  connected: boolean
  publicKey: string | null
  usdcBalance: string
}

const FAUCET_URL = 'https://laboratory.stellar.org/#account-creator?network=test'
const TRUSTLINE_GUIDE_URL =
  'https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/accounts#trustlines'

const dismissKey = (publicKey: string) => `zero-balance-banner-dismissed:${publicKey}`

export function ZeroBalanceBanner({ connected, publicKey, usdcBalance }: Props) {
  const [dismissed, setDismissed] = useState(false)

  // Reset / restore dismissal state when the connected account changes.
  useEffect(() => {
    if (!publicKey) {
      setDismissed(false)
      return
    }
    setDismissed(sessionStorage.getItem(dismissKey(publicKey)) === '1')
  }, [publicKey])

  const isZeroBalance = parseFloat(usdcBalance || '0') === 0
  const visible = connected && !IS_MAINNET && isZeroBalance && !dismissed

  const onDismiss = () => {
    if (publicKey) sessionStorage.setItem(dismissKey(publicKey), '1')
    setDismissed(true)
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
        >
          <Coins className="w-4 h-4 mt-0.5 text-neon-amber flex-shrink-0" />
          <div className="flex-1 min-w-0 space-y-2">
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
          </div>
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
