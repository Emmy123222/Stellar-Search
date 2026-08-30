/**
 * Shared timing vocabulary — used by server, Vercel, browser, and MCP.
 * Each phase records durationMs and outcome. Health/metrics expose percentiles.
 */

export const TIMING_PHASES = {
  TOTAL: 'total',
  VALIDATION: 'validation',
  SERPER: 'serper',
  GROQ: 'groq',
  GROQ_SUGGESTIONS: 'groq_suggestions',
  FACILITATOR: 'facilitator',
  HORIZON: 'horizon',
  X402: 'x402',
  WALLET_SIGN: 'wallet_sign',
  BROWSER_FETCH: 'browser_fetch',
  AI_CHAT: 'ai_chat',
} as const

export type TimingPhase = typeof TIMING_PHASES[keyof typeof TIMING_PHASES]

export type TimingOutcome = 'success' | 'error' | 'timeout' | 'cached' | 'not_configured'

export interface PhaseEvent {
  phase: TimingPhase
  durationMs: number
  outcome: TimingOutcome
  timestamp: number
}

export interface PhaseStats {
  count: number
  success: number
  error: number
  sumMs: number
  minMs: number | null
  maxMs: number | null
  avgMs: number
  p50Ms: number | null
  p95Ms: number | null
  p99Ms: number | null
}

export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null
  if (sorted.length === 1) return sorted[0]
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.min(Math.max(idx, 0), sorted.length - 1)]
}
