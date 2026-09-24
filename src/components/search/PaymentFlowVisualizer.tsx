import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Clock, ExternalLink, RefreshCw } from 'lucide-react'
import type { SearchSession } from '../../hooks/useSearch'
import { explorerTxUrl, truncateHash } from '../../lib/stellar'
import { formatCountdown, isChallengeExpired, remainingMs } from '../../lib/paymentChallenge'

// 6 steps of the x402 flow per the official x402 quickstart:
//   request → 402 → sign → retry → facilitate → result
const STEPS = [
  { icon: '→', label: 'Request',      sub: 'GET /search',         color: '#00f5ff' },
  { icon: '⚡', label: '402 Received', sub: 'Payment Required',    color: '#ffb800' },
  { icon: '✦', label: 'Sign',         sub: 'Soroban + Freighter', color: '#7dd3fc' },
  { icon: '↻', label: 'Retry',        sub: 'X-PAYMENT header',    color: '#c084fc' },
  { icon: '◈', label: 'Facilitate',   sub: 'Settle on Stellar',   color: '#39ff14' },
  { icon: '✓', label: 'Result',       sub: 'Search response',     color: '#34d399' },
]

const TOTAL_STEPS = STEPS.length

interface Props {
  session: SearchSession
  /** Requests a fresh 402 challenge for the same query (#114). */
  onRetry?: () => void
}

/**
 * Ticks once per second while a challenge is live so the deadline countdown
 * stays accurate without re-rendering the whole payment flow on every frame.
 */
function useChallengeClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(id)
  }, [active])

  return now
}

