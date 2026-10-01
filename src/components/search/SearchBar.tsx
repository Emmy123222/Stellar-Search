import { useRef, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Search, Zap, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { IS_MAINNET, EXPECTED_WALLET_NETWORK } from '../../lib/stellar'
import { calculateSearchPrice, type SearchMode } from '../../lib/constants'

interface Props {
  onSearch: (query: string, includeDomains?: string[], excludeDomains?: string[]) => void
  isSearching: boolean
  walletConnected: boolean
  usdcBalance: string
  walletNetwork: string
  defaultQuery?: string
  searchMode?: SearchMode
  resultCount?: number
}

export function SearchBar({
  onSearch,
  isSearching,
  walletConnected,
  usdcBalance,
  walletNetwork,
  defaultQuery = '',
  searchMode = 'search',
  resultCount = 5,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [includeStr, setIncludeStr] = useState('')
  const [excludeStr, setExcludeStr] = useState('')

  const currentPricing = calculateSearchPrice(searchMode, resultCount)

  const isWrongNetwork = walletConnected && walletNetwork !== EXPECTED_WALLET_NETWORK

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (isWrongNetwork) return

    const parsedUsdc = parseFloat(usdcBalance);
    const safeUsdc = isNaN(parsedUsdc) ? 0 : Math.max(0, parsedUsdc);

    if (walletConnected && safeUsdc < parseFloat(currentPricing.amountUsdc)) {
      toast.info('Low Balance', { description: `You need at least ${currentPricing.amountUsdc} USDC to search.` })
      return
    }

    const q = (e.currentTarget.elements.namedItem('q') as HTMLInputElement).value.trim()
    const includeDomains = includeStr.split(',').map(d => d.trim()).filter(Boolean)
    const excludeDomains = excludeStr.split(',').map(d => d.trim()).filter(Boolean)

    if (q) onSearch(q, includeDomains, excludeDomains)
  }

  return (
    <form onSubmit={handleSubmit} className="relative space-y-3" role="search" aria-label="Search">
      {isWrongNetwork && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute -top-12 inset-x-0 py-2 px-4 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center gap-3 text-red-400"
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <p className="text-xs font-display tracking-wide">
            NETWORK MISMATCH: Switch Freighter to {EXPECTED_WALLET_NETWORK} to search
          </p>
        </motion.div>
      )}

      <div className="relative group">
        {/* Glow ring on focus */}
        <div
          className={`absolute -inset-px rounded-2xl opacity-0 group-focus-within:opacity-100 transition-opacity blur-sm ${isWrongNetwork ? 'bg-red-500/20' : ''
            }`}
          style={!isWrongNetwork ? { background: 'linear-gradient(135deg, rgba(0,245,255,0.2), rgba(14,165,233,0.2), rgba(0,245,255,0.2))' } : {}}
        />

        <div
          className="relative flex flex-col sm:flex-row items-stretch sm:items-center gap-3 px-3 sm:px-5 py-3 sm:py-4 rounded-2xl"
          style={{
            background: 'rgba(6,13,20,0.85)',
            border: isWrongNetwork ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(0,245,255,0.15)',
            backdropFilter: 'blur(16px)',
          }}
        >
          <Search className="w-5 h-5 flex-shrink-0" style={{ color: isWrongNetwork ? 'rgba(239,68,68,0.5)' : 'rgba(0,245,255,0.5)' }} />

          <input
            ref={inputRef}
            name="q"
            type="text"
            aria-label="Search query"
            defaultValue={defaultQuery}
            placeholder={isWrongNetwork ? 'Switch network to search...' : "Search anything — pay per query, not per month..."}
            disabled={isSearching || isWrongNetwork}
            className="flex-1 min-w-0 bg-transparent text-white placeholder:text-white/20 text-sm outline-none disabled:opacity-50"
            style={{ caretColor: isWrongNetwork ? '#ef4444' : '#00f5ff' }}
          />

          <motion.button
            type="submit"
            disabled={isSearching || isWrongNetwork}
            className="flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl font-display text-xs tracking-wider transition-all disabled:opacity-40"
            style={{
              background: isSearching || isWrongNetwork ? 'transparent' : 'rgba(0,245,255,0.12)',
              border: '1px solid',
              borderColor: isSearching || isWrongNetwork ? 'rgba(255,255,255,0.1)' : 'rgba(0,245,255,0.4)',
              color: isSearching || isWrongNetwork ? 'rgba(255,255,255,0.3)' : '#00f5ff',
            }}
            whileTap={{ scale: 0.96 }}
          >
            {isSearching ? (
              <motion.div
                className="w-3.5 h-3.5 rounded-full border border-neon-cyan/40 border-t-neon-cyan"
                animate={{ rotate: 360 }}
                transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
              />
            ) : (
              <><Zap className="w-3.5 h-3.5" /> {currentPricing.amountUsdc} USDC</>
            )}
          </motion.button>
        </div>
      </div>

      <div className="flex gap-3">
        <input
          type="text"
          placeholder="Include domains (e.g. github.com, docs.rs)"
          value={includeStr}
          onChange={e => setIncludeStr(e.target.value)}
          disabled={isSearching || isWrongNetwork}
          className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder:text-white/30 outline-none focus:border-neon-cyan/50 transition-colors"
        />
        <input
          type="text"
          placeholder="Exclude domains"
          value={excludeStr}
          onChange={e => setExcludeStr(e.target.value)}
          disabled={isSearching || isWrongNetwork}
          className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder:text-white/30 outline-none focus:border-neon-cyan/50 transition-colors"
        />
      </div>

      {/* Meta row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mt-2 px-1">
        <p className="font-display text-xs text-white/20">
          {walletConnected
            ? `Balance: ${usdcBalance} USDC · ~${Math.floor((isNaN(parseFloat(usdcBalance)) ? 0 : Math.max(0, parseFloat(usdcBalance))) / parseFloat(currentPricing.amountUsdc)).toLocaleString()} queries left (${searchMode}, count ${resultCount}, tier ${currentPricing.amountUsdc} USDC)`
            : 'Connect Freighter wallet to search'}
        </p>
        <p className="font-display text-xs text-white/20 uppercase tracking-widest">
          Serper.dev · x402 · Stellar {IS_MAINNET ? 'Mainnet' : 'Testnet'}
        </p>
      </div>
    </form>
  )
}
