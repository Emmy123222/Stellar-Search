import { motion, AnimatePresence } from 'framer-motion'
import { ExternalLink, ShieldCheck, ShieldAlert, AlertTriangle } from 'lucide-react'
import type { SearchSession } from '../../hooks/useSearch'
import { explorerTxUrl, truncateHash } from '../../lib/stellar'
import type { FeeSponsorshipInfo } from '../../lib/feeSponsorship'

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
  /** Acknowledges the challenge's fee terms so signing can proceed (#312). */
  onAcknowledge?: () => void
}

/** Visual treatment per sponsorship classification. */
const SPONSORSHIP_STYLE: Record<FeeSponsorshipInfo['payer'], { color: string; bg: string; border: string }> = {
  sponsor: { color: '#39ff14', bg: 'rgba(57,255,20,0.05)', border: 'rgba(57,255,20,0.25)' },
  payer:   { color: '#ffb800', bg: 'rgba(255,184,0,0.05)', border: 'rgba(255,184,0,0.25)' },
  unknown: { color: '#ef4444', bg: 'rgba(239,68,68,0.05)', border: 'rgba(239,68,68,0.25)' },
}

function SponsorshipIcon({ payer }: { payer: FeeSponsorshipInfo['payer'] }) {
  const className = 'w-3.5 h-3.5 flex-shrink-0'
  if (payer === 'sponsor') return <ShieldCheck className={className} />
  if (payer === 'payer') return <ShieldAlert className={className} />
  return <AlertTriangle className={className} />
}

/**
 * Shows who pays the Stellar network fee for the active challenge, and any
 * estimated payer fee the challenge stated (#312). Purely presentational — the
 * acknowledgement gate itself lives in `useSearch`.
 */
function FeeSponsorshipPanel({
  sponsorship,
  awaiting,
  onAcknowledge,
}: {
  sponsorship: FeeSponsorshipInfo
  awaiting: boolean
  onAcknowledge?: () => void
}) {
  const style = SPONSORSHIP_STYLE[sponsorship.payer]

  return (
    <div
      className="space-y-2"
      data-testid="sponsorship-row"
      data-payer={sponsorship.payer}
    >
      <div
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 py-2.5 px-3 rounded-lg"
        style={{ background: style.bg, border: `1px solid ${style.border}` }}
      >
        <div className="flex items-start gap-2">
          <span style={{ color: style.color }} className="mt-0.5">
            <SponsorshipIcon payer={sponsorship.payer} />
          </span>
          <div>
            <p className="font-display text-xs" style={{ color: style.color }} data-testid="sponsorship-label">
              {sponsorship.label}
            </p>
            <p className="text-white/40" style={{ fontSize: '11px' }} data-testid="sponsorship-detail">
              {sponsorship.detail}
            </p>
          </div>
        </div>

        {sponsorship.estimatedNetworkFeeXlm && (
          <div className="text-right flex-shrink-0" data-testid="sponsorship-estimated-fee">
            <p className="font-display text-white/25" style={{ fontSize: '8px' }}>EST. PAYER FEE</p>
            <p className="font-display" style={{ fontSize: '10px', color: style.color }}>
              {sponsorship.estimatedNetworkFeeXlm} XLM
            </p>
          </div>
        )}
      </div>

      {/* Unknown or changed sponsorship: no optimistic copy, no signing until
          the payer explicitly continues (#312). */}
      <AnimatePresence>
        {awaiting && (
          <motion.div
            key="sponsorship-ack"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div
              className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-2.5 px-3 rounded-lg"
              style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)' }}
              data-testid="sponsorship-acknowledgement"
            >
              <p className="text-red-200" style={{ fontSize: '11px' }}>
                {sponsorship.acknowledgementReason === 'changed'
                  ? 'Fee sponsorship changed since the last challenge. Nothing is signed until you confirm these terms.'
                  : 'The challenge does not state who pays the network fee. Nothing is signed until you confirm these terms.'}
              </p>
              {onAcknowledge && (
                <motion.button
                  type="button"
                  onClick={onAcknowledge}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="inline-flex items-center justify-center px-3 py-2 rounded-lg font-display text-xs tracking-wider text-red-200 flex-shrink-0"
                  style={{ border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.08)' }}
                  data-testid="sponsorship-acknowledge-button"
                >
                  I UNDERSTAND — CONTINUE
                </motion.button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function PaymentFlowVisualizer({ session, onAcknowledge }: Props) {
  if (session.status === 'idle') return null

  const isSearching = session.status === 'searching'
  const isComplete  = session.status === 'complete'
  const isError     = session.status === 'error'

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
      <div className="flex items-center justify-between">
        <span className="font-display text-xs text-white/30 tracking-widest">x402 PAYMENT FLOW</span>
        {session.status === 'complete' && <span className="font-display text-xs text-neon-green">✓ SETTLED</span>}
        {session.status === 'error'    && <span className="font-display text-xs text-red-400">✗ FAILED</span>}
      </div>

      {/* Step indicators */}
      <div className="relative">
        <div className="absolute top-5 inset-x-5 h-px bg-white/8 z-0" />
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
                      <span className="inline-block rtl-flip">{step.icon}</span>
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
            {isSearching && (
              <>
                <span className="inline-block rtl-flip me-1">→</span>
                {`Step ${session.step ?? 1}/${TOTAL_STEPS}: ${STEPS[activeIdx]?.label} — ${STEPS[activeIdx]?.sub}...`}
              </>
            )}
            {isComplete  && `✓ Payment settled — ${session.results.length} results in ${session.durationMs}ms`}
            {isError     && `✗ ${session.error}`}
          </p>
        </motion.div>
      </AnimatePresence>

      {/* Network-fee terms, shown before (and after) signing (#312) */}
      {session.sponsorship && (
        <FeeSponsorshipPanel
          sponsorship={session.sponsorship}
          awaiting={session.awaitingSponsorshipAcknowledgement === true}
          onAcknowledge={onAcknowledge}
        />
      )}

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
