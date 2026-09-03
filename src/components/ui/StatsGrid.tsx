import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { TrendingUp, Zap, Clock, Shield, HelpCircle } from 'lucide-react'
import { fetchServerStats } from '../../lib/stellar'
import { usePageVisible } from '../../hooks/usePageVisible'
import {
  resolveStat,
  statsUnavailableReason,
  type MeasuredStatField,
  type StatResolution,
} from '../../lib/serverHealth'

type ConnectionStatus = 'online' | 'offline'

interface StatCard {
  key: MeasuredStatField
  label: string
  Icon: typeof TrendingUp
  color: string
  fmt: (value: number | string) => string
}

const CARDS: StatCard[] = [
  { key: 'totalQueries',     label: 'Total Queries', Icon: TrendingUp, color: '#00f5ff', fmt: (v) => Number(v).toLocaleString() },
  { key: 'totalUsdcSettled', label: 'USDC Settled',  Icon: Zap,        color: '#ffb800', fmt: (v) => `$${v}` },
  { key: 'avgLatencyMs',     label: 'Avg Latency',   Icon: Clock,      color: '#39ff14', fmt: (v) => `${v}ms` },
  { key: 'uptime',           label: 'Uptime',        Icon: Shield,     color: '#7dd3fc', fmt: (v) => String(v) },
]

/** Rendered in place of a number the deployment does not measure. */
const UNAVAILABLE_PLACEHOLDER = 'n/a'

interface StatsGridProps {
  /** Polling interval in milliseconds. Defaults to 10 seconds. */
  pollingIntervalMs?: number
}

/**
 * Live server statistics.
 *
 * Values are read through `resolveStat` rather than straight off the health
 * payload (#226). A runtime that does not measure a statistic — a Vercel
 * function, which is stateless — declares it unsupported, and the card renders
 * `n/a` with the reason instead of a `0` that would read as a real
 * measurement. A genuine zero from a freshly started Express server still
 * renders as `0`.
 */
export function StatsGrid({ pollingIntervalMs = 10_000 }: StatsGridProps) {
  const [health, setHealth] = useState<unknown>(null)
  const [status, setStatus] = useState<ConnectionStatus>('offline')

  const load = useCallback(async () => {
    const data = await fetchServerStats()
    if (data) {
      // Only re-render when the payload actually changed; the poll runs every
      // few seconds and most ticks are identical.
      setHealth((previous: unknown) =>
        JSON.stringify(previous) === JSON.stringify(data) ? previous : data,
      )
      setStatus('online')
    } else {
      setStatus('offline')
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

  // While offline there is no payload at all, so every card resolves to
  // unavailable for the "unreachable" reason rather than showing stale values.
  const payload = status === 'online' ? health : null
  const panelReason = status === 'online' ? statsUnavailableReason(payload) : null

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {CARDS.map(({ key, label, Icon, color, fmt }, i) => {
        const resolved: StatResolution = resolveStat(payload, key)
        const display = resolved.available ? fmt(resolved.value) : UNAVAILABLE_PLACEHOLDER

        return (
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
                style={{
                  background: resolved.available ? `${color}15` : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${resolved.available ? `${color}30` : 'rgba(255,255,255,0.10)'}`,
                }}
              >
                <Icon
                  className="w-4 h-4"
                  style={{ color: resolved.available ? color : 'rgba(255,255,255,0.28)' }}
                />
              </div>
              {resolved.available ? (
                // The pulse means "this is a live measurement" — it must not
                // appear on a card showing an unmeasured field.
                <motion.div
                  data-testid={`live-indicator-${key}`}
                  className="w-1.5 h-1.5 rounded-full mt-1"
                  style={{ background: color }}
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 2, repeat: Infinity, delay: i * 0.4 }}
                />
              ) : (
                <HelpCircle className="w-3 h-3 mt-0.5 text-white/25" aria-hidden="true" />
              )}
            </div>
            <p
              className="font-display text-lg font-bold"
              style={{ color: resolved.available ? color : 'rgba(255,255,255,0.30)' }}
              data-testid={`stat-value-${key}`}
              data-available={resolved.available}
              title={resolved.available ? undefined : resolved.reason}
            >
              {display}
            </p>
            <p className="font-display text-white/30 mt-0.5 tracking-wider uppercase"
              style={{ fontSize: '9px' }}>
              {label}
            </p>
            {!resolved.available && (
              <span className="sr-only">{label} is not reported by this deployment. {resolved.reason}</span>
            )}
            <div className="mt-2.5 h-px rounded-full"
              style={{
                background: resolved.available
                  ? `linear-gradient(90deg, ${color}50, transparent)`
                  : 'linear-gradient(90deg, rgba(255,255,255,0.10), transparent)',
              }} />
          </motion.div>
        )
      })}

      <div className="col-span-2 lg:col-span-4 flex flex-col items-end gap-1 mt-1">
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${status === 'online' ? 'bg-neon-green animate-pulse' : 'bg-red-500'}`} />
          <span className="font-display text-xs text-white/25">
            SERVER {status === 'online' ? 'ONLINE' : 'OFFLINE — run: npm run server'}
          </span>
        </div>
        {panelReason && (
          // One explanation for the whole panel beats repeating it on four
          // cards, and it keeps "online but not measuring" from reading as a
          // quiet server.
          <p className="text-white/25 text-right max-w-md leading-relaxed" style={{ fontSize: '10px' }} role="note">
            Live counters are not available on this deployment. {panelReason}
          </p>
        )}
      </div>
    </div>
  )
}
