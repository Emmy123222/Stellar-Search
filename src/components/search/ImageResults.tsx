import { motion } from 'framer-motion'
import { ExternalLink } from 'lucide-react'
import type { ImageResult } from '../../types'

interface Props {
  results: ImageResult[]
  isLoading?: boolean
}

export function ImageResults({ results, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3" aria-label="Loading image results">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div
            key={i}
            className="animate-pulse rounded-lg aspect-square"
            style={{
              background: 'rgba(6,13,20,0.6)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          />
        ))}
      </div>
    )
  }

  if (!results.length) return null

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3" role="list" aria-label="Image search results">
      {results.map((img, i) => (
        <motion.a
          key={img.id}
          href={img.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          role="listitem"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: i * 0.05 }}
          className="group relative rounded-lg overflow-hidden"
          style={{
            border: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(6,13,20,0.6)',
          }}
        >
          <img
            src={img.thumbnailUrl || img.imageUrl}
            alt={img.title}
            loading="lazy"
            className="w-full h-40 object-cover group-hover:scale-105 transition-transform duration-300"
          />
          <div className="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
            <p className="text-white text-xs truncate">{img.title}</p>
            <div className="flex items-center gap-1 text-white/40">
              <ExternalLink className="w-3 h-3" />
              <span className="text-[10px] truncate">{img.source}</span>
            </div>
          </div>
        </motion.a>
      ))}
    </div>
  )
}