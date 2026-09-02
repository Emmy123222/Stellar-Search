import { motion } from 'framer-motion'
import { ExternalLink, Clock } from 'lucide-react'
import type { NewsResult } from '../../types'

interface Props {
  results: NewsResult[]
  isLoading?: boolean
}

export function NewsResults({ results, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="space-y-3" aria-label="Loading news results">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="animate-pulse rounded-xl p-4 space-y-2"
            style={{
              background: 'rgba(6,13,20,0.6)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <div className="w-16 h-3 bg-white/10 rounded" />
            <div className="w-3/4 h-4 bg-white/10 rounded" />
            <div className="w-1/2 h-3 bg-white/5 rounded" />
          </div>
        ))}
      </div>
    )
  }

  if (!results.length) return null

  return (
    <div className="space-y-3" role="list" aria-label="News search results">
      {results.map((article, i) => (
        <motion.a
          key={article.id}
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          role="listitem"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.06 }}
          className="block group rounded-xl p-4 hover:border-neon-cyan/25 transition-all"
          style={{
            background: 'rgba(6,13,20,0.6)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span
              className="inline-flex items-center py-0.5 px-2 rounded-full font-display text-[10px]"
              style={{
                background: 'rgba(0,245,255,0.08)',
                borderColor: 'rgba(0,245,255,0.2)',
                color: '#00f5ff',
              }}
            >
              {article.source}
            </span>
            {article.publishedAt && (
              <span className="flex items-center gap-1 text-white/25 text-xs">
                <Clock className="w-3 h-3" />
                {article.publishedAt}
              </span>
            )}
          </div>
          <h3 className="text-white font-medium text-sm leading-snug group-hover:text-neon-cyan transition-colors mb-1">
            {article.title}
          </h3>
          {article.snippet && (
            <p className="text-white/45 text-xs leading-relaxed line-clamp-2">
              {article.snippet}
            </p>
          )}
          <div className="flex items-center gap-1.5 mt-2">
            <ExternalLink className="w-3 h-3 text-neon-cyan/40" />
            <span className="font-mono text-[10px] text-neon-cyan/35 truncate">
              {article.url}
            </span>
          </div>
        </motion.a>
      ))}
    </div>
  )
}