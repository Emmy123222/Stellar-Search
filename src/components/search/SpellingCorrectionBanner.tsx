import { motion } from 'framer-motion'
import { Sparkles, ArrowRight, X, Info } from 'lucide-react'
import { AMOUNT_USDC } from '../../lib/stellar'

interface Props {
  originalQuery?: string
  executedQuery?: string
  suggestedQuery?: string
  isCorrected?: boolean
  onSearch: (query: string) => void
  onDismiss?: () => void
  isDismissed?: boolean
}

/**
 * Banner displayed when search provider auto-corrects a query
 * or suggests a spelling correction ("Did you mean?").
 *
 * Allows users to:
 * - See what query was actually executed vs what was typed
 * - Search the original query if auto-corrected (explicit confirmation)
 * - Accept a suggested query (explicit Freighter confirmation, never silent/automatic)
 * - Reject/dismiss a suggestion without making any second payment (0 USDC)
 */
export function SpellingCorrectionBanner({
  originalQuery,
  executedQuery,
  suggestedQuery,
  isCorrected = false,
  onSearch,
  onDismiss,
  isDismissed = false,
}: Props) {
  if (isDismissed) return null

  // Case 1: Provider auto-corrected query
  if (isCorrected && executedQuery && originalQuery && executedQuery.toLowerCase() !== originalQuery.toLowerCase()) {
    return (
      <motion.div
        data-testid="spelling-correction-banner"
        role="status"
        aria-live="polite"
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        className="p-3.5 sm:p-4 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-sm"
        style={{
          background: 'rgba(0, 245, 255, 0.05)',
          border: '1px solid rgba(0, 245, 255, 0.25)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <div className="flex items-start gap-2.5">
          <Info className="w-4 h-4 text-neon-cyan flex-shrink-0 mt-0.5" />
          <div className="text-white/80 leading-relaxed">
            <span>Showing results for </span>
            <span className="font-semibold text-neon-cyan">"{executedQuery}"</span>
            <span className="text-white/40 text-xs block sm:inline sm:ml-2">
              (auto-corrected from <em className="italic text-white/60">"{originalQuery}"</em>)
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center">
          <button
            type="button"
            data-testid="search-original-btn"
            onClick={() => onSearch(originalQuery)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-display tracking-wider text-white/70 hover:text-white bg-white/5 hover:bg-white/10 transition-all border border-white/10 hover:border-white/20"
            title={`Search original query "${originalQuery}" (${AMOUNT_USDC} USDC with wallet approval)`}
          >
            <span>Search instead for <em>"{originalQuery}"</em></span>
            <ArrowRight className="w-3 h-3 text-neon-cyan" />
          </button>
        </div>
      </motion.div>
    )
  }

  // Case 2: Provider returned "Did you mean?" suggestion (not auto-corrected)
  if (suggestedQuery && originalQuery && suggestedQuery.toLowerCase() !== originalQuery.toLowerCase()) {
    return (
      <motion.div
        data-testid="spelling-correction-banner"
        role="status"
        aria-live="polite"
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        className="p-3.5 sm:p-4 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-sm"
        style={{
          background: 'rgba(255, 176, 0, 0.06)',
          border: '1px solid rgba(255, 176, 0, 0.3)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <div className="flex items-start gap-2.5">
          <Sparkles className="w-4 h-4 text-neon-amber flex-shrink-0 mt-0.5" />
          <div className="text-white/80 leading-relaxed">
            <span className="text-neon-amber font-medium mr-1.5">Did you mean:</span>
            <button
              type="button"
              onClick={() => onSearch(suggestedQuery)}
              className="font-semibold text-neon-amber hover:underline cursor-pointer inline-flex items-center gap-1"
              title={`Search "${suggestedQuery}" (${AMOUNT_USDC} USDC)`}
            >
              <span>"{suggestedQuery}"</span>
            </button>
            <span className="text-white/40 text-xs block sm:inline sm:ml-2">
              (current results are for <em className="italic text-white/60">"{originalQuery}"</em>)
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center">
          <button
            type="button"
            data-testid="accept-suggestion-btn"
            onClick={() => onSearch(suggestedQuery)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-display tracking-wider text-neon-amber hover:text-white transition-all"
            style={{
              background: 'rgba(255, 176, 0, 0.12)',
              border: '1px solid rgba(255, 176, 0, 0.4)',
            }}
            title={`Search "${suggestedQuery}" with wallet confirmation`}
          >
            <span>Search Suggestion</span>
            <ArrowRight className="w-3 h-3 text-neon-amber" />
          </button>

          {onDismiss && (
            <button
              type="button"
              data-testid="reject-suggestion-btn"
              onClick={onDismiss}
              aria-label="Dismiss suggestion"
              className="p-1.5 rounded-lg text-white/40 hover:text-white/80 bg-white/5 hover:bg-white/10 transition-all border border-white/10 hover:border-white/20"
              title="Dismiss suggestion without payment"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </motion.div>
    )
  }

  return null
}
