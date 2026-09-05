/**
 * ResearchWorkflowPanel
 *
 * Lets the user:
 *   1. Select which result sources to include in the report
 *   2. Choose a report format (bullets / narrative / table / comparison)
 *   3. Generate the AI research report via /ai/chat
 *
 * The generated report retains a per-source status map (used / omitted / failed)
 * and exposes the omitted/failed lists to the parent if needed.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sparkles,
  CheckSquare,
  Square,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  List,
  AlignLeft,
  Table2,
  GitCompare,
} from 'lucide-react'
import { AiMarkdown } from '../ai/AiMarkdown'
import type { SearchResult } from '../../hooks/useSearch'
import type { ReportFormat, ResearchReport, SourceStatus } from '../../types/index'
import { buildResearchPrompt } from '../../lib/aiChatService'

// ─── Constants ──────────────────────────────────────────────────────────────

const SERVER_URL = (import.meta as any).env?.VITE_SERVER_URL ?? (
  typeof window !== 'undefined' && window.location.origin.includes('vercel.app')
    ? `${window.location.origin}/api`
    : 'http://localhost:3001'
)

const FORMAT_OPTIONS: { value: ReportFormat; label: string; description: string; icon: React.ComponentType<{ className?: string }> }[] = [
  {
    value: 'bullets',
    label: 'BULLET POINTS',
    description: 'Concise key findings with citations',
    icon: List,
  },
  {
    value: 'narrative',
    label: 'NARRATIVE',
    description: 'Flowing prose with inline citations',
    icon: AlignLeft,
  },
  {
    value: 'table',
    label: 'TABLE',
    description: 'Markdown table: source | claim | detail',
    icon: Table2,
  },
  {
    value: 'comparison',
    label: 'COMPARISON',
    description: 'Side-by-side contrast of sources',
    icon: GitCompare,
  },
]

// ─── Props ──────────────────────────────────────────────────────────────────

interface Props {
  results: SearchResult[]
  query: string
  /** Called when a citation [N] is clicked so the parent can scroll to the card. */
  onCitationClick?: (index: number) => void
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ResearchWorkflowPanel({ results, query, onCitationClick }: Props) {
  // ── source selection ───────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(results.map((r) => r.id)))

  // ── format ────────────────────────────────────────────────────────────
  const [format, setFormat] = useState<ReportFormat>('bullets')

  // ── report state ──────────────────────────────────────────────────────
  const [report, setReport]         = useState<ResearchReport | null>(null)
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError]     = useState<string | null>(null)

  // ── UI state ──────────────────────────────────────────────────────────
  const [sourcesExpanded, setSourcesExpanded] = useState(true)

  // Reset everything when query or results change
  useEffect(() => {
    setSelectedIds(new Set(results.map((r) => r.id)))
    setReport(null)
    setGenError(null)
    setGenerating(false)
    setSourcesExpanded(true)
  }, [query, results])

  // ── selection helpers ─────────────────────────────────────────────────
  const toggleSource = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(results.map((r) => r.id)))
  }, [results])

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const allSelected  = selectedIds.size === results.length
  const noneSelected = selectedIds.size === 0

  // ── report generation ─────────────────────────────────────────────────
  const abortRef = useRef<AbortController | null>(null)

  const generate = useCallback(async () => {
    if (generating || noneSelected) return

    // Cancel any previous in-flight request
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setGenerating(true)
    setGenError(null)
    setReport(null)

    const selectedSources = results
      .filter((r) => selectedIds.has(r.id))
      .map((r) => ({
        id: r.id,
        title: r.title,
        url: r.url,
        description: r.description,
      }))

    const allIds = results.map((r) => r.id)
    const { prompt, omittedIds } = buildResearchPrompt(query, selectedSources, format, allIds)

    // Build source status list for the report metadata
    const buildSourceStatuses = (failedIds: string[]): SourceStatus[] => {
      const failedSet = new Set(failedIds)
      return results.map((r) => ({
        id: r.id,
        title: r.title,
        url: r.url,
        status: omittedIds.includes(r.id)
          ? 'omitted'
          : failedSet.has(r.id)
          ? 'failed'
          : 'used',
      }))
    }

    let content = ''

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
                const { content: chunk } = JSON.parse(data) as { content?: string }
                if (chunk) {
                  content += chunk
                  // Update report content progressively so the user sees streaming output
                  setReport({
                    format,
                    sources: buildSourceStatuses([]),
                    content,
                    omitted: omittedIds,
                    failed: [],
                  })
                }
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
        content = data.content ?? 'No report returned.'
      }

      setReport({
        format,
        sources: buildSourceStatuses([]),
        content,
        omitted: omittedIds,
        failed: [],
      })
      // Collapse source list once report is shown
      setSourcesExpanded(false)
    } catch (err: any) {
      if (err.name === 'AbortError') return
      setGenError(err.message || 'Failed to generate report.')
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
      }
      setGenerating(false)
    }
  }, [generating, noneSelected, results, selectedIds, format, query])

  // Clean up abort controller on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort() }
  }, [])

  // ── render ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* ── Source Selection ── */}
      <div
        className="rounded-xl overflow-hidden"
        style={{
          background: 'rgba(6,13,20,0.7)',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        {/* Header row */}
        <button
          type="button"
          onClick={() => setSourcesExpanded((v) => !v)}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-white/3 transition-colors"
          aria-expanded={sourcesExpanded}
          aria-controls="research-sources-list"
        >
          <div className="flex items-center gap-2">
            <CheckSquare className="w-3.5 h-3.5 text-neon-cyan/70" />
            <span className="font-display text-xs text-white/60 tracking-wider">
              SOURCES
            </span>
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded-full font-display text-xs"
              style={{
                background: noneSelected ? 'rgba(255,100,100,0.15)' : 'rgba(0,245,255,0.12)',
                color: noneSelected ? '#ff6464' : '#00f5ff',
                border: `1px solid ${noneSelected ? 'rgba(255,100,100,0.3)' : 'rgba(0,245,255,0.25)'}`,
                fontSize: '10px',
              }}
            >
              {selectedIds.size}/{results.length} selected
            </span>
          </div>
          <div className="flex items-center gap-3">
            {sourcesExpanded && (
              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={selectAll}
                  disabled={allSelected}
                  className="font-display text-xs text-white/30 hover:text-neon-cyan disabled:opacity-30 transition-colors"
                  aria-label="Select all sources"
                >
                  ALL
                </button>
                <span className="text-white/15">·</span>
                <button
                  type="button"
                  onClick={deselectAll}
                  disabled={noneSelected}
                  className="font-display text-xs text-white/30 hover:text-red-400 disabled:opacity-30 transition-colors"
                  aria-label="Deselect all sources"
                >
                  NONE
                </button>
              </div>
            )}
            {sourcesExpanded
              ? <ChevronUp className="w-3.5 h-3.5 text-white/30" />
              : <ChevronDown className="w-3.5 h-3.5 text-white/30" />
            }
          </div>
        </button>

        {/* Source list */}
        <AnimatePresence initial={false}>
          {sourcesExpanded && (
            <motion.div
              id="research-sources-list"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-3 space-y-1.5" role="group" aria-label="Source selection">
                {results.map((result, idx) => {
                  const checked = selectedIds.has(result.id)
                  return (
                    <label
                      key={result.id}
                      className="flex items-start gap-2.5 cursor-pointer group rounded-lg px-2 py-1.5 transition-colors hover:bg-white/4"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSource(result.id)}
                        className="sr-only"
                        aria-label={`Include source: ${result.title}`}
                      />
                      <span className="mt-0.5 flex-shrink-0" aria-hidden="true">
                        {checked
                          ? <CheckSquare className="w-3.5 h-3.5 text-neon-cyan" />
                          : <Square className="w-3.5 h-3.5 text-white/20 group-hover:text-white/40 transition-colors" />
                        }
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="font-display flex-shrink-0"
                            style={{ fontSize: '10px', color: 'rgba(0,245,255,0.45)' }}
                          >
                            [{idx + 1}]
                          </span>
                          <span
                            className="text-xs leading-snug truncate"
                            style={{ color: checked ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.3)' }}
                          >
                            {result.title}
                          </span>
                        </div>
                        <p
                          className="font-mono truncate mt-0.5"
                          style={{ fontSize: '10px', color: 'rgba(0,245,255,0.25)' }}
                        >
                          {result.url}
                        </p>
                      </div>
                    </label>
                  )
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Format Selector ── */}
      <div
        className="rounded-xl p-3 space-y-2"
        style={{
          background: 'rgba(6,13,20,0.7)',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <p className="font-display text-xs text-white/40 tracking-wider px-1">REPORT FORMAT</p>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Report format">
          {FORMAT_OPTIONS.map(({ value, label, description, icon: Icon }) => {
            const selected = format === value
            return (
              <label
                key={value}
                className="flex items-start gap-2 cursor-pointer rounded-lg p-2.5 transition-all"
                style={{
                  background: selected ? 'rgba(0,245,255,0.08)' : 'rgba(255,255,255,0.02)',
                  border: selected ? '1px solid rgba(0,245,255,0.35)' : '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <input
                  type="radio"
                  name="report-format"
                  value={value}
                  checked={selected}
                  onChange={() => setFormat(value)}
                  className="sr-only"
                  aria-label={label}
                />
                <Icon
                  className="w-3.5 h-3.5 mt-0.5 flex-shrink-0"
                  style={{ color: selected ? '#00f5ff' : 'rgba(255,255,255,0.25)' }}
                />
                <div>
                  <p
                    className="font-display"
                    style={{ fontSize: '10px', color: selected ? '#00f5ff' : 'rgba(255,255,255,0.45)', letterSpacing: '0.06em' }}
                  >
                    {label}
                  </p>
                  <p className="text-xs leading-snug mt-0.5" style={{ color: 'rgba(255,255,255,0.25)' }}>
                    {description}
                  </p>
                </div>
              </label>
            )
          })}
        </div>
      </div>

      {/* ── Generate Button ── */}
      <button
        type="button"
        onClick={generate}
        disabled={generating || noneSelected}
        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-display text-xs tracking-wider transition-all disabled:opacity-40"
        style={{
          background: 'rgba(0,245,255,0.08)',
          border: '1px solid rgba(0,245,255,0.35)',
          color: '#00f5ff',
          boxShadow: generating ? '0 0 12px rgba(0,245,255,0.15)' : 'none',
        }}
        aria-busy={generating}
        aria-label={
          noneSelected
            ? 'Select at least one source to generate a report'
            : generating
            ? 'Generating report…'
            : 'Generate research report'
        }
      >
        <Sparkles className="w-3.5 h-3.5" />
        {generating
          ? 'GENERATING REPORT…'
          : report
          ? 'REGENERATE REPORT'
          : 'GENERATE REPORT'
        }
      </button>

      {noneSelected && !generating && (
        <p className="text-center font-display text-xs text-red-400/70 tracking-wider" role="alert">
          Select at least one source to generate a report.
        </p>
      )}

      {/* ── Error ── */}
      <AnimatePresence>
        {genError && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-start gap-2 p-3 rounded-xl border border-red-500/25 bg-red-500/5"
            role="alert"
          >
            <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-300">⚠ {genError}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Report Output ── */}
      <AnimatePresence>
        {report && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="rounded-xl overflow-hidden"
            style={{
              background: 'rgba(0,245,255,0.03)',
              border: '1px solid rgba(0,245,255,0.18)',
              backdropFilter: 'blur(8px)',
            }}
          >
            {/* Report header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-neon-cyan/10">
              <Sparkles className="w-3 h-3 text-neon-cyan" />
              <span className="font-display text-xs text-neon-cyan tracking-wider">
                RESEARCH REPORT · GROQ · {report.format.toUpperCase()}
              </span>
              {generating && (
                <span className="flex items-center gap-1 ml-auto" aria-label="Streaming…">
                  {[0, 1, 2].map((j) => (
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

            {/* Report body */}
            <div className="px-4 py-3">
              <div className="text-white/75 text-xs leading-relaxed">
                <AiMarkdown
                  content={report.content}
                  citationMax={results.length}
                  onCitationClick={onCitationClick}
                />
                {generating && <span className="text-neon-cyan/60 ml-px">▌</span>}
              </div>
            </div>

            {/* Source status footer */}
            {!generating && (report.omitted.length > 0 || report.failed.length > 0) && (
              <div
                className="px-4 py-2.5 border-t border-white/5 space-y-1"
                aria-label="Source status"
              >
                {report.omitted.length > 0 && (
                  <p className="font-display text-xs text-white/25 tracking-wider">
                    OMITTED:{' '}
                    {report.omitted
                      .map((id) => {
                        const idx = results.findIndex((r) => r.id === id)
                        return idx !== -1 ? `[${idx + 1}]` : id
                      })
                      .join(', ')}
                    {' '}(deselected by you)
                  </p>
                )}
                {report.failed.length > 0 && (
                  <p className="font-display text-xs text-red-400/50 tracking-wider">
                    FAILED:{' '}
                    {report.failed
                      .map((id) => {
                        const idx = results.findIndex((r) => r.id === id)
                        return idx !== -1 ? `[${idx + 1}]` : id
                      })
                      .join(', ')}
                    {' '}(could not be processed)
                  </p>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
