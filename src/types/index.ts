export type { WalletState, StellarTransaction } from '../hooks/useFreighterWallet'
export type { SearchResult, SearchSession } from '../hooks/useSearch'

export interface ApiStat {
  totalQueries: number
  totalUsdcSettled: string
  avgLatencyMs: number
  uptime: string
  // New observability fields (bounded percentiles, readiness)
  latency?: { avgMs: number; p50Ms: number | null; p95Ms: number | null; p99Ms: number | null; samples: number }
  timings?: Record<string, { count: number; avgMs: number; p50Ms: number | null; p95Ms: number | null }>
  status?: 'ok' | 'degraded' | 'unavailable'
  checks?: Record<string, { status: string; configured: boolean; reachable: boolean | null }>
}
