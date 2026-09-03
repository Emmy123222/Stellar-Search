/**
 * CollectionsPanel.tsx
 *
 * Full management UI for named collections of saved search results.
 *
 * Features:
 *  - List all collections with result counts
 *  - Create, rename, delete collections
 *  - View saved results within a collection
 *  - Remove individual saved results
 *  - Quota and count indicators
 */

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FolderOpen, FolderPlus, Trash2, Pencil, Check, X,
  ExternalLink, ChevronRight, ChevronDown,
  Bookmark, BookmarkX, Star, Clock, AlertTriangle,
  ArchiveX,
} from 'lucide-react'
import type { UseCollectionsReturn } from '../../hooks/useCollections'
import type { Collection, SavedResult } from '../../types'
import { COLLECTIONS_QUOTA_MAX, COLLECTIONS_MAX_COUNT } from '../../types'
import { explorerTxUrl, truncateHash } from '../../lib/stellar'

interface Props {
  collections: UseCollectionsReturn
}

// ─── Sub-components ──────────────────────────────────────────────────────────

/** Inline rename form for a collection. */
function RenameForm({
  initial,
  onConfirm,
  onCancel,
}: {
  initial: string
  onConfirm: (name: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.select() }, [])

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (value.trim()) onConfirm(value.trim()) }}
      className="flex items-center gap-2 flex-1 min-w-0"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={100}
        className="flex-1 min-w-0 bg-transparent border-b border-neon-cyan/40 text-sm text-white outline-none pb-0.5"
        aria-label="Rename collection"
      />
      <button type="submit" disabled={!value.trim()} className="text-neon-cyan hover:text-white transition-colors disabled:opacity-30" aria-label="Confirm rename">
        <Check className="w-4 h-4" />
      </button>
      <button type="button" onClick={onCancel} className="text-white/30 hover:text-white transition-colors" aria-label="Cancel rename">
        <X className="w-4 h-4" />
      </button>
    </form>
  )
}

