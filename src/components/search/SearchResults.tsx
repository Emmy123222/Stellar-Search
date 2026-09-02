import { readBrowserConfig } from '../../lib/config'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ExternalLink, Star, Clock, Sparkles, Download, FileJson, FileSpreadsheet, Check, Copy, Bookmark } from 'lucide-react'
import type { SearchResult } from '../../hooks/useSearch'
import { useSavedResearch } from '../../hooks/useSavedResearch'
import { explorerTxUrl, truncateHash } from '../../lib/stellar'

interface Props {
  results: SearchResult[]
  query: string
  isLoading?: boolean
  txHash?: string | null
}

const SERVER_URL = readBrowserConfig().apiBaseUrl

export function SearchResults({ results, query, isLoading, txHash }: Props) {
  const [summary, setSummary]               = useState<string>('')
  const [summaryError, setSummaryError]     = useState<string | null>(null)
  const [summarizing, setSummarizing]       = useState(false)
  const [copiedUrl, setCopiedUrl]           = useState<string | null>(null)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const { isSaved, toggle: toggleSaved }    = useSavedResearch()

  const exportAsJSON = () => {
    if (!results.length) return
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `search-results-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
    setShowExportMenu(false)
  }

  const exportAsCSV = () => {
    if (!results.length) return
    const headers = ['Title', 'URL', 'Description', 'Source', 'Relevance Score']
    const rows = results.map(r => [
      `"${r.title.replace(/"/g, '""')}"`,
      `"${r.url.replace(/"/g, '""')}"`,
      `"${r.description.replace(/"/g, '""')}"`,
      `"${r.source.replace(/"/g, '""')}"`,
      r.relevanceScore
    ])
    const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `search-results-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
    setShowExportMenu(false)
  }

  const copyToClipboard = async (url: string, e: React.MouseEvent) => {
    // Prevent the anchor tag from navigating when clicking copy button
    e.preventDefault()
    e.stopPropagation()
    
    try {
      await navigator.clipboard.writeText(url)
      setCopiedUrl(url)
      
      // Reset copied state after 1.5 seconds
      setTimeout(() => {
        setCopiedUrl(prev => prev === url ? null : prev)
      }, 1500)
    } catch (err) {
      console.error('Failed to copy:', err)
      
      // Fallback for older browsers
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
        setTimeout(() => {
          setCopiedUrl(prev => prev === url ? null : prev)
        }, 1500)
      } catch (fallbackErr) {
        console.error('Fallback copy failed:', fallbackErr)
      }
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse rounded-xl p-4 space-y-3" style={{ background: 'rgba(6,13,20,0.6)', border: '1px solid rgba(255,255,255,0.06)' }}>
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

  if (!results.length) return null

  const summarize = async () => {
    if (summarizing) return
    setSummarizing(true)
    setSummaryError(null)
    setSummary('')

    const snippets = results.slice(0, 5).map((r, i) =>
      `${i + 1}. ${r.title} — ${r.url}\n   ${r.description}`
    ).join('\n')

    const prompt =
      `Here are search results for "${query}". ` +
      `Summarize the key findings in 3 concise bullet points. ` +
      `Cite source numbers like [1], [2] when relevant.\n\n${snippets}`

    try {
      const res = await fetch(`${SERVER_URL}/ai/chat`, {
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
        const reader  = res.body.getReader()
        const decoder = new TextDecoder('utf-8')
        let   buffer  = ''
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let blank: number
          while ((blank = buffer.indexOf('\n\n')) !== -1) {
            const raw = buffer.slice(0, blank)
            buffer = buffer.slice(blank + 2)
            let event = 'message'
            let data  = ''
            for (const line of raw.split('\n')) {
              if (line.startsWith('event:')) event = line.slice(6).trim()
              else if (line.startsWith('data:')) data += line.slice(5).trim()
            }
            if (!data) continue
            if (event === 'delta') {
              try {
                const { content } = JSON.parse(data) as { content?: string }
                if (content) setSummary(prev => prev + content)
              } catch { /* skip malformed */ }
            } else if (event === 'done') {
              break
            } else if (event === 'error') {
              try {
                const { error } = JSON.parse(data) as { error?: string }
                throw new Error(error || 'stream error')
              } catch (e) {
                throw e instanceof Error ? e : new Error('stream error')
              }
            }
          }
        }
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

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 flex-wrap">
          <p className="font-display text-xs text-white/35 tracking-widest" aria-live="polite">
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
          {/* Export Button with Format Selector */}
          <div className="relative">
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-display text-xs tracking-wider text-white/70 hover:text-neon-cyan hover:bg-neon-cyan/10 transition-colors"
              style={{ border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.05)' }}
              aria-label="Export search results"
            >
              <Download className="w-3 h-3" />
              EXPORT
            </button>

            {/* Export Format Dropdown */}
            <AnimatePresence>
              {showExportMenu && (
                <motion.div
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
                    onClick={exportAsJSON}
                    className="w-full px-3 py-2.5 text-left hover:bg-white/5 transition-colors flex items-center gap-2"
                  >
                    <FileJson className="w-4 h-4 text-neon-cyan" />
                    <div>
                      <div className="text-xs text-white">JSON Format</div>
                      <div className="text-[10px] text-white/40">Structured data export</div>
                    </div>
                  </button>
                  <button
                    onClick={exportAsCSV}
                    className="w-full px-3 py-2.5 text-left hover:bg-white/5 transition-colors flex items-center gap-2"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-neon-green" />
                    <div>
                      <div className="text-xs text-white">CSV Format</div>
                      <div className="text-[10px] text-white/40">Spreadsheet compatible</div>
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
              <span className="font-display text-xs text-neon-cyan tracking-wider">AI SUMMARY · GROQ</span>
              {summarizing && (
                <span className="flex items-center gap-1 ml-auto">
                  {[0, 1, 2].map(j => (
                    <motion.div
                      key={j}
                      className="w-1 h-1 rounded-full bg-neon-cyan/60"
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 0.8, repeat: Infinity, delay: j * 0.15 }}
                    />
                  ))}
                </span>
              )}
            </div>
            {summaryError ? (
              <p className="text-red-300 text-xs">⚠ {summaryError}</p>
            ) : (
              <p className="text-white/70 text-xs leading-relaxed whitespace-pre-wrap">
                {summary}
                {summarizing && <span className="text-neon-cyan/60">▌</span>}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {results.map((r, i) => (
        <motion.a
          key={r.id}
          href={r.url}
          target="_blank"
          rel="noopener noreferrer"
          role="article"
          aria-label={r.title}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.06 }}
          className="block group rounded-xl p-4 hover:border-neon-cyan/25 transition-all relative"
          style={{
            background: 'rgba(6,13,20,0.6)',
            border: '1px solid rgba(255,255,255,0.06)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div className="flex items-start justify-between gap-3 flex-col sm:flex-row">
            <div className="flex-1 min-w-0 w-full">
              {/* Source + score */}
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
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
                  <span className="font-display text-xs">{(r.relevanceScore * 100).toFixed(0)}%</span>
                </div>
                {r.publishedAt && (
                  <div className="flex items-center gap-1 text-white/25">
                    <Clock className="w-3 h-3" />
                    <span className="font-display text-xs">{r.publishedAt}</span>
                  </div>
                )}
              </div>

              <div className="flex items-start justify-between gap-2 mb-1">
                <h3 className="text-white font-medium text-sm leading-snug group-hover:text-neon-cyan transition-colors">
                  {r.title}
                </h3>
                {/* Save to research button — bookmarks this result with editable notes/tags (#305) */}
                <button
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    toggleSaved(r, query)
                  }}
                  className="relative flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center transition-all hover:bg-white/10"
                  style={{
                    border: isSaved(query, r.id) ? '1px solid rgba(255,184,0,0.4)' : '1px solid rgba(255,255,255,0.1)',
                    color: isSaved(query, r.id) ? '#ffb800' : 'rgba(255,255,255,0.4)',
                  }}
                  aria-label={isSaved(query, r.id) ? 'Remove from saved research' : 'Save to research'}
                  aria-pressed={isSaved(query, r.id)}
                  title={isSaved(query, r.id) ? 'Saved — click to remove' : 'Save to research'}
                >
                  <Bookmark className="w-3 h-3" fill={isSaved(query, r.id) ? 'currentColor' : 'none'} />
                </button>
              </div>

              <div className="flex items-center gap-2 mb-2">
                <p className="font-mono text-xs truncate" style={{ color: 'rgba(0,245,255,0.35)' }}>
                  {r.url}
                </p>
                {/* Copy button */}
                <button
                  onClick={(e) => copyToClipboard(r.url, e)}
                  className="relative flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:bg-white/10"
                  style={{
                    border: copiedUrl === r.url ? '1px solid rgba(0,255,0,0.3)' : '1px solid rgba(255,255,255,0.1)',
                    color: copiedUrl === r.url ? '#00ff00' : 'rgba(255,255,255,0.4)',
                  }}
                  aria-label="Copy URL to clipboard"
                  title="Copy URL"
                >
                  {copiedUrl === r.url ? (
                    <Check className="w-3 h-3" />
                  ) : (
                    <Copy className="w-3 h-3" />
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
              </div>

              <p className="text-white/45 text-xs leading-relaxed line-clamp-2">
                {r.description}
              </p>
            </div>

            <div className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center border border-white/8 text-white/25 group-hover:text-neon-cyan group-hover:border-neon-cyan/30 transition-all mt-0.5">
              <ExternalLink className="w-3.5 h-3.5" />
            </div>
          </div>

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
      ))}
    </motion.div>
  )
}