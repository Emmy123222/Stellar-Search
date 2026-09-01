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
  status: 'online' | 'offline'
  [key: string]: any // Add index signature
}

const CARDS = [
  { key: 'totalQueries',     label: 'Total Queries', Icon: TrendingUp, color: '#00f5ff', fmt: (v: unknown) => Number(v).toLocaleString() },
  { key: 'totalUsdcSettled', label: 'USDC Settled',  Icon: Zap,        color: '#ffb800', fmt: (v: unknown) => `$${v}` },
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
        const next: ServerStats = {
          totalQueries:     data.totalQueries     ?? 0,
          totalUsdcSettled: data.totalUsdcSettled ?? '0.00',
          avgLatencyMs:     data.avgLatencyMs     ?? 0,
          uptime:           data.uptime           ?? '—',
          status: 'online',
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
        <div className={`w-1.5 h-1.5 rounded-full ${stats.status === 'online' ? 'bg-neon-green animate-pulse' : 'bg-red-500'}`} />
        <span className="font-display text-xs text-white/25">
          SERVER {stats.status === 'online' ? 'ONLINE' : 'OFFLINE — run: npm run server'}
        </span>
      </div>
    </div>
  )
}
