import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Search, Zap, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import {
  SearchBar,
  SearchResults,
  SearchSuggestions,
  PaymentFlowVisualizer,
  StatsGrid,
  ZeroBalanceBanner,
} from '../components'
import type { SearchSession } from '../hooks/useSearch'
import type { WalletState } from '../hooks/useFreighterWallet'
import { AMOUNT_USDC } from '../lib/stellar'

export interface PendingSearch {
  query: string
  freshness?: string
}

interface Props {
  wallet: WalletState
  onConnectWallet: () => void | Promise<void> | Promise<boolean>
  session: SearchSession
  search: (query: string, countOrFreshness?: number | string, includeDomains?: string[], excludeDomains?: string[]) => Promise<void> | void
  reset: () => void
}

export function SearchPage({ wallet, onConnectWallet, session, search, reset }: Props) {
  const { t } = useTranslation('search')
  const [pendingSearch, setPendingSearch] = useState<PendingSearch | null>(null)
  const pendingSearchRef = useRef<PendingSearch | null>(null)

  // Auto-resume search when wallet connects successfully
  useEffect(() => {
    if (wallet.connected && wallet.publicKey && pendingSearchRef.current) {
      const { query, freshness } = pendingSearchRef.current
      pendingSearchRef.current = null
      setPendingSearch(null)
      if (freshness) {
        search(query, freshness)
      } else {
        search(query, 5, [], [])
      }
    }
  }, [wallet.connected, wallet.publicKey, search])

  // Handle wallet error / cancellation while a search was pending
  useEffect(() => {
    if (wallet.error && pendingSearchRef.current) {
      const errorMsg = wallet.error
      pendingSearchRef.current = null
      setPendingSearch(null)
      toast.error('Wallet connection failed', {
        description: errorMsg,
      })
    }
  }, [wallet.error])

  const handleSearch = async (
    query: string,
    freshnessOrInclude?: string | string[],
    excludeDomains?: string[],
    freshnessParam?: string
  ) => {
    let freshness: string | undefined
    let incDomains: string[] = []
    let excDomains: string[] = []

    if (typeof freshnessOrInclude === 'string') {
      freshness = freshnessOrInclude
      if (Array.isArray(excludeDomains)) incDomains = excludeDomains
    } else if (Array.isArray(freshnessOrInclude)) {
      incDomains = freshnessOrInclude
      if (Array.isArray(excludeDomains)) excDomains = excludeDomains
      if (typeof freshnessParam === 'string' && freshnessParam) freshness = freshnessParam
    }

    if (!wallet.connected) {
      const pending: PendingSearch = { query: query.trim(), freshness: freshness || undefined }
      pendingSearchRef.current = pending
      setPendingSearch(pending)
      toast.info('Connect Freighter', {
        description: 'Connect your wallet to resume your search automatically.',
      })
      try {
        const connected = await onConnectWallet()
        if (connected === false && pendingSearchRef.current) {
          pendingSearchRef.current = null
          setPendingSearch(null)
          toast.error('Wallet connection cancelled', {
            description: wallet.error || 'Connection request was cancelled. Your query was retained.',
          })
        }
      } catch (err: any) {
        if (pendingSearchRef.current) {
          pendingSearchRef.current = null
          setPendingSearch(null)
          toast.error('Wallet connection failed', {
            description: err?.message || 'Connection request failed. Your query was retained.',
          })
        }
      }
      return
    }

    pendingSearchRef.current = null
    setPendingSearch(null)
    if (freshness) {
      search(query, freshness)
    } else {
      search(query, 5, incDomains, excDomains)
    }
  }

  const handleCancelPending = () => {
    pendingSearchRef.current = null
    setPendingSearch(null)
  }

  const handleReset = () => {
    pendingSearchRef.current = null
    setPendingSearch(null)
    reset()
  }

  const isSearching = session.status === 'searching' || (!!pendingSearch && wallet.loading)

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
                {t('connectCta', 'CONNECT FREIGHTER TO SEARCH')}
              </motion.button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <ZeroBalanceBanner
        connected={wallet.connected}
        publicKey={wallet.publicKey}
        usdcBalance={wallet.usdcBalance}
      />

      {pendingSearch && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-between p-4 rounded-xl border border-neon-cyan/30 bg-neon-cyan/5 text-neon-cyan"
        >
          <div className="flex items-center gap-3">
            <Zap className="w-4 h-4 animate-pulse text-neon-cyan" />
            <p className="text-sm font-display tracking-wide">
              Connecting wallet to resume search for{' '}
              <span className="text-white font-semibold">"{pendingSearch.query}"</span>
              {pendingSearch.freshness && (
                <span className="text-white/60 text-xs ml-1">
                  ({pendingSearch.freshness})
                </span>
              )}
              ...
            </p>
          </div>
          <button
            type="button"
            onClick={handleCancelPending}
            className="text-xs text-white/50 hover:text-white underline cursor-pointer ml-3 font-display tracking-wider"
          >
            CANCEL
          </button>
        </div>
      )}

      {wallet.error && !pendingSearch && (
        <div
          role="alert"
          className="flex items-center gap-3 p-4 rounded-xl border border-red-500/25 bg-red-500/5 text-red-300"
        >
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium">{wallet.error}</p>
            <p className="text-xs text-red-400/70 mt-0.5">
              Your query and filters have been preserved in the search bar.
            </p>
          </div>
        </div>
      )}

      <SearchBar
        onSearch={handleSearch}
        isSearching={isSearching}
        walletConnected={wallet.connected}
        usdcBalance={wallet.usdcBalance}
        walletNetwork={wallet.network}
        defaultQuery={session.query || pendingSearch?.query || ''}
        defaultFreshness={pendingSearch?.freshness || ''}
      />

      <AnimatePresence>
        {session.status === 'idle' && (
          <SearchResults results={[]} query="" />
        )}
      </AnimatePresence>

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

            {(session.status === 'complete' || session.status === 'searching') && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
                {session.filters && (
                   <div className="flex flex-wrap gap-2 mb-4 px-1">
                     {session.filters.includeDomains?.map((d: string) => (
                        <span key={`inc-${d}`} className="px-3 py-1 bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan text-[10px] uppercase tracking-widest font-display rounded-full cursor-pointer hover:bg-neon-cyan/20 transition-colors" onClick={() => handleSearch(session.query, session.filters?.includeDomains?.filter((x: string) => x !== d), session.filters?.excludeDomains)}>+ {d} ✕</span>
                     ))}
                     {session.filters.excludeDomains?.map((d: string) => (
                        <span key={`exc-${d}`} className="px-3 py-1 bg-red-500/10 border border-red-500/30 text-red-400 text-[10px] uppercase tracking-widest font-display rounded-full cursor-pointer hover:bg-red-500/20 transition-colors" onClick={() => handleSearch(session.query, session.filters?.includeDomains, session.filters?.excludeDomains?.filter((x: string) => x !== d))}>- {d} ✕</span>
                     ))}
                   </div>
                )}
                <SearchResults results={session.results} query={session.query} isLoading={session.status === 'searching'} />
              </motion.div>
            )}

            {session.status === 'complete' && session.suggestions.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
                <SearchSuggestions onSelect={handleSearch} aiSuggestions={session.suggestions} />
              </motion.div>
            )}

            {(session.status === 'complete' || session.status === 'error') && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center pt-2">
                <button onClick={handleReset} className="font-display text-xs text-white/25 hover:text-neon-cyan transition-colors tracking-widest">
                  {t('newSearch', '← NEW SEARCH')}
                </button>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
