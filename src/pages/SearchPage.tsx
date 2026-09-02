import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Search, Zap, AlertCircle } from 'lucide-react'
import {
  SearchBar,
  SearchResults,
  SearchSuggestions,
  PaymentFlowVisualizer,
  StatsGrid,
  ZeroBalanceBanner,
  SpellingCorrectionBanner,
  ModeSelector,
  ImageResults,
  NewsResults,
} from '../components'
import type { SearchSession } from '../hooks/useSearch'
import type { WalletState } from '../hooks/useFreighterWallet'
import type { SearchMode } from '../types'
import { AMOUNT_USDC } from '../lib/stellar'

interface Props {
  wallet: WalletState
  onConnectWallet: () => void
  session: SearchSession
  search: (query: string, freshnessOrCount?: string | number, count?: number, mode?: SearchMode) => Promise<void>
  reset: () => void
}

export function SearchPage({ wallet, onConnectWallet, session, search, reset }: Props) {
  const { t } = useTranslation('search')
  const [dismissedSuggestion, setDismissedSuggestion] = useState(false)
  const [searchMode, setSearchMode] = useState<SearchMode>('web')

  const handleSearch = (query: string, freshness?: string) => {
    setDismissedSuggestion(false)
    if (!wallet.connected) { onConnectWallet(); return }
    search(query, freshness, searchMode === 'web' ? 5 : 10, searchMode)
  }

  const handleReset = () => {
    setDismissedSuggestion(false)
    reset()
  }

  const isSearching = session.status === 'searching'

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <StatsGrid />

      <AnimatePresence>
        {session.status === 'idle' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="text-center space-y-4 py-8"
          >
            <motion.div
              className="relative w-20 h-20 mx-auto mb-5"
              animate={{ rotate: [0, 360] }}
              transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
            >
              <div className="absolute inset-0 rounded-full border border-neon-cyan/20" />
              <div className="absolute inset-2 rounded-full border border-neon-cyan/40" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ background: 'rgba(0,245,255,0.15)', border: '1px solid rgba(0,245,255,0.5)', boxShadow: '0 0 10px rgba(0,245,255,0.3)' }}
                >
                  <Search className="w-4 h-4 text-neon-cyan" />
                </div>
              </div>
            </motion.div>

            <h1 className="font-display text-4xl sm:text-5xl text-white leading-tight">
              SEARCH
              <span className="text-neon-cyan" style={{ textShadow: '0 0 20px rgba(0,245,255,0.8)' }}>.</span>
              PAY
              <span className="text-neon-cyan" style={{ textShadow: '0 0 20px rgba(0,245,255,0.8)' }}>.</span>
              GET
            </h1>

            <p className="text-white/45 text-lg max-w-md mx-auto leading-relaxed">
              Real web search for AI agents.{' '}
              <span className="text-neon-cyan font-medium">{AMOUNT_USDC} USDC</span> per query settled on Stellar via x402.
              Powered by <span className="text-neon-amber font-medium">Serper.dev</span> +{' '}
              <span className="text-neon-green font-medium">Groq AI</span>.
            </p>

            {!wallet.connected && (
              <motion.button
                onClick={onConnectWallet}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-display text-sm tracking-wider text-neon-cyan"
                style={{ border: '1px solid rgba(0,245,255,0.4)', background: 'rgba(0,245,255,0.08)', boxShadow: '0 0 20px rgba(0,245,255,0.15)' }}
              >
                <Zap className="w-4 h-4" />
                {t('connectCta')}
              </motion.button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <ZeroBalanceBanner
        connected={wallet.connected}
        publicKey={wallet.publicKey}
        usdcBalance={wallet.usdcBalance}
        accountExists={wallet.accountExists}
        hasUsdcTrustline={wallet.hasUsdcTrustline}
        accountStatus={wallet.accountStatus}
      />

      <ModeSelector
        mode={searchMode}
        onChange={setSearchMode}
        disabled={isSearching}
      />

      <SearchBar
        onSearch={handleSearch}
        isSearching={isSearching}
        walletConnected={wallet.connected}
        usdcBalance={wallet.usdcBalance}
        walletNetwork={wallet.network}
        defaultQuery={session.query}
      />

      <AnimatePresence>
        {session.status !== 'idle' && (
          <motion.div
            key="results-area"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-5"
          >
            <PaymentFlowVisualizer session={session} />

            {session.status === 'error' && (
              <div className="flex items-center gap-3 p-4 rounded-xl border border-red-500/25 bg-red-500/5">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                <p className="text-sm text-red-300">{session.error}</p>
              </div>
            )}

            {session.status === 'complete' && searchMode === 'web' && (
              <SpellingCorrectionBanner
                originalQuery={session.originalQuery}
                executedQuery={session.executedQuery || session.query}
                suggestedQuery={session.suggestedQuery}
                isCorrected={session.isCorrected}
                onSearch={handleSearch}
                onDismiss={() => setDismissedSuggestion(true)}
                isDismissed={dismissedSuggestion}
              />
            )}

            {searchMode === 'web' && (session.status === 'complete' || session.status === 'searching') && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
                <SearchResults results={session.results as any} query={session.query} isLoading={session.status === 'searching'} txHash={session.txHash} />
              </motion.div>
            )}

            {searchMode === 'images' && (session.status === 'complete' || session.status === 'searching') && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
                <ImageResults results={session.results as any} isLoading={session.status === 'searching'} />
              </motion.div>
            )}

            {searchMode === 'news' && (session.status === 'complete' || session.status === 'searching') && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
                <NewsResults results={session.results as any} isLoading={session.status === 'searching'} />
              </motion.div>
            )}

            {session.status === 'complete' && session.suggestions && session.suggestions.length > 0 && searchMode === 'web' && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
                <SearchSuggestions onSelect={handleSearch} aiSuggestions={session.suggestions} />
              </motion.div>
            )}

            {(session.status === 'complete' || session.status === 'error') && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center pt-2">
                <button onClick={handleReset} className="font-display text-xs text-white/25 hover:text-neon-cyan transition-colors tracking-widest">
                  {t('newSearch')}
                </button>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}