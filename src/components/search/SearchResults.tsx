import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ExternalLink, Star, Clock, Sparkles, Search, FlaskConical } from 'lucide-react'
import type { SearchResult } from '../../hooks/useSearch'
import { ResearchWorkflowPanel } from './ResearchWorkflowPanel'

interface Props {
  results: SearchResult[]
  query: string
  isLoading?: boolean
}

const SERVER_URL = (import.meta as any).env?.VITE_SERVER_URL ?? (
  typeof window !== 'undefined' && window.location.origin.includes('vercel.app')
    ? `${window.location.origin}/api`
    : 'http://localhost:3001'
)

/** Tracks which AI panel mode is currently visible */
type AiMode = 'none' | 'summarize' | 'research'

export function SearchResults({ results, query, isLoading }: Props) {
  // Legacy quick-summarize state
  const [summary, setSummary]               = useState<string>('')
  const [summaryError, setSummaryError]     = useState<string | null>(null)
  const [summarizing, setSummarizing]       = useState(false)

  // Which AI panel is visible
  const [aiMode, setAiMode] = useState<AiMode>('none')

  // Reset all AI state when query or results change (issue #95)
  useEffect(() => {
    setSummary('')
    setSummaryError(null)
    setSummarizing(false)
    setAiMode('none')
  }, [query, results])

  // Abort controller for legacy summarize
  const summarizeAbortRef = useRef<AbortController | null>(null)
  useEffect(() => {
    return () => { summarizeAbortRef.current?.abort() }
  }, [])

  // ── Loading skeleton ────────────────────────────────────────────────
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

  // ── Legacy summarize (quick, first-5) ───────────────────────────────
  const summarize = async () => {
    if (summarizing) return
    summarizeAbortRef.current?.abort()
    const controller = new AbortController()
    summarizeAbortRef.current = controller

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
        signal: controller.signal,
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
      if (err.name === 'AbortError') return
      setSummaryError(err.message || 'Failed to generate summary.')
    } finally {
      setSummarizing(false)
    }
  }

  // ── Panel toggles ────────────────────────────────────────────────────
  const openSummarize = () => {
    setAiMode((prev) => {
      if (prev !== 'summarize') return 'summarize'
      return 'none'
    })
    if (aiMode === 'none' || aiMode === 'research') {
      // Auto-trigger summarize when switching into summarize mode
    }
  }

  const handleSummarizeClick = () => {
    if (aiMode === 'summarize') {
      // Already open — allow re-generation
      summarize()
    } else {
      setAiMode('summarize')
      // Kick off summarize after opening panel
      setTimeout(summarize, 0)
    }
  }

  const handleResearchClick = () => {
    setAiMode((prev) => (prev === 'research' ? 'none' : 'research'))
  }

  // Scroll to a result card by 1-based citation index
  const handleCitationClick = (index: number) => {
    if (typeof document === 'undefined') return
    const el = document.getElementById(`result-card-${index}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      (el as HTMLElement).focus({ preventScroll: true })
    }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p
          className="font-display text-xs text-white/35 tracking-widest"
          aria-live="polite"
        >
          {results.length} RESULTS · SERPER.DEV · PAID VIA x402
        </p>
        <div className="flex items-center gap-2">
          {/* Quick-summarize button */}
          <button
            onClick={handleSummarizeClick}
            disabled={summarizing}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-display text-xs tracking-wider text-neon-cyan disabled:opacity-40 hover:bg-neon-cyan/10 transition-colors"
            style={{ border: '1px solid rgba(0,245,255,0.3)', background: aiMode === 'summarize' ? 'rgba(0,245,255,0.1)' : 'rgba(0,245,255,0.06)' }}
            aria-pressed={aiMode === 'summarize'}
            aria-label={summarizing ? 'Summarizing…' : 'Quick AI summary'}
          >
            <Sparkles className="w-3 h-3" />
            {summarizing ? 'SUMMARIZING…' : summary && aiMode === 'summarize' ? 'REGENERATE' : 'SUMMARIZE'}
          </button>

          {/* Research workflow button */}
          <button
            onClick={handleResearchClick}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-display text-xs tracking-wider disabled:opacity-40 hover:bg-neon-amber/10 transition-colors"
            style={{
              border: '1px solid rgba(255,190,0,0.3)',
              background: aiMode === 'research' ? 'rgba(255,190,0,0.1)' : 'rgba(255,190,0,0.06)',
              color: '#ffbe00',
            }}
            aria-pressed={aiMode === 'research'}
            aria-label="Research report — select sources and format"
          >
            <FlaskConical className="w-3 h-3" />
            RESEARCH
          </button>

          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-neon-green" />
            <span className="font-display text-xs text-neon-green/70">LIVE</span>
          </div>
        </div>
      </div>

      {/* ── Quick-summary panel ── */}
      <AnimatePresence>
        {aiMode === 'summarize' && (summarizing || summary || summaryError) && (
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

      {/* ── Research workflow panel ── */}
      <AnimatePresence>
        {aiMode === 'research' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <ResearchWorkflowPanel
              results={results}
              query={query}
              onCitationClick={handleCitationClick}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Result cards ── */}
      {results.map((r, i) => (
        <motion.a
          key={r.id}
          id={`result-card-${i + 1}`}
          tabIndex={-1}
          href={r.url}
          target="_blank"
          rel="noopener noreferrer"
          role="article"
          aria-label={r.title}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.06 }}
          className="block group rounded-xl p-4 hover:border-neon-cyan/25 transition-all"
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

              <h3 className="text-white font-medium text-sm leading-snug mb-1 group-hover:text-neon-cyan transition-colors">
                {r.title}
              </h3>

              <p className="font-mono text-xs mb-2 truncate" style={{ color: 'rgba(0,245,255,0.35)' }}>
                {r.url}
              </p>

              <p className="text-white/45 text-xs leading-relaxed line-clamp-2">
                {r.description}
              </p>
            </div>

            <div className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center border border-white/8 text-white/25 group-hover:text-neon-cyan group-hover:border-neon-cyan/30 transition-all mt-0.5">
              <ExternalLink className="w-3.5 h-3.5" />
            </div>
          </div>

          {/* Relevance bar */}
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
