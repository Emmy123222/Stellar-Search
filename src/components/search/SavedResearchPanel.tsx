import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Bookmark, ExternalLink, Tag, Trash2, X } from 'lucide-react'
import { useSavedResearch } from '../../hooks/useSavedResearch'
import { formatTimeAgo } from '../../lib/stellar'

/**
 * Dashboard panel listing the user's saved research, with editable notes
 * and tags per item, and tag-based filtering (#305).
 */
export function SavedResearchPanel() {
  const { items, remove, updateNotes, addTag, removeTag } = useSavedResearch()
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [tagDraft, setTagDraft] = useState<Record<string, string>>({})

  const allTags = useMemo(() => {
    const set = new Set<string>()
    items.forEach((i) => i.tags.forEach((t) => set.add(t)))
    return Array.from(set).sort()
  }, [items])

  const visibleItems = useMemo(
    () => (activeTag ? items.filter((i) => i.tags.includes(activeTag)) : items),
    [items, activeTag],
  )

  const handleAddTag = (id: string) => {
    const draft = tagDraft[id]?.trim()
    if (!draft) return
    addTag(id, draft)
    setTagDraft((prev) => ({ ...prev, [id]: '' }))
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.25 }}
      className="rounded-2xl overflow-hidden"
      style={{ background: 'rgba(6,13,20,0.7)', border: '1px solid rgba(255,184,0,0.12)' }}
    >
      <div className="flex items-center justify-between p-5 border-b border-white/5 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Bookmark className="w-4 h-4 text-neon-amber/50" />
          <span className="font-display text-xs text-white/30 tracking-widest">SAVED RESEARCH</span>
          <span className="font-display text-white/15" style={{ fontSize: '10px' }}>· NOTES &amp; TAGS · PERSISTED LOCALLY</span>
        </div>
        <div className="font-display text-[10px] text-white/20 uppercase tracking-wider">
          {items.length} SAVED
        </div>
      </div>

      {allTags.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap px-5 py-3 border-b border-white/5">
          <Tag className="w-3 h-3 text-white/20 flex-shrink-0" />
          <button
            onClick={() => setActiveTag(null)}
            className="px-2 py-0.5 rounded-full text-[10px] font-mono transition-colors"
            style={{
              background: activeTag === null ? 'rgba(255,184,0,0.15)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${activeTag === null ? 'rgba(255,184,0,0.4)' : 'rgba(255,255,255,0.1)'}`,
              color: activeTag === null ? '#ffb800' : 'rgba(255,255,255,0.4)',
            }}
          >
            ALL
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              className="px-2 py-0.5 rounded-full text-[10px] font-mono transition-colors"
              style={{
                background: activeTag === tag ? 'rgba(255,184,0,0.15)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${activeTag === tag ? 'rgba(255,184,0,0.4)' : 'rgba(255,255,255,0.1)'}`,
                color: activeTag === tag ? '#ffb800' : 'rgba(255,255,255,0.4)',
              }}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}

      <div className="divide-y divide-white/4">
        {visibleItems.length === 0 ? (
          <div className="text-center py-10">
            <Bookmark className="w-8 h-8 text-white/10 mx-auto mb-3" />
            <p className="font-display text-xs text-white/20 tracking-widest">
              {items.length === 0 ? 'NO SAVED RESEARCH YET' : 'NO ITEMS WITH THIS TAG'}
            </p>
            {items.length === 0 && (
              <p className="text-white/25 text-sm mt-2">Click the bookmark icon on a search result to save it here</p>
            )}
          </div>
        ) : (
          visibleItems.map((item, i) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.03 }}
              className="px-5 py-4 space-y-2.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-white/80 font-medium hover:text-neon-amber transition-colors inline-flex items-center gap-1.5"
                  >
                    {item.title}
                    <ExternalLink className="w-3 h-3 flex-shrink-0 opacity-50" />
                  </a>
                  <p className="text-white/30 text-xs mt-0.5">
                    Saved from "{item.query}" · {formatTimeAgo(item.savedAt)}
                  </p>
                </div>
                <button
                  onClick={() => remove(item.id)}
                  aria-label="Remove from saved research"
                  className="flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-white/25 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Notes */}
              <textarea
                value={item.notes}
                onChange={(e) => updateNotes(item.id, e.target.value)}
                placeholder="Add notes about this result…"
                rows={2}
                className="w-full rounded-lg px-3 py-2 text-xs text-white/70 placeholder-white/20 resize-y focus:outline-none focus:border-neon-amber/40 transition-colors"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
              />

              {/* Tags */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {item.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono"
                    style={{ background: 'rgba(255,184,0,0.08)', border: '1px solid rgba(255,184,0,0.2)', color: '#ffb800' }}
                  >
                    #{tag}
                    <button
                      onClick={() => removeTag(item.id, tag)}
                      aria-label={`Remove tag ${tag}`}
                      className="hover:text-red-400 transition-colors"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))}
                <input
                  value={tagDraft[item.id] ?? ''}
                  onChange={(e) => setTagDraft((prev) => ({ ...prev, [item.id]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleAddTag(item.id)
                    }
                  }}
                  placeholder="+ tag"
                  className="w-16 bg-transparent text-[10px] font-mono text-white/40 placeholder-white/15 focus:outline-none focus:text-white/70"
                />
              </div>
            </motion.div>
          ))
        )}
      </div>
    </motion.div>
  )
}
