import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { TrendingUp, Zap, Clock, Shield } from 'lucide-react'
import { fetchServerStats } from '../../lib/stellar'
import { usePageVisible } from '../../hooks/usePageVisible'

interface ServerStats {
  totalQueries: number
  totalUsdcSettled: string
  avgLatencyMs: number
  uptime: string
  status: 'online' | 'offline' | 'degraded'
  latency?: { avgMs: number; p50Ms: number | null; p95Ms: number | null; p99Ms: number | null; samples: number }
  checks?: Record<string, any>
  rawStatus?: string
  [key: string]: any // Add index signature
}

const CARDS = [
  { key: 'totalQueries',     label: 'Total Queries', Icon: TrendingUp, color: '#00f5ff', fmt: (v: unknown) => Number(v).toLocaleString() },
  { key: 'totalUsdcSettled', label: 'USDC Settled',  Icon: Zap,        color: '#ffb800', fmt: (v: unknown) => `$${v}` },
  // avgLatencyMs now derived from bounded percentiles; p95 is available via latency.p95Ms for degraded insight
  { key: 'avgLatencyMs',     label: 'Avg Latency',   Icon: Clock,      color: '#39ff14', fmt: (v: unknown) => `${v}ms` },
  { key: 'uptime',           label: 'Uptime',        Icon: Shield,     color: '#7dd3fc', fmt: (v: unknown) => String(v) },
]

interface StatsGridProps {
  /** Polling interval in milliseconds. Defaults to 10 seconds. */
  pollingIntervalMs?: number
}

export function StatsGrid({ pollingIntervalMs = 10_000 }: StatsGridProps) {
  const [stats, setStats] = useState<ServerStats>({
    totalQueries: 0,
    totalUsdcSettled: '0.00',
    avgLatencyMs: 0,
    uptime: '—',
    status: 'offline',
  })

  const load = useCallback(async () => {
      const data = await fetchServerStats()
      if (data) {
        // Map health status (ok/degraded/unavailable) to UI status — preserves verified x402 semantics
        const healthStatus: string = data.status ?? 'ok'
        const uiStatus: ServerStats['status'] = healthStatus === 'unavailable' ? 'offline' : healthStatus === 'degraded' ? 'degraded' : 'online'
        // Prefer latency.avgMs (bounded percentiles) but keep avgLatencyMs compat
        const avg = data.latency?.avgMs ?? data.avgLatencyMs ?? 0
        const next: ServerStats = {
          totalQueries:     data.totalQueries     ?? 0,
          totalUsdcSettled: data.totalUsdcSettled ?? '0.00',
          avgLatencyMs:     avg,
          uptime:           data.uptime           ?? '—',
          status: uiStatus,
          latency: data.latency,
          checks: data.checks,
          rawStatus: healthStatus,
        }
        setStats(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
      } else {
        setStats(prev => ({ ...prev, status: 'offline' }))
      }
  }, [])

  const isVisible = usePageVisible()

  useEffect(() => {
    // Stop polling entirely while the tab is hidden (#338) -- no point
    // burning a network request every pollingIntervalMs for a page the
    // user isn't looking at. Re-fetch immediately on returning so the
    // stats aren't stale by up to a full interval.
    if (!isVisible) return

    load()
    const id = setInterval(load, pollingIntervalMs)
    return () => clearInterval(id)
  }, [load, pollingIntervalMs, isVisible])

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {CARDS.map(({ key, label, Icon, color, fmt }, i) => (
        <motion.div
          key={key}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.08 }}
          className="rounded-xl p-4"
          style={{
            background: 'rgba(6,13,20,0.7)',
            border: `1px solid ${color}18`,
            backdropFilter: 'blur(8px)',
          }}
        >
          <div className="flex items-start justify-between mb-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: `${color}15`, border: `1px solid ${color}30` }}
            >
              <Icon className="w-4 h-4" style={{ color }} />
            </div>
            <motion.div
              className="w-1.5 h-1.5 rounded-full mt-1"
              style={{ background: color }}
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 2, repeat: Infinity, delay: i * 0.4 }}
            />
          </div>
          <p className="font-display text-lg font-bold" style={{ color }}>
            {fmt(stats[key])}
          </p>
          <p className="font-display text-white/30 mt-0.5 tracking-wider uppercase"
            style={{ fontSize: '9px' }}>
            {label}
          </p>
          <div className="mt-2.5 h-px rounded-full"
            style={{ background: `linear-gradient(90deg, ${color}50, transparent)` }} />
        </motion.div>
      ))}

      <div className="col-span-2 lg:col-span-4 flex items-center justify-end gap-2 mt-1">
        <div className={`w-1.5 h-1.5 rounded-full ${stats.status === 'online' ? 'bg-neon-green animate-pulse' : stats.status === 'degraded' ? 'bg-yellow-400 animate-pulse' : 'bg-red-500'}`} />
        <span className="font-display text-xs text-white/25">
          SERVER {stats.status === 'online' ? 'ONLINE' : stats.status === 'degraded' ? `DEGRADED${stats.latency?.p95Ms ? ` · p95 ${stats.latency.p95Ms}ms` : ''}` : 'OFFLINE — run: npm run server'}
        </span>
      </div>
      {stats.checks && (
        <div className="col-span-2 lg:col-span-4 flex flex-wrap gap-2 mt-1 justify-end">
          {Object.entries(stats.checks).map(([k, v]: any) => (
            <span key={k} className="text-[9px] tracking-wider uppercase px-2 py-1 rounded-full border" style={{ borderColor: v.status === 'ok' ? '#39ff1440' : v.status === 'degraded' ? '#ffb80040' : '#ff444440', color: v.status === 'ok' ? '#39ff14' : v.status === 'degraded' ? '#ffb800' : '#ff4444', background: 'rgba(255,255,255,0.03)' }}>
              {k}: {v.status}{v.configured === false ? ' (not cfg)' : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
