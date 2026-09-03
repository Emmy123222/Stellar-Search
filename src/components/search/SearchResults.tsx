import { readBrowserConfig } from '../../lib/config'
import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ExternalLink, Star, Clock, Sparkles, Download, FileJson, FileSpreadsheet, Check, Copy, ShieldAlert } from 'lucide-react'
import type { SearchResult } from '../../hooks/useSearch'
import { useSavedResearch } from '../../hooks/useSavedResearch'
import { explorerTxUrl, truncateHash } from '../../lib/stellar'
import { AiMarkdown } from '../ai/AiMarkdown'

interface Props {
  results: SearchResult[]
  query: string
  isLoading?: boolean
  txHash?: string | null
  filters?: Record<string, unknown>
  network?: string
}

const SERVER_URL = (path: string) => resolveApiUrl(path)

export function SearchResults({ results, query, isLoading, txHash, filters = {}, network = 'public' }: Props) {
  const [summary, setSummary]               = useState<string>('')
  const [summaryError, setSummaryError]     = useState<string | null>(null)
  const [summarizing, setSummarizing]       = useState(false)
  const [copiedUrl, setCopiedUrl]           = useState<string | null>(null)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement>(null)
  const { isSaved, toggle: toggleSaved }    = useSavedResearch()

  useEffect(() => {
    if (!showExportMenu) return
    const close = (event: MouseEvent) => {
      if (!exportMenuRef.current?.contains(event.target as Node)) setShowExportMenu(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowExportMenu(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape) }
  }, [showExportMenu])

  const [savedSets, setSavedSets] = useState<StoredResultSet[]>(() => {
    try {
      if (typeof window === 'undefined') return []
      const raw = window.localStorage.getItem(STORAGE_KEY)
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? (parsed as StoredResultSet[]) : []
    } catch {
      return []
    }
  })
  const [compareAId, setCompareAId] = useState('')
  const [compareBId, setCompareBId] = useState('')
  const [showCompare, setShowCompare] = useState(false)

  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(savedSets))
      }
    } catch {
      // ignore storage write failures
    }
  }, [savedSets])

  const saveCurrentSet = () => {
    if (!results.length) return
    const id = `set-${Date.now()}`
    setSavedSets(prev => [
      { id, label: `"${query}" · ${new Date().toLocaleString()}`, savedAt: Date.now(), results },
      ...prev,
    ].slice(0, 20))
    setCompareAId(prev => prev || (savedSets[0]?.id ?? ''))
    setCompareBId(id)
    setShowCompare(true)
  }

  const comparisonRows = useMemo<CompareRow[]>(() => {
    const setA = savedSets.find(s => s.id === compareAId)
    const setB = savedSets.find(s => s.id === compareBId)
    if (!showCompare || !setA || !setB) return []

    const mapA = new Map<string, { result: SearchResult; index: number }>()
    const mapB = new Map<string, { result: SearchResult; index: number }>()

    setA.results.forEach((result, index) => {
      const key = canonicalUrl(result.url)
      if (!mapA.has(key)) mapA.set(key, { result, index })
    })
    setB.results.forEach((result, index) => {
      const key = canonicalUrl(result.url)
      if (!mapB.has(key)) mapB.set(key, { result, index })
    })

    return Array.from(new Set([...mapA.keys(), ...mapB.keys()]))
      .map(url => {
        const a = mapA.get(url)
        const b = mapB.get(url)
        if (a && b) {
          return {
            url,
            status: a.index === b.index ? ('unchanged' as const) : ('moved' as const),
            resultA: a.result,
            resultB: b.result,
            indexA: a.index,
            indexB: b.index,
          }
        }
        if (a) {
          return { url, status: 'removed' as const, resultA: a.result, indexA: a.index }
        }
        return { url, status: 'added' as const, resultB: b!.result, indexB: b!.index }
      })
      .sort((x, y) => (x.indexA ?? x.indexB ?? 0) - (y.indexA ?? y.indexB ?? 0))
  }, [savedSets, compareAId, compareBId, showCompare])

  const renderCompareRows = (side: 'A' | 'B') => {
    const isLeft = side === 'A'
    const setId = isLeft ? compareAId : compareBId
    const set = savedSets.find(s => s.id === setId)
    return (
      <div className="space-y-2">
        <div className="font-display text-xs text-white/40 tracking-wider">
          {isLeft ? 'BEFORE' : 'AFTER'} · {set?.label ?? (isLeft ? 'Set A' : 'Set B')}
        </div>
        {comparisonRows.map(row => {
          const result = isLeft ? row.resultA : row.resultB
          const index = isLeft ? row.indexA : row.indexB
          if (!result) {
            return (
              <div
                key={`${side}-${row.url}`}
                className="rounded-lg p-3"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.1)' }}
              >
                <p className="text-white/20 text-xs italic py-2">
                  No result in {isLeft ? 'set A' : 'set B'}
                </p>
              </div>
            )
          }
          const badgeColor =
            row.status === (isLeft ? 'removed' : 'added')
              ? isLeft ? '#ff5555' : '#00ff00'
              : row.status === 'moved'
                ? '#ffb400'
                : 'rgba(255,255,255,0.4)'
          return (
            <div
              key={`${side}-${row.url}`}
              className="rounded-lg p-3"
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-display text-[10px] tracking-wider" style={{ color: badgeColor }}>
                    {row.status.toUpperCase()}
                  </span>
                  <span className="text-white/30 text-[10px]">#{index! + 1}</span>
                  {row.status === 'moved' && row.indexA !== undefined && row.indexB !== undefined && (
                    <span className="text-white/30 text-[10px]">#{row.indexA + 1}→#{row.indexB + 1}</span>
                  )}
                </div>
                <a
                  href={result.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-white text-xs font-medium leading-snug hover:text-neon-cyan"
                >
                  {result.title}
                </a>
                <p className="text-white/40 text-[10px] truncate">{row.url}</p>
                <p className="text-white/30 text-[10px]">
                  {result.source} · {(result.relevanceScore * 100).toFixed(0)}%
                </p>
                <p className="text-white/30 text-[10px] leading-snug line-clamp-2">{result.description}</p>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null)

  useEffect(() => {
    setSelectedIds(null)
  }, [results])

  const selectedResults = selectedIds === null ? results : results.filter(r => selectedIds.has(r.id))
  const selectedCount = selectedIds === null ? results.length : selectedResults.length
  const allSelected = results.length > 0 && selectedCount === results.length
  const isSelected = (id: string) => selectedIds === null || selectedIds.has(id)

  const toggleOne = (id: string) => {
    setSelectedIds(prev => {
      if (prev === null) {
        return new Set(results.filter(r => r.id !== id).map(r => r.id))
      }
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAll = () => setSelectedIds(null)
  const selectNone = () => setSelectedIds(new Set())

  const buildExportMetadata = () => ({
    version: 1,
    exportedAt: new Date().toISOString(),
    query,
    filters,
    network,
    receiptReference: txHash ?? null,
  })

  const exportAsJSON = () => {
    if (!selectedResults.length) return
    const metadata = buildExportMetadata()
    const blob = new Blob([JSON.stringify({ metadata, results: selectedResults }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = getExportFilename('json')
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setTimeout(() => URL.revokeObjectURL(url), 100)
    setShowExportMenu(false)
  }

  const exportAsCSV = () => {
    if (!selectedResults.length) return
    const metadata = buildExportMetadata()
    const escapeCSVCell = (value: string | number | null | undefined) => {
      const str = value === null || value === undefined ? '' : (typeof value === 'object' ? (JSON.stringify(value) ?? '') : String(value))
      return `"${str.replace(/"/g, '""')}"`
    }
    const metaLines = Object.entries(metadata).map(([key, value]) => {
      const str = value === undefined ? '' : (typeof value === 'object' ? (JSON.stringify(value) ?? '') : String(value))
      return `# ${key}: ${str.replace(/"/g, '""').replace(/\r?\n/g, '\\n')}`
    })
    const headers = ['Title', 'URL', 'Description', 'Source', 'Relevance Score']
    const rows = selectedResults.map(r => [
      escapeCSVCell(r.title),
      escapeCSVCell(r.url),
      escapeCSVCell(r.description),
      escapeCSVCell(r.source),
      escapeCSVCell(r.relevanceScore),
    ])
    const csvContent = [...metaLines, headers.join(','), ...rows.map(row => row.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = getExportFilename('csv')
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setTimeout(() => URL.revokeObjectURL(url), 100)
    setShowExportMenu(false)
  }

  const copyToClipboard = async (url: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    try {
      await navigator.clipboard.writeText(url)
      setCopiedUrl(url)
      setTimeout(() => setCopiedUrl(prev => prev === url ? null : prev), 1500)
    } catch {
      try {
        const textArea = document.createElement('textarea')
        textArea.value = url
        textArea.style.position = 'fixed'
        textArea.style.opacity = '0'
        document.body.appendChild(textArea)
        textArea.select()
        document.execCommand('copy')
        document.body.removeChild(textArea)
        setCopiedUrl(url)
        setTimeout(() => setCopiedUrl(prev => prev === url ? null : prev), 1500)
      } catch (fallbackErr) {
        console.error('Fallback copy failed:', fallbackErr)
      }
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div
            key={i}
            className="animate-pulse rounded-xl p-4 space-y-3"
            style={{ background: 'rgba(6,13,20,0.6)', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            <div className="flex gap-2">
              <div className="w-16 h-4 bg-white/10 rounded-full"></div>
              <div className="w-12 h-4 bg-white/10 rounded-full"></div>
            </div>
            <div className="w-3/4 h-4 bg-white/10 rounded"></div>
            <div className="w-1/2 h-3 bg-white/5 rounded"></div>
            <div className="space-y-2 pt-1">
              <div className="w-full h-3 bg-white/5 rounded"></div>
              <div className="w-5/6 h-3 bg-white/5 rounded"></div>
            </div>
            <div className="mt-3 h-px bg-white/5 rounded-full overflow-hidden"></div>
          </div>
        ))}
      </div>
    )
  }

  if (!results.length) {
    return (
      <div role="status" aria-live="polite" className="rounded-xl p-8 text-center" style={{ background: 'rgba(6,13,20,0.6)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <h2 className="font-display text-sm text-white tracking-widest">NO RESULTS FOR “{query}”</h2>
        <p className="mt-3 text-sm text-white/55">Your paid search completed, but nothing matched this query.</p>
        <p className="mt-2 text-xs text-white/40">Try broader keywords, remove a filter, or start a new search.</p>
      </div>
    )
  }

  const summarize = async () => {
    if (summarizing) return
    setSummarizing(true)
    setSummaryError(null)
    setSummary('')

    const snippets = results
      .slice(0, 5)
      .map((r, i) => `${i + 1}. ${r.title} — ${r.url}\n   ${r.description}`)
      .join('\n')

    const prompt =
      `Here are search results for "${query}". ` +
      `Summarize the key findings in 3 concise bullet points. ` +
      `Cite source numbers like [1], [2] when relevant.\n\n${snippets}`

    try {
      const res = await fetch(SERVER_URL('/ai/chat'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      if (!res.ok) throw new Error(`Server error ${res.status}`)

      const isSSE = res.headers.get('content-type')?.includes('text/event-stream')
      if (isSSE && res.body) {
        await consumeSSE(res.body, (delta) => {
          setSummary(prev => prev + delta)
        })
      } else {
        const data = await res.json()
        setSummary(data.content ?? 'No summary returned.')
      }
    } catch (err: any) {
      setSummaryError(err.message || 'Failed to generate summary.')
    } finally {
      setSummarizing(false)
    }
  }

  const safeDiagnostics = results.reduce(
    (acc, r) => {
      const v = validateAndNormalizeUrl(r.url)
      if (!r.isBlocked && v.isValid) acc.safe++
      else acc.blocked++
      return acc
    },
    { safe: 0, blocked: 0 }
  )

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
      {/* Quota error banner */}
      <AnimatePresence>
        {collections?.quotaError && (
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
            <button
              onClick={collections.clearQuotaError}
              className="text-xs text-white/30 hover:text-white transition-colors"
              aria-label="Dismiss quota error"
            >✕</button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 flex-wrap">
          <p className="font-display text-xs text-white/55 tracking-widest" aria-live="polite">
            {results.length} RESULTS · SERPER.DEV · PAID VIA x402
          </p>
          {txHash && (
            <a
              href={explorerTxUrl(txHash)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View transaction on Stellar Expert"
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-mono text-xs text-neon-cyan hover:underline transition-all"
              style={{
                background: 'rgba(0,245,255,0.08)',
                border: '1px solid rgba(0,245,255,0.25)',
              }}
            >
              <span>Tx: {truncateHash(txHash)}</span>
              <ExternalLink className="w-3 h-3 flex-shrink-0" />
            </a>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={saveCurrentSet}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-display text-xs tracking-wider text-white/70 hover:text-neon-green hover:bg-neon-green/10 transition-colors"
            style={{ border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.05)' }}
            aria-label="Save current result set"
          >
            <Save className="w-3 h-3" />
            SAVE
          </button>
          <button
            onClick={() => setShowCompare(!showCompare)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-display text-xs tracking-wider transition-colors ${showCompare ? 'text-neon-cyan bg-neon-cyan/10' : 'text-white/70 hover:text-neon-cyan hover:bg-neon-cyan/10'}`}
            style={{ border: '1px solid rgba(0,245,255,0.3)' }}
            aria-label="Compare saved result sets"
          >
            <ArrowLeftRight className="w-3 h-3" />
            COMPARE
          </button>
          {/* Export Button with Format Selector */}
          <div className="relative" ref={exportMenuRef}>
            <button
              type="button"
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-display text-xs tracking-wider text-white/70 hover:text-neon-cyan hover:bg-neon-cyan/10 transition-colors"
              style={{ border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.05)' }}
              aria-label="Export search results"
              aria-haspopup="menu"
              aria-expanded={showExportMenu}
              aria-controls="export-results-menu"
            >
              <Download className="w-3 h-3" />
              EXPORT
            </button>

            <AnimatePresence>
              {showExportMenu && (
                <motion.div
                  id="export-results-menu"
                  role="menu"
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className="absolute top-full right-0 mt-1 w-48 rounded-lg overflow-hidden z-50"
                  style={{
                    background: 'rgba(6,13,20,0.98)',
                    border: '1px solid rgba(0,245,255,0.2)',
                  }}
                >
                  <button
                    role="menuitem"
                    onClick={exportAsJSON}
                    className="w-full px-3 py-2.5 text-left hover:bg-white/5 transition-colors flex items-center gap-2"
                  >
                    <FileJson className="w-4 h-4 text-neon-cyan" />
                    <div>
                      <div className="text-xs text-white">JSON Format</div>
                      <div className="text-[10px] text-white/55">Structured data export</div>
                    </div>
                  </button>
                  <button
                    role="menuitem"
                    onClick={exportAsCSV}
                    className="w-full px-3 py-2.5 text-left hover:bg-white/5 transition-colors flex items-center gap-2"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-neon-green" />
                    <div>
                      <div className="text-xs text-white">CSV Format</div>
                      <div className="text-[10px] text-white/55">Spreadsheet compatible</div>
                    </div>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button
            onClick={summarize}
            disabled={summarizing}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-display text-xs tracking-wider text-neon-cyan disabled:opacity-40 hover:bg-neon-cyan/10 transition-colors"
            style={{ border: '1px solid rgba(0,245,255,0.3)', background: 'rgba(0,245,255,0.06)' }}
          >
            <Sparkles className="w-3 h-3" />
            {summarizing ? 'SUMMARIZING…' : summary ? 'REGENERATE' : 'SUMMARIZE'}
          </button>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-neon-green" />
            <span className="font-display text-xs text-neon-green/70">LIVE</span>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {(summarizing || summary || summaryError) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="rounded-xl p-4 space-y-2"
            style={{
              background: 'rgba(0,245,255,0.04)',
              border: '1px solid rgba(0,245,255,0.18)',
              backdropFilter: 'blur(8px)',
            }}
          >
            <div className="flex items-center gap-2">
              <Sparkles className="w-3 h-3 text-neon-cyan" />
              <span className="font-display text-xs text-neon-cyan tracking-wider">
                AI SUMMARY · GROQ
              </span>
              {summarizing && (
                <span className="flex items-center gap-1 ml-auto">
                  {reducedMotion ? (
                    [0, 1, 2].map(j => (
                      <div key={j} className="w-1 h-1 rounded-full bg-neon-cyan/60" />
                    ))
                  ) : (
                    [0, 1, 2].map(j => (
                      <motion.div
                        key={j}
                        className="w-1 h-1 rounded-full bg-neon-cyan/60"
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 0.8, repeat: Infinity, delay: j * 0.15 }}
                      />
                    ))
                  )}
                </span>
              )}
            </div>
            {summaryError ? (
              <p className="text-red-300 text-xs">⚠ {summaryError}</p>
            ) : (
              <div className="text-white/70 text-xs leading-relaxed">
                <AiMarkdown content={summary} citationMax={Math.min(5, results.length)} />
                {summarizing && <span className="text-neon-cyan/60">▌</span>}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {showCompare && (
        <div
          className="rounded-xl p-4 space-y-3"
          style={{ background: 'rgba(6,13,20,0.6)', border: '1px solid rgba(0,245,255,0.15)' }}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-display text-xs text-neon-cyan tracking-wider">COMPARE SETS</span>
            <select value={compareAId} onChange={e => setCompareAId(e.target.value)} className="bg-transparent text-xs text-white/70 rounded-md px-2 py-1" style={{ border: '1px solid rgba(255,255,255,0.2)' }} aria-label="First result set">
              <option value="">Select set A</option>
              {savedSets.map(s => (
                <option key={s.id} value={s.id} className="bg-[#060d14]">{s.label}</option>
              ))}
            </select>
            <span className="text-white/30 text-xs">vs</span>
            <select value={compareBId} onChange={e => setCompareBId(e.target.value)} className="bg-transparent text-xs text-white/70 rounded-md px-2 py-1" style={{ border: '1px solid rgba(255,255,255,0.2)' }} aria-label="Second result set">
              <option value="">Select set B</option>
              {savedSets.map(s => (
                <option key={s.id} value={s.id} className="bg-[#060d14]">{s.label}</option>
              ))}
            </select>
          </div>
          {comparisonRows.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {renderCompareRows('A')}
              {renderCompareRows('B')}
            </div>
          ) : (
            <p className="text-white/40 text-xs">Select two saved result sets to compare by canonical URL.</p>
          )}
        </div>
      )}

      {!showCompare && results.map((r, i) => (
        <motion.a
          key={r.id}
          id={i < 5 ? `result-card-${i + 1}` : undefined}
          tabIndex={-1}
          href={r.url}
          target="_blank"
          rel="noopener noreferrer"
          role="article"
          aria-label={r.title}
          initial={{ opacity: reducedMotion ? 1 : 0, y: reducedMotion ? 0 : 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.06 }}
          className="block group rounded-xl p-4 hover:border-neon-cyan/25 transition-all relative focus:outline-none focus:ring-2 focus:ring-neon-cyan/60"
          style={{
            background: 'rgba(6,13,20,0.6)',
            border: '1px solid rgba(255,255,255,0.06)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div className="flex items-start justify-between gap-3 flex-col sm:flex-row">
            <div className="flex-1 min-w-0 w-full">
              {/* Source + score + date */}
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <input
                  type="checkbox"
                  checked={isSelected(r.id)}
                  onChange={() => toggleOne(r.id)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Select result: ${r.title}`}
                  className="w-3.5 h-3.5 rounded-sm cursor-pointer flex-shrink-0"
                  style={{ accentColor: '#00f5ff' }}
                />
                <span
                  className="inline-flex items-center py-0.5 px-2 rounded-full font-display border"
                  style={{
                    background: 'rgba(0,245,255,0.08)',
                    borderColor: 'rgba(0,245,255,0.2)',
                    color: '#00f5ff',
                    fontSize: '10px',
                  }}
                >
                  {r.source}
                </span>
                <div className="flex items-center gap-1 text-neon-amber/60">
                  <Star className="w-3 h-3 fill-current" />
                  <span className="font-display text-xs">
                    {(r.relevanceScore * 100).toFixed(0)}%
                  </span>
                </div>
                {r.publishedAt && (
                  <div className="flex items-center gap-1 text-white/50">
                    <Clock className="w-3 h-3" />
                    <span className="font-display text-xs">{r.publishedAt}</span>
                  </div>
                )}
              </div>

              <h3 className={`font-medium text-sm leading-snug mb-1 transition-colors ${isRowBlocked ? 'text-white/60' : 'text-white group-hover:text-neon-cyan'}`}>
                {r.title}
              </h3>

              <div className="flex items-center gap-2 mb-2">
                <p className="font-mono text-xs truncate" style={{ color: 'rgba(0,245,255,0.35)' }}>
                  {r.url || 'No link available'}
                </p>
                {/* Copy URL button */}
                <button
                  onClick={(e) => copyToClipboard(r.url, e)}
                  className="relative flex-shrink-0 min-w-11 min-h-11 w-11 h-11 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:bg-white/10"
                  style={{
                    border: copiedUrl === r.url ? '1px solid rgba(0,255,0,0.3)' : '1px solid rgba(255,255,255,0.1)',
                    color: copiedUrl === r.url ? '#00ff00' : 'rgba(255,255,255,0.55)',
                  }}
                  aria-label="Copy URL to clipboard"
                  title="Copy URL"
                >
                  {copiedUrl === r.url ? (
                    <Check className="w-3 h-3" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  
                  <AnimatePresence>
                    {copiedUrl === r.url && (
                      <motion.div
                        initial={{ opacity: reducedMotion ? 1 : 0, y: reducedMotion ? 0 : 5, scale: reducedMotion ? 1 : 0.8 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: reducedMotion ? 1 : 0, y: reducedMotion ? 0 : 5, scale: reducedMotion ? 1 : 0.8 }}
                        transition={reducedMotion ? { duration: 0 } : { type: 'spring', bounce: 0.3, duration: 0.2 }}
                        className="absolute -top-8 left-1/2 transform -translate-x-1/2 px-2 py-1 rounded-md text-[10px] font-medium whitespace-nowrap pointer-events-none"
                        style={{
                          background: 'rgba(0,0,0,0.9)',
                          border: '1px solid rgba(0,255,0,0.3)',
                          color: '#00ff00',
                        }}
                      >
                        Copied!
                      </motion.div>
                    )}
                    
                    {/* Tooltip */}
                    <AnimatePresence>
                      {copiedUrl === r.url && (
                        <motion.div
                          initial={{ opacity: 0, y: 5, scale: 0.8 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 5, scale: 0.8 }}
                          className="absolute -top-8 left-1/2 transform -translate-x-1/2 px-2 py-1 rounded-md text-[10px] font-medium whitespace-nowrap pointer-events-none"
                          style={{
                            background: 'rgba(0,0,0,0.9)',
                            border: '1px solid rgba(0,255,0,0.3)',
                            color: '#00ff00',
                          }}
                        >
                          Copied!
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </button>
                )}
              </div>

              <p className="text-white/55 text-xs leading-relaxed line-clamp-2">
                {r.description}
              </p>

              {/* Sitelinks — rendered as span[role=link] to avoid nested <a> */}
              {r.sitelinks && r.sitelinks.length > 0 && (
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2" role="list" aria-label="Sitelinks">
                  {r.sitelinks.map((sl) => (
                    <span
                      key={sl.url}
                      role="listitem"
                    >
                      <span
                        role="link"
                        tabIndex={0}
                        aria-label={`Sitelink: ${sl.title}`}
                        className="font-display text-[10px] text-neon-cyan/60 hover:text-neon-cyan underline underline-offset-2 cursor-pointer transition-colors"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(sl.url, '_blank', 'noopener,noreferrer') }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); window.open(sl.url, '_blank', 'noopener,noreferrer') } }}
                      >
                        {sl.title}
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Right-side actions */}
            <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
              {/* Save-to-collection button (only when collections prop is provided) */}
              {collections && (
                <SaveButton
                  result={r}
                  query={query}
                  txHash={txHash}
                  network={network}
                  collections={collections}
                />
              )}

              {/* External link icon */}
              <div className="w-7 h-7 rounded-lg flex items-center justify-center border border-white/8 text-white/25 group-hover:text-neon-cyan group-hover:border-neon-cyan/30 transition-all">
                <ExternalLink className="w-3.5 h-3.5" />
              </div>
            </div>
          </div>
        )

        const cardStyle = {
          background: isRowBlocked ? 'rgba(15,8,12,0.6)' : 'rgba(6,13,20,0.6)',
          border: isRowBlocked ? '1px solid rgba(239,68,68,0.2)' : '1px solid rgba(255,255,255,0.06)',
          backdropFilter: 'blur(8px)',
        }

        if (isRowBlocked) {
          return (
            <motion.div
              key={r.id}
              role="article"
              aria-label={r.title}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="block rounded-xl p-4 relative"
              style={cardStyle}
            >
              {content}
              <div className="mt-3 h-px bg-white/5 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${r.relevanceScore * 100}%` }}
                  transition={{ delay: i * 0.06 + 0.3, duration: 0.5, ease: 'easeOut' }}
                  className="h-full rounded-full"
                  style={{ background: 'linear-gradient(90deg, rgba(239,68,68,0.5), rgba(239,68,68,0.1))' }}
                />
              </div>
            </motion.div>
          )
        }

        return (
          <motion.a
            key={r.id}
            href={safeUrl}
            target="_blank"
            rel="noopener noreferrer"
            role="article"
            aria-label={r.title}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className="block group rounded-xl p-4 hover:border-neon-cyan/25 transition-all relative"
            style={cardStyle}
          >
            {content}
            <div className="mt-3 h-px bg-white/5 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${r.relevanceScore * 100}%` }}
                transition={{ delay: i * 0.06 + 0.3, duration: 0.5, ease: 'easeOut' }}
                className="h-full rounded-full"
                style={{ background: 'linear-gradient(90deg, rgba(0,245,255,0.6), rgba(0,245,255,0.15))' }}
              />
            </div>
          </motion.a>
        )
      })}
    </motion.div>
  )
}