export function PaymentFlowVisualizer({ session, onRetry }: Props) {
  const showCountdown = session.status === 'searching' && !!session.challenge
  const now = useChallengeClock(showCountdown)

  if (session.status === 'idle') return null

  const isSearching = session.status === 'searching'
  const isComplete  = session.status === 'complete'
  const isError     = session.status === 'error'

  // The challenge deadline applies while it is being signed/presented, and is
  // kept on the error state so an expired flow can explain itself.
  const left = remainingMs(session.challenge, now)
  const expired = isChallengeExpired(session.challenge, now)
  const showExpiry = expired || session.challengeExpired === true
  const canRetry = showExpiry && typeof onRetry === 'function'

  // `step` is 1-indexed in SearchSession; convert to 0-indexed active step.
  // When complete, treat all steps as done. When error, leave the in-flight
  // step un-done so the user sees where it failed.
  const activeIdx  = (session.step ?? 1) - 1
  const doneCount  = isComplete ? TOTAL_STEPS : activeIdx

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      className="rounded-xl p-5 space-y-4"
      style={{
        background: 'rgba(6,13,20,0.7)',
        border: '1px solid rgba(0,245,255,0.1)',
        backdropFilter: 'blur(12px)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <span className="font-display text-xs text-white/30 tracking-widest">x402 PAYMENT FLOW</span>

        {/* Active challenge deadline (#114). The server's window is counted down
            while signing/settlement are in flight so a slow approval is
            visible before it becomes a failure. */}
        {showCountdown && !expired && (
          <span
            className="font-display text-xs flex items-center gap-1 text-neon-amber"
            title={`Challenge window: ${session.challenge?.maxTimeoutSeconds ?? 0}s`}
            data-testid="challenge-countdown"
          >
            <Clock className="w-3 h-3" />
            EXPIRES {formatCountdown(left)}
          </span>
        )}
        {showExpiry && isSearching && (
          <span className="font-display text-xs flex items-center gap-1 text-red-400" data-testid="challenge-expired-chip">
            <Clock className="w-3 h-3" />
            EXPIRED
          </span>
        )}

        {session.status === 'complete' && <span className="font-display text-xs text-neon-green">✓ SETTLED</span>}
        {session.status === 'error' && !showExpiry && <span className="font-display text-xs text-red-400">✗ FAILED</span>}
      </div>

      {/* Expired challenge — deliberate retry for a fresh challenge (#114) */}
      <AnimatePresence>
        {showExpiry && (
          <motion.div
            key="challenge-expired"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div
              className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-2.5 px-3 rounded-lg"
              style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)' }}
              data-testid="challenge-expired-notice"
            >
              <div className="flex items-start gap-2">
                <Clock className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-display text-xs text-red-300">PAYMENT CHALLENGE EXPIRED</p>
                  <p className="text-white/40" style={{ fontSize: '11px' }}>
                    The {session.challenge?.maxTimeoutSeconds ?? 300}s signing window closed. Nothing was sent to the
                    network — request a new challenge to continue.
                  </p>
                </div>
              </div>
              {canRetry && (
                <motion.button
                  type="button"
                  onClick={onRetry}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg font-display text-xs tracking-wider text-red-200 flex-shrink-0"
                  style={{ border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.08)' }}
                  data-testid="challenge-retry-button"
                >
                  <RefreshCw className="w-3 h-3" />
                  GET FRESH CHALLENGE
                </motion.button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Step indicators */}
      <div className="relative">
        <div className="absolute top-5 left-5 right-5 h-px bg-white/8 z-0" />
        <div className="relative z-10 flex justify-between">
          {STEPS.map((step, i) => {
            const stepDone   = doneCount > i
            const stepActive = isSearching && i === activeIdx
            const stepFailed = isError && i === activeIdx

            return (
              <div key={step.label} className="flex flex-col items-center gap-2 flex-1">
                <motion.div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-sm border relative"
                  animate={{
                    borderColor: stepFailed ? '#ef4444'
                      : stepDone || stepActive ? step.color
                      : 'rgba(255,255,255,0.1)',
                    backgroundColor: stepDone ? `${step.color}20`
                      : stepActive ? `${step.color}10`
                      : stepFailed ? 'rgba(239,68,68,0.1)'
                      : 'transparent',
                    boxShadow: stepActive ? `0 0 20px ${step.color}50` : 'none',
                  }}
                >
                  {stepDone ? (
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      style={{ color: step.color }}
                      className="text-xs font-bold"
                    >✓</motion.span>
                  ) : stepFailed ? (
                    <span style={{ color: '#ef4444' }} className="text-xs font-bold">✗</span>
                  ) : (
                    <span style={{ color: stepActive ? step.color : 'rgba(255,255,255,0.25)' }} className="text-xs">
                      {step.icon}
                    </span>
                  )}
                  {stepActive && (
                    <motion.div
                      className="absolute inset-0 rounded-full border"
                      style={{ borderColor: step.color }}
                      animate={{ scale: [1, 1.8], opacity: [0.8, 0] }}
                      transition={{ duration: 1, repeat: Infinity }}
                    />
                  )}
                </motion.div>
                <div className="text-center">
                  <p className="font-display text-xs" style={{
                    color: stepFailed ? '#ef4444'
                      : stepDone || stepActive ? step.color
                      : 'rgba(255,255,255,0.25)',
                    fontSize: '10px',
                  }}>
                    {step.label}
                  </p>
                  <p className="text-white/20 hidden sm:block" style={{ fontSize: '9px' }}>{step.sub}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Status message */}
      <AnimatePresence mode="wait">
        <motion.div
          key={session.status}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 8 }}
          className="flex items-center gap-3 py-2.5 px-3 rounded-lg bg-white/4 border border-white/5"
        >
          {session.status === 'searching' && (
            <motion.div
              className="w-2 h-2 rounded-full bg-neon-cyan flex-shrink-0"
              animate={{ opacity: [1, 0.2, 1] }}
              transition={{ duration: 0.7, repeat: Infinity }}
            />
          )}
          <p className="font-display text-xs text-white/50">
            {isSearching && !showExpiry && `→ Step ${session.step ?? 1}/${TOTAL_STEPS}: ${STEPS[activeIdx]?.label} — ${STEPS[activeIdx]?.sub}...`}
            {isSearching && showExpiry && `✗ Step ${session.step ?? 1}/${TOTAL_STEPS}: challenge expired — awaiting a fresh challenge`}
            {isComplete  && `✓ Payment settled — ${session.results.length} results in ${session.durationMs}ms`}
            {isError     && `✗ ${session.error}`}
          </p>
        </motion.div>
      </AnimatePresence>

      {/* TX hash */}
      {session.status === 'complete' && session.txHash && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="space-y-2"
        >
          <div className="flex items-center justify-between py-2 px-3 rounded bg-neon-green/5 border border-neon-green/20">
            <span className="font-display text-xs text-neon-green/50">TX HASH</span>
            <a
              href={explorerTxUrl(session.txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs text-neon-green hover:opacity-80 transition-opacity flex items-center gap-1"
            >
              {truncateHash(session.txHash)} <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          {session.paidAmount && (
            <div className="grid grid-cols-3 gap-2">
              {([
                ['PAID',    `${session.paidAmount} USDC`],
                ['NETWORK', 'TESTNET'],
                ['STATUS',  'SETTLED'],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} className="py-1.5 px-2 rounded bg-white/4 text-center">
                  <p className="font-display text-white/25" style={{ fontSize: '8px' }}>{k}</p>
                  <p className="font-display text-neon-cyan" style={{ fontSize: '10px' }}>{v}</p>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  )
}
