import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'

const STATIC_SUGGESTIONS = [
  'x402 payment protocol Stellar',
  'Soroban smart contracts tutorial',
  'AI agent autonomous payments 2025',
  'USDC stablecoin Stellar network',
  'Freighter wallet Stellar dApp',
  'Groq Llama 3 fast inference API',
]

interface Props {
  onSelect: (query: string) => void
  /** AI-generated suggestions shown after a search completes */
  aiSuggestions?: string[]
}

export function SearchSuggestions({ onSelect, aiSuggestions }: Props) {
  const isAi = aiSuggestions && aiSuggestions.length > 0
  const nextItems = isAi ? aiSuggestions : STATIC_SUGGESTIONS
  const [items, setItems] = useState<string[]>(STATIC_SUGGESTIONS)

  useEffect(() => {
    const timer = window.setTimeout(() => setItems([...nextItems]), 300)
    return () => window.clearTimeout(timer)
  }, [aiSuggestions])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="space-y-3"
    >
      <div className="flex items-center gap-1.5">
        {isAi && <Sparkles className="w-3 h-3 text-neon-amber/60" />}
        <p className="font-display text-xs text-white/25 tracking-widest">
          {isAi ? 'YOU MIGHT ALSO SEARCH FOR' : 'TRY THESE'}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {items.map((q, i) => (
          <motion.button
            key={q}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            onClick={() => onSelect(q)}
            className="px-3 py-1.5 rounded-lg text-xs font-display tracking-wide transition-all text-white/40 hover:text-neon-cyan/80"
            style={{ border: '1px solid rgba(255,255,255,0.08)' }}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLButtonElement
              el.style.borderColor = isAi ? 'rgba(255,176,0,0.3)' : 'rgba(0,245,255,0.25)'
              el.style.background   = isAi ? 'rgba(255,176,0,0.05)' : 'rgba(0,245,255,0.04)'
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLButtonElement
              el.style.borderColor = 'rgba(255,255,255,0.08)'
              el.style.background  = 'transparent'
            }}
          >
            {q}
          </motion.button>
        ))}
      </div>
    </motion.div>
  )
}