/** Single saved-result row inside a collection. */
function SavedResultRow({
  saved,
  onRemove,
}: {
  saved: SavedResult
  onRemove: () => void
}) {
  const r = saved.result
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8 }}
      className="flex items-start gap-3 px-4 py-3 hover:bg-white/3 transition-colors group/row"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span
            className="inline-flex items-center py-0.5 px-1.5 rounded-full font-display"
            style={{
              background: 'rgba(0,245,255,0.08)',
              border: '1px solid rgba(0,245,255,0.15)',
              color: '#00f5ff',
              fontSize: '9px',
            }}
          >
            {r.source}
          </span>
          <div className="flex items-center gap-1 text-neon-amber/50">
            <Star className="w-2.5 h-2.5 fill-current" />
            <span className="font-display" style={{ fontSize: '10px' }}>{(r.relevanceScore * 100).toFixed(0)}%</span>
          </div>
          {r.publishedAt && (
            <div className="flex items-center gap-1 text-white/20">
              <Clock className="w-2.5 h-2.5" />
              <span style={{ fontSize: '10px' }}>{r.publishedAt}</span>
            </div>
          )}
        </div>
        <a
          href={r.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-white/80 text-xs font-medium leading-snug hover:text-neon-cyan transition-colors line-clamp-1"
          onClick={(e) => e.stopPropagation()}
        >
          {r.title}
        </a>
        <p className="text-white/30 text-xs leading-relaxed line-clamp-1 mt-0.5">
          {r.description}
        </p>
        {/* Provenance: query + tx */}
        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
          <span className="font-mono text-[10px] text-white/20 italic">"{saved.query}"</span>
          {saved.txHash && (
            <a
              href={explorerTxUrl(saved.txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 font-mono text-neon-cyan/30 hover:text-neon-cyan transition-colors"
              style={{ fontSize: '10px' }}
              onClick={(e) => e.stopPropagation()}
            >
              {truncateHash(saved.txHash, 6)} <ExternalLink className="w-2.5 h-2.5" />
            </a>
          )}
          <span className="text-white/15" style={{ fontSize: '10px' }}>
            {new Date(saved.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0 pt-0.5">
        <a
          href={r.url}
          target="_blank"
          rel="noopener noreferrer"
          className="w-6 h-6 rounded-md flex items-center justify-center border border-white/8 text-white/20 hover:text-neon-cyan hover:border-neon-cyan/30 transition-all opacity-0 group-hover/row:opacity-100"
          aria-label="Open result"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="w-3 h-3" />
        </a>
        <button
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          className="w-6 h-6 rounded-md flex items-center justify-center border border-white/8 text-white/20 hover:text-red-400 hover:border-red-400/30 transition-all opacity-0 group-hover/row:opacity-100"
          aria-label="Remove from collection"
          title="Remove"
        >
          <BookmarkX className="w-3 h-3" />
        </button>
      </div>
    </motion.div>
  )
}

// ─── CollectionRow ────────────────────────────────────────────────────────────

function CollectionRow({
  collection,
  results,
  collectionsHook,
}: {
  collection: Collection
  results: Record<string, SavedResult>
  collectionsHook: UseCollectionsReturn
}) {
  const [expanded, setExpanded] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const savedResults = collection.resultIds
    .map((id) => results[id])
    .filter(Boolean)

  const handleRename = (newName: string) => {
    collectionsHook.renameCollection(collection.id, newName)
    setRenaming(false)
  }

  const handleDelete = () => {
    if (!confirmDelete) { setConfirmDelete(true); return }
    collectionsHook.deleteCollection(collection.id)
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="rounded-xl overflow-hidden"
      style={{
        background: 'rgba(6,13,20,0.6)',
        border: '1px solid rgba(255,255,255,0.07)',
      }}
    >
      {/* Header row */}
      <div
        className="flex items-center gap-3 px-4 py-3.5 cursor-pointer hover:bg-white/2 transition-colors group/col select-none"
        onClick={() => { if (!renaming) setExpanded((v) => !v) }}
        role="button"
        aria-expanded={expanded}
        aria-label={`Toggle collection ${collection.name}`}
      >
        <FolderOpen className={`w-4 h-4 flex-shrink-0 transition-colors ${expanded ? 'text-neon-cyan' : 'text-white/30 group-hover/col:text-neon-cyan/60'}`} />

        {renaming ? (
          <RenameForm
            initial={collection.name}
            onConfirm={handleRename}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <>
            <span className="flex-1 min-w-0 text-sm font-medium text-white/80 group-hover/col:text-white transition-colors truncate">
              {collection.name}
            </span>
            <span className="text-[10px] font-display text-white/25 flex-shrink-0">
              {savedResults.length} result{savedResults.length !== 1 ? 's' : ''}
            </span>

            {/* Action buttons — show on hover */}
            <div className="flex items-center gap-1 opacity-0 group-hover/col:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={(e) => { e.stopPropagation(); setRenaming(true); setConfirmDelete(false) }}
                className="w-6 h-6 rounded-md flex items-center justify-center border border-white/10 text-white/30 hover:text-neon-cyan hover:border-neon-cyan/30 transition-all"
                aria-label="Rename collection"
                title="Rename"
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete() }}
                className={`w-6 h-6 rounded-md flex items-center justify-center border transition-all
                  ${confirmDelete
                    ? 'border-red-400/40 text-red-400 bg-red-400/10'
                    : 'border-white/10 text-white/30 hover:text-red-400 hover:border-red-400/30'
                  }`}
                aria-label={confirmDelete ? 'Confirm delete collection' : 'Delete collection'}
                title={confirmDelete ? 'Click again to confirm' : 'Delete'}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </>
        )}

        {!renaming && (
          <ChevronRight
            className={`w-3.5 h-3.5 text-white/20 flex-shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
        )}
      </div>

      {/* Delete confirmation nudge */}
      <AnimatePresence>
        {confirmDelete && !renaming && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="px-4 py-2 flex items-center gap-3"
            style={{ background: 'rgba(255,60,60,0.06)', borderTop: '1px solid rgba(255,60,60,0.15)' }}
          >
            <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
            <span className="text-xs text-red-300 flex-1">Delete "{collection.name}" and all {savedResults.length} saved result{savedResults.length !== 1 ? 's' : ''}?</span>
            <button onClick={handleDelete} className="text-xs text-red-400 font-display hover:text-red-300 transition-colors">CONFIRM</button>
            <button onClick={() => setConfirmDelete(false)} className="text-xs text-white/30 hover:text-white transition-colors">cancel</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Expanded result list */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
          >
            {savedResults.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p className="text-xs text-white/20 font-display tracking-wider">NO RESULTS SAVED YET</p>
              </div>
            ) : (
              <AnimatePresence mode="popLayout">
                {savedResults.map((saved) => (
                  <SavedResultRow
                    key={saved.id}
                    saved={saved}
                    onRemove={() => collectionsHook.removeResult(saved.id)}
                  />
                ))}
              </AnimatePresence>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function CollectionsPanel({ collections }: Props) {
  const [creatingName, setCreatingName] = useState('')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const createInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (showCreateForm) createInputRef.current?.focus()
  }, [showCreateForm])

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault()
    if (!creatingName.trim()) return
    collections.createCollection(creatingName.trim())
    setCreatingName('')
    setShowCreateForm(false)
  }

  const atCollectionLimit = collections.collections.length >= COLLECTIONS_MAX_COUNT
  const quotaPercent = Math.round((collections.totalSaved / COLLECTIONS_QUOTA_MAX) * 100)
  const quotaNearLimit = collections.totalSaved >= COLLECTIONS_QUOTA_MAX * 0.8

  return (
    <div className="space-y-4">
      {/* Panel header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <Bookmark className="w-4 h-4 text-neon-cyan/50" />
            <span className="font-display text-xs text-white/30 tracking-widest">SAVED COLLECTIONS</span>
          </div>
          <p className="text-[10px] text-white/20 font-mono">
            {collections.collections.length}/{COLLECTIONS_MAX_COUNT} collections ·{' '}
            {collections.totalSaved}/{COLLECTIONS_QUOTA_MAX} results saved
          </p>
        </div>

        <button
          onClick={() => setShowCreateForm((v) => !v)}
          disabled={atCollectionLimit}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-display text-xs tracking-wider text-neon-cyan/70 hover:text-neon-cyan hover:bg-neon-cyan/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          style={{ border: '1px solid rgba(0,245,255,0.2)', background: 'rgba(0,245,255,0.05)' }}
          aria-label="Create new collection"
          title={atCollectionLimit ? `Maximum ${COLLECTIONS_MAX_COUNT} collections reached` : 'New collection'}
        >
          <FolderPlus className="w-3.5 h-3.5" />
          NEW
        </button>
      </div>

      {/* Quota bar */}
      {collections.totalSaved > 0 && (
        <div className="space-y-1">
          <div
            className="h-1 rounded-full overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.06)' }}
            role="progressbar"
            aria-valuenow={collections.totalSaved}
            aria-valuemax={COLLECTIONS_QUOTA_MAX}
            aria-label={`${collections.totalSaved} of ${COLLECTIONS_QUOTA_MAX} results used`}
          >
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${quotaPercent}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              className="h-full rounded-full"
              style={{
                background: quotaNearLimit
                  ? 'linear-gradient(90deg, rgba(255,80,80,0.8), rgba(255,130,0,0.8))'
                  : 'linear-gradient(90deg, rgba(0,245,255,0.6), rgba(0,245,255,0.2))',
              }}
            />
          </div>
          {quotaNearLimit && (
            <p className="text-[10px] text-neon-amber/60 font-display">
              ⚠ Approaching quota ({COLLECTIONS_QUOTA_MAX - collections.totalSaved} slots remaining)
            </p>
          )}
        </div>
      )}

      {/* Quota error from hook */}
      <AnimatePresence>
        {collections.quotaError && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="rounded-xl px-4 py-3 flex items-center justify-between gap-3"
            style={{
              background: 'rgba(255,80,80,0.07)',
              border: '1px solid rgba(255,80,80,0.25)',
            }}
          >
            <p className="text-xs text-red-300">{collections.quotaError}</p>
            <button onClick={collections.clearQuotaError} className="text-xs text-white/30 hover:text-white transition-colors" aria-label="Dismiss">✕</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create collection form */}
      <AnimatePresence>
        {showCreateForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <form
              onSubmit={handleCreate}
              className="flex items-center gap-3 px-4 py-3 rounded-xl"
              style={{
                background: 'rgba(0,245,255,0.04)',
                border: '1px solid rgba(0,245,255,0.2)',
              }}
            >
              <FolderPlus className="w-4 h-4 text-neon-cyan/40 flex-shrink-0" />
              <input
                ref={createInputRef}
                value={creatingName}
                onChange={(e) => setCreatingName(e.target.value)}
                placeholder="Collection name…"
                maxLength={100}
                className="flex-1 bg-transparent text-sm text-white placeholder-white/25 outline-none"
                aria-label="New collection name"
              />
              <button
                type="submit"
                disabled={!creatingName.trim()}
                className="text-xs text-neon-cyan font-display hover:text-white transition-colors disabled:opacity-30"
              >
                CREATE
              </button>
              <button
                type="button"
                onClick={() => { setShowCreateForm(false); setCreatingName('') }}
                className="text-white/30 hover:text-white transition-colors"
                aria-label="Cancel"
              >
                <X className="w-4 h-4" />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Collection list */}
      {collections.collections.length === 0 && !showCreateForm ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-2xl p-10 text-center"
          style={{
            background: 'rgba(6,13,20,0.5)',
            border: '1px solid rgba(255,255,255,0.05)',
          }}
        >
          <ArchiveX className="w-10 h-10 text-white/8 mx-auto mb-3" />
          <p className="font-display text-xs text-white/20 tracking-widest">NO COLLECTIONS YET</p>
          <p className="text-white/20 text-sm mt-2">
            Create a collection, then save paid results into it from the search page.
          </p>
          <button
            onClick={() => setShowCreateForm(true)}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg font-display text-xs tracking-wider text-neon-cyan/70 hover:text-neon-cyan hover:bg-neon-cyan/10 transition-colors"
            style={{ border: '1px solid rgba(0,245,255,0.2)' }}
          >
            <FolderPlus className="w-3.5 h-3.5" />
            Create first collection
          </button>
        </motion.div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence mode="popLayout">
            {collections.collections.map((col) => (
              <CollectionRow
                key={col.id}
                collection={col}
                results={collections.results}
                collectionsHook={collections}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Expand-all hint when many collections */}
      {collections.collections.length >= 5 && (
        <p className="text-center text-[10px] text-white/15 font-display tracking-wider">
          {collections.collections.length} COLLECTIONS · CLICK TO EXPAND
        </p>
      )}
    </div>
  )
}
