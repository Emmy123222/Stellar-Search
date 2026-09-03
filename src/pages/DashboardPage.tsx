import { motion } from 'framer-motion'
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  ExternalLink,
  Activity,
  BarChart2,
  RefreshCw,
  History,
  Search,
  Download,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  Loader2,
  ShieldCheck,
} from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import {
  IS_MAINNET,
  STELLAR_NETWORK,
  AMOUNT_USDC,
  STELLAR_EXPERT_URL,
  truncateHash,
  truncateAddress,
  formatTimeAgo,
  explorerTxUrl,
  explorerAccountUrl,
  verifyReceiptAgainstHorizon,
} from '../lib/stellar'
import { SavedResearchPanel } from '../components/search'
import type { StellarTransaction } from '../hooks/useFreighterWallet'
import type { SearchReceipt, ReceiptVerificationDetail, ReceiptVerificationStatus } from '../types'
import { createReceiptBundle, downloadBundle } from '../lib/receiptBundle'

interface Props {
  transactions: StellarTransaction[]
  txLoading: boolean
  publicKey: string | null
  usdcBalance: string
  xlmBalance: string
  onRefresh: () => void
}

type DashboardTab = 'overview' | 'collections'

export function DashboardPage({ transactions, txLoading, publicKey, usdcBalance, xlmBalance, onRefresh }: Props) {
  const [receipts, setReceipts] = useState<SearchReceipt[]>([])
  const [verificationMap, setVerificationMap] = useState<Record<string, ReceiptVerificationDetail>>({})
  const [verifyingAll, setVerifyingAll] = useState(false)

  const verifyAllReceipts = useCallback(async (list: SearchReceipt[]) => {
    if (list.length === 0) return
    setVerifyingAll(true)

    // Mark all as pending first
    setVerificationMap((prev) => {
      const next = { ...prev }
      for (const r of list) {
        if (r.txHash) {
          next[r.txHash] = {
            status: 'pending',
            txHash: r.txHash,
            network: r.network,
          }
        }
      }
      return next
    })

    const results: Record<string, ReceiptVerificationDetail> = {}
    await Promise.all(
      list.map(async (receipt) => {
        if (!receipt.txHash) return
        const detail = await verifyReceiptAgainstHorizon(receipt)
        results[receipt.txHash] = detail
      })
    )

    setVerificationMap((prev) => ({ ...prev, ...results }))
    setVerifyingAll(false)
  }, [])

  const verifySingleReceipt = useCallback(async (receipt: SearchReceipt) => {
    if (!receipt.txHash) return
    setVerificationMap((prev) => ({
      ...prev,
      [receipt.txHash]: { status: 'pending', txHash: receipt.txHash, network: receipt.network },
    }))

    const detail = await verifyReceiptAgainstHorizon(receipt)
    setVerificationMap((prev) => ({
      ...prev,
      [receipt.txHash]: detail,
    }))
  }, [])

  // Client-side spending guard state (#313) — reactive config/usage, synced
  // across tabs via storage events; re-read on an interval so searches that
  // settle in this tab (no storage event fires locally) show up too.
  const { config, usage, updateConfig, refresh } = useSpendingLimits()
  const [sessionCapInput, setSessionCapInput] = useState(config.sessionCap)
  const [dailyCapInput, setDailyCapInput] = useState(config.dailyCap)
  const [enabledInput, setEnabledInput] = useState(config.enabled)
  const [pendingRaise, setPendingRaise] = useState<{ session: boolean; daily: boolean } | null>(null)
  const [inputError, setInputError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState(false)
  const prevConfigRef = useRef(config)

  useEffect(() => {
    const id = setInterval(() => refresh(), 5000)
    return () => clearInterval(id)
  }, [refresh])

  // Adopt externally-changed caps (other tabs) without clobbering typing:
  // only overwrite an input while it still matches the previously saved value.
  useEffect(() => {
    const prev = prevConfigRef.current
    if (prev.sessionCap !== config.sessionCap && sessionCapInput === prev.sessionCap) {
      setSessionCapInput(config.sessionCap)
    }
    if (prev.dailyCap !== config.dailyCap && dailyCapInput === prev.dailyCap) {
      setDailyCapInput(config.dailyCap)
    }
    if (prev.enabled !== config.enabled) {
      setEnabledInput(config.enabled)
    }
    prevConfigRef.current = config
  }, [config, sessionCapInput, dailyCapInput])

  useEffect(() => {
    const raw = localStorage.getItem('stellarsearch_receipts')
    if (raw) {
      try {
        const parsed: SearchReceipt[] = JSON.parse(raw)
        setReceipts(parsed)
        // Automatically verify receipts against Horizon on initial load
        if (parsed.length > 0) {
          verifyAllReceipts(parsed)
        }
      } catch (e) {
        console.error('Failed to parse receipts:', e)
      }
    }
  }, [verifyAllReceipts])

  const handleRefresh = useCallback(() => {
    onRefresh()
    if (receipts.length > 0) {
      verifyAllReceipts(receipts)
    }
  }, [onRefresh, receipts, verifyAllReceipts])

  const fmtInput = (v: string) => String(Math.round(parseUsdc(v) * 1000) / 1000)

  const applyConfig = (sessionCap: string, dailyCap: string) => {
    updateConfig({ enabled: enabledInput, sessionCap, dailyCap })
    setSessionCapInput(sessionCap)
    setDailyCapInput(dailyCap)
    setPendingRaise(null)
    setInputError(null)
    setSavedAt(true)
    setTimeout(() => setSavedAt(false), 2000)
  }

  const handleSave = () => {
    const nextSession = parseUsdc(sessionCapInput)
    const nextDaily = parseUsdc(dailyCapInput)
    if (!Number.isFinite(nextSession) || !Number.isFinite(nextDaily) || nextSession < 0 || nextDaily < 0) {
      setInputError('Enter valid USDC amounts (0 = no limit for that bucket).')
      return
    }
    setInputError(null)

    // Raising a cap weakens the guardrail — require explicit confirmation.
    const raisingSession = nextSession > parseUsdc(config.sessionCap)
    const raisingDaily = nextDaily > parseUsdc(config.dailyCap)
    if (raisingSession || raisingDaily) {
      setPendingRaise({ session: raisingSession, daily: raisingDaily })
      return
    }
    applyConfig(fmtInput(sessionCapInput), fmtInput(dailyCapInput))
  }

  const sessionSpent = parseUsdc(usage.sessionSpent)
  const dailySpent = parseUsdc(usage.dailySpent)
  const sessionCap = parseUsdc(config.sessionCap)
  const dailyCap = parseUsdc(config.dailyCap)
  const sessionPct = sessionCap > 0 ? Math.min(100, (sessionSpent / sessionCap) * 100) : 0
  const dailyPct = dailyCap > 0 ? Math.min(100, (dailySpent / dailyCap) * 100) : 0

  const networkLabel = IS_MAINNET ? 'STELLAR MAINNET' : 'STELLAR TESTNET'

  const chartData = useMemo(() => {
    const usdcTxs = transactions.filter(tx => tx.asset === 'USDC')
    const sortedTxs = [...usdcTxs].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    
    const grouped = sortedTxs.reduce((acc, tx) => {
      const date = new Date(tx.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      if (!acc[date]) acc[date] = 0
      acc[date] += parseFloat(tx.amount)
      return acc
    }, {} as Record<string, number>)

    return Object.entries(grouped).map(([date, amount]: [string, number]) => ({
      date,
      amount: parseFloat(amount.toFixed(2))
    }))
  }, [transactions])

  const receiptSummary = useMemo(() => {
    let confirmed = 0
    let mismatched = 0
    let unverified = 0
    let pending = 0

    for (const r of receipts) {
      if (!r.txHash) continue
      const detail = verificationMap[r.txHash]
      const status: ReceiptVerificationStatus = detail?.status || r.status || 'unverified'
      if (status === 'confirmed') confirmed++
      else if (status === 'mismatched') mismatched++
      else if (status === 'pending') pending++
      else unverified++
    }

    return { confirmed, mismatched, unverified, pending }
  }, [receipts, verificationMap])

  return (
    <div className="max-w-4xl mx-auto px-4 py-10 space-y-8">

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between">
        <div>
          <span className="font-display text-xs text-neon-cyan/50 tracking-widest">LIVE BLOCKCHAIN DATA</span>
          <h1 className="font-display text-3xl text-white mt-1">DASHBOARD</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${IS_MAINNET ? 'bg-neon-amber' : 'bg-neon-green'}`} />
            <span className={`font-display text-xs tracking-wider ${IS_MAINNET ? 'text-neon-amber/60' : 'text-neon-green/60'}`}>{networkLabel}</span>
          </div>
          <button
            onClick={handleRefresh}
            disabled={txLoading || verifyingAll}
            className="p-2 rounded-lg border border-white/10 text-white/30 hover:text-neon-cyan transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`w-4 h-4 ${(txLoading || verifyingAll) ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </motion.div>

      {/* Account overview */}
      {publicKey ? (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-2xl p-5"
          style={{ background: 'rgba(6,13,20,0.7)', border: '1px solid rgba(0,245,255,0.12)' }}
        >
          <div className="flex items-center justify-between mb-4">
            <span className="font-display text-xs text-white/30 tracking-widest">YOUR STELLAR ACCOUNT</span>
            <a
              href={explorerAccountUrl(publicKey)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 font-display text-xs text-neon-cyan/50 hover:text-neon-cyan transition-colors"
            >
              VIEW ON EXPLORER <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <p className="font-display text-xs text-white/30 mb-1" style={{ fontSize: '10px' }}>PUBLIC KEY</p>
              <p className="font-mono text-xs text-white/60 break-all leading-relaxed">{publicKey}</p>
            </div>
            <div className="py-3 px-4 rounded-xl text-center"
              style={{ background: 'rgba(255,184,0,0.05)', border: '1px solid rgba(255,184,0,0.15)' }}>
              <p className="font-display text-xs text-white/30 mb-1" style={{ fontSize: '10px' }}>USDC BALANCE</p>
              <p className="font-display text-2xl text-neon-amber">{usdcBalance}</p>
              <p className="font-display text-white/25 mt-1" style={{ fontSize: '9px' }}>
                {Math.floor(parseFloat(usdcBalance) / parseFloat(AMOUNT_USDC)).toLocaleString()} queries remaining
              </p>
            </div>
            <div className="py-3 px-4 rounded-xl text-center"
              style={{ background: 'rgba(0,245,255,0.05)', border: '1px solid rgba(0,245,255,0.15)' }}>
              <p className="font-display text-xs text-white/30 mb-1" style={{ fontSize: '10px' }}>XLM BALANCE</p>
              <p className="font-display text-2xl text-neon-cyan">{xlmBalance}</p>
              <p className="font-display text-white/25 mt-1" style={{ fontSize: '9px' }}>for network fees</p>
            </div>
          </div>
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-2xl p-8 text-center"
          style={{ background: 'rgba(6,13,20,0.5)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <p className="font-display text-white/30 text-sm">Connect your Freighter wallet to see live account data</p>
        </motion.div>
      )}

      {/* Spending limits — local guardrail (#313) */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12 }}
        className="rounded-2xl p-5"
        style={{ background: 'rgba(6,13,20,0.7)', border: '1px solid rgba(255,255,255,0.07)' }}
      >
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-neon-cyan/40" />
            <span className="font-display text-xs text-white/30 tracking-widest">SPENDING LIMITS</span>
            <span className="font-display text-white/15" style={{ fontSize: '10px' }}>· LOCAL GUARDRAIL</span>
          </div>
          <button
            onClick={() => setEnabledInput(!enabledInput)}
            className={`flex items-center gap-2 px-2.5 py-1 rounded-lg border font-display text-[10px] tracking-wider transition-colors ${
              enabledInput
                ? 'text-neon-green/70 border-neon-green/25 bg-neon-green/5'
                : 'text-white/30 border-white/10 hover:text-white/50'
            }`}
            aria-pressed={enabledInput}
            title={enabledInput ? 'Spending limits active — click to disable' : 'Spending limits disabled — click to enable'}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${enabledInput ? 'bg-neon-green' : 'bg-white/20'}`} />
            {enabledInput ? 'ENFORCED' : 'OFF'}
          </button>
        </div>
        <p className="text-white/30 text-xs mb-4">
          Local caps on paid searches ({AMOUNT_USDC} USDC each). Raising a cap requires confirmation.
        </p>

        <div className="space-y-4 mb-5">
          {/* Session usage */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-display text-[10px] text-white/40 tracking-wider">SESSION</span>
              <span className="font-mono text-[11px] text-white/50">
                {usage.sessionSpent} / {sessionCap > 0 ? config.sessionCap : '∞'} USDC
                {usage.reservations.length > 0 && (
                  <span className="text-neon-cyan/60 ml-2">· {usage.reservations.length} in flight</span>
                )}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
              {sessionCap > 0 ? (
                <motion.div
                  className={`h-full rounded-full ${sessionPct >= 90 ? 'bg-neon-amber' : 'bg-neon-cyan'}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${sessionPct}%` }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                />
              ) : (
                <div className="h-full w-full rounded-full bg-white/5" />
              )}
            </div>
          </div>

          {/* Daily usage */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-display text-[10px] text-white/40 tracking-wider">DAILY</span>
              <span className="font-mono text-[11px] text-white/50">
                {usage.dailySpent} / {dailyCap > 0 ? config.dailyCap : '∞'} USDC
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
              {dailyCap > 0 ? (
                <motion.div
                  className={`h-full rounded-full ${dailyPct >= 90 ? 'bg-neon-amber' : 'bg-neon-green'}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${dailyPct}%` }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                />
              ) : (
                <div className="h-full w-full rounded-full bg-white/5" />
              )}
            </div>
          </div>
        </div>

        {/* Cap configuration */}
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-[110px]">
            <span className="font-display text-[10px] text-white/35 tracking-wider block mb-1">SESSION CAP (USDC)</span>
            <input
              type="number"
              min="0"
              step="0.001"
              value={sessionCapInput}
              onChange={(e) => setSessionCapInput(e.target.value)}
              disabled={!enabledInput}
              className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 font-mono text-sm text-white/80 focus:outline-none focus:border-neon-cyan/50 disabled:opacity-40"
              aria-label="Session spending cap in USDC"
            />
          </label>
          <label className="flex-1 min-w-[110px]">
            <span className="font-display text-[10px] text-white/35 tracking-wider block mb-1">DAILY CAP (USDC)</span>
            <input
              type="number"
              min="0"
              step="0.001"
              value={dailyCapInput}
              onChange={(e) => setDailyCapInput(e.target.value)}
              disabled={!enabledInput}
              className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 font-mono text-sm text-white/80 focus:outline-none focus:border-neon-cyan/50 disabled:opacity-40"
              aria-label="Daily spending cap in USDC"
            />
          </label>
          <button
            onClick={handleSave}
            disabled={!enabledInput}
            className="px-4 py-2 rounded-lg font-display text-xs tracking-wider text-neon-cyan border border-neon-cyan/30 hover:bg-neon-cyan/10 transition-colors disabled:opacity-40"
          >
            {savedAt ? 'SAVED ✓' : 'SAVE CAPS'}
          </button>
        </div>
        {inputError && <p className="text-neon-amber/80 text-xs mt-2">{inputError}</p>}
        <p className="text-white/20 text-[10px] mt-2">0 = no limit · limits apply per browser (all tabs share them)</p>

        {/* Confirmation required to raise a cap */}
        {pendingRaise && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 rounded-xl p-4 flex flex-wrap items-center gap-3"
            style={{ background: 'rgba(255,184,0,0.06)', border: '1px solid rgba(255,184,0,0.25)' }}
          >
            <AlertTriangle className="w-4 h-4 text-neon-amber/80 flex-shrink-0" />
            <p className="text-xs text-white/60 flex-1 min-w-[200px]">
              {pendingRaise.session && pendingRaise.daily
                ? `This raises both caps (session ${config.sessionCap} → ${sessionCapInput}, daily ${config.dailyCap} → ${dailyCapInput} USDC).`
                : pendingRaise.session
                  ? `This raises your session cap from ${config.sessionCap} to ${sessionCapInput} USDC.`
                  : `This raises your daily cap from ${config.dailyCap} to ${dailyCapInput} USDC.`}
              {' '}Raising a cap weakens the local guardrail. Continue?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => applyConfig(fmtInput(sessionCapInput), fmtInput(dailyCapInput))}
                className="px-3 py-1.5 rounded-lg font-display text-[10px] tracking-wider text-neon-amber border border-neon-amber/40 hover:bg-neon-amber/10 transition-colors"
              >
                CONFIRM RAISE
              </button>
              <button
                onClick={() => setPendingRaise(null)}
                className="px-3 py-1.5 rounded-lg font-display text-[10px] tracking-wider text-white/40 border border-white/10 hover:text-white/70 transition-colors"
              >
                CANCEL
              </button>
            </div>
          </motion.div>
        )}
      </motion.div>

      {/* USDC Spent Chart */}
      {publicKey && chartData.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="rounded-2xl p-5"
          style={{ background: 'rgba(6,13,20,0.7)', border: '1px solid rgba(255,184,0,0.15)' }}
        >
          <div className="flex items-center gap-2 mb-6">
            <BarChart2 className="w-4 h-4 text-neon-amber/40" />
            <span className="font-display text-xs text-white/30 tracking-widest">USDC SPENT OVER TIME</span>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis 
                  dataKey="date" 
                  stroke="rgba(255,255,255,0.2)" 
                  fontSize={10} 
                  tickLine={false} 
                  axisLine={false} 
                  fontFamily="monospace"
                />
                <YAxis 
                  stroke="rgba(255,255,255,0.2)" 
                  fontSize={10} 
                  tickLine={false} 
                  axisLine={false} 
                  tickFormatter={(val: number | string) => `$${val}`}
                  fontFamily="monospace"
                />
                <Tooltip 
                  cursor={{ fill: 'rgba(255,184,0,0.05)' }}
                  contentStyle={{ 
                    backgroundColor: 'rgba(6,13,20,0.9)', 
                    border: '1px solid rgba(255,184,0,0.2)',
                    borderRadius: '8px',
                    fontFamily: 'monospace',
                    fontSize: '12px'
                  }}
                  itemStyle={{ color: '#ffb800' }}
                  labelStyle={{ color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}
                />
                <Bar 
                  dataKey="amount" 
                  fill="#ffb800" 
                  radius={[4, 4, 0, 0]} 
                  maxBarSize={40}
                  animationDuration={1500}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      )}

      {/* Compare stored result sets */}
      {comparison && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18 }}
          className="rounded-2xl p-5"
          style={{ background: 'rgba(6,13,20,0.7)', border: '1px solid rgba(0,245,255,0.12)' }}
        >
          <div className="flex items-center gap-2 mb-4">
            <History className="w-4 h-4 text-neon-cyan/40" />
            <span className="font-display text-xs text-white/30 tracking-widest">COMPARE RESULT SETS</span>
          </div>
          <div className="flex flex-col sm:flex-row gap-4 mb-4">
            <select
              value={leftIdx}
              onChange={e => setLeftIdx(Number(e.target.value))}
              className="bg-[#0d1b24] text-white/70 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-neon-cyan/40"
            >
              {receipts.map((r, i) => (
                <option key={i} value={i}>{new Date(r.timestamp).toLocaleString()} - {(r.query || '').slice(0, 30)}</option>
              ))}
            </select>
            <span className="text-white/30 text-xs self-center font-display">VS</span>
            <select
              value={rightIdx}
              onChange={e => setRightIdx(Number(e.target.value))}
              className="bg-[#0d1b24] text-white/70 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-neon-cyan/40"
            >
              {receipts.map((r, i) => (
                <option key={i} value={i}>{new Date(r.timestamp).toLocaleString()} - {(r.query || '').slice(0, 30)}</option>
              ))}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead>
                <tr className="text-white/30 border-b border-white/10">
                  <th className="py-2 pr-4 font-display tracking-widest">STATUS</th>
                  <th className="py-2 pr-4 font-display tracking-widest">URL</th>
                  <th className="py-2 pr-4 font-display tracking-widest text-center">LEFT RANK</th>
                  <th className="py-2 font-display tracking-widest text-center">RIGHT RANK</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {comparison.rows.map(row => (
                  <tr key={row.url} className="align-top">
                    <td className="py-2 pr-4">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-display tracking-wider ${
                        row.status === 'added' ? 'bg-neon-green/10 text-neon-green border border-neon-green/30' :
                        row.status === 'removed' ? 'bg-red-500/10 text-red-400 border border-red-500/30' :
                        row.status === 'moved' ? 'bg-neon-amber/10 text-neon-amber border border-neon-amber/30' :
                        'bg-white/5 text-white/40 border border-white/10'
                      }`}>{row.status.toUpperCase()}</span>
                    </td>
                    <td className="py-2 pr-4">
                      <a href={row.url} target="_blank" rel="noopener noreferrer" className="text-neon-cyan/70 hover:text-neon-cyan break-all">{row.url}</a>
                    </td>
                    <td className="py-2 pr-4 text-center text-white/50">{row.leftRank ?? '—'}</td>
                    <td className="py-2 text-center text-white/50">{row.rightRank ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {/* Live transactions from Horizon */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="flex items-center gap-1 p-1 rounded-xl w-fit"
        style={{ background: 'rgba(6,13,20,0.7)', border: '1px solid rgba(255,255,255,0.07)' }}
        role="tablist"
        aria-label="Dashboard sections"
      >
        {([
          { id: 'overview',     label: 'OVERVIEW',    icon: Activity },
          { id: 'collections',  label: 'COLLECTIONS', icon: Bookmark, badge: collections.collections.length || undefined },
        ] as { id: DashboardTab; label: string; icon: React.ElementType; badge?: number }[]).map(({ id, label, icon: Icon, badge }) => (
          <button
            key={id}
            role="tab"
            aria-selected={activeTab === id}
            onClick={() => setActiveTab(id)}
            className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-display text-xs tracking-wider transition-all
              ${activeTab === id
                ? 'text-neon-cyan bg-neon-cyan/10'
                : 'text-white/35 hover:text-white/60 hover:bg-white/5'
              }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
            {badge !== undefined && (
              <span
                className="ml-0.5 px-1.5 py-0.5 rounded-full font-display"
                style={{
                  background: activeTab === id ? 'rgba(0,245,255,0.2)' : 'rgba(255,255,255,0.08)',
                  color: activeTab === id ? '#00f5ff' : 'rgba(255,255,255,0.3)',
                  fontSize: '9px',
                }}
              >
                {badge}
              </span>
            )}
          </button>
        ))}
      </motion.div>

      {/* Collections tab */}
      {activeTab === 'collections' && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <CollectionsPanel collections={collections} />
        </motion.div>
      )}

      {/* Overview tab */}
      {activeTab === 'overview' && (
        <>
          {/* Account overview */}
          {publicKey ? (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="rounded-2xl p-5"
              style={{ background: 'rgba(6,13,20,0.7)', border: '1px solid rgba(0,245,255,0.12)' }}
            >
              <div className="flex items-center justify-between mb-4">
                <span className="font-display text-xs text-white/30 tracking-widest">YOUR STELLAR ACCOUNT</span>
                <a
                  href={explorerAccountUrl(publicKey)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 font-display text-xs text-neon-cyan/50 hover:text-neon-cyan transition-colors"
                >
                  VIEW ON EXPLORER <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <div className="grid sm:grid-cols-3 gap-4">
                <div>
                  <p className="font-display text-xs text-white/30 mb-1" style={{ fontSize: '10px' }}>PUBLIC KEY</p>
                  <p className="font-mono text-xs text-white/60 break-all leading-relaxed">{publicKey}</p>
                </div>
                <div className="py-3 px-4 rounded-xl text-center"
                  style={{ background: 'rgba(255,184,0,0.05)', border: '1px solid rgba(255,184,0,0.15)' }}>
                  <p className="font-display text-xs text-white/30 mb-1" style={{ fontSize: '10px' }}>USDC BALANCE</p>
                  <p className="font-display text-2xl text-neon-amber">{usdcBalance}</p>
                  <p className="font-display text-white/25 mt-1" style={{ fontSize: '9px' }}>
                    {Math.floor(parseFloat(usdcBalance) / parseFloat(AMOUNT_USDC)).toLocaleString()} queries remaining
                  </p>
                </div>
                <div className="py-3 px-4 rounded-xl text-center"
                  style={{ background: 'rgba(0,245,255,0.05)', border: '1px solid rgba(0,245,255,0.15)' }}>
                  <p className="font-display text-xs text-white/30 mb-1" style={{ fontSize: '10px' }}>XLM BALANCE</p>
                  <p className="font-display text-2xl text-neon-cyan">{xlmBalance}</p>
                  <p className="font-display text-white/25 mt-1" style={{ fontSize: '9px' }}>for network fees</p>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="rounded-2xl p-8 text-center"
              style={{ background: 'rgba(6,13,20,0.5)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <p className="font-display text-white/30 text-sm">Connect your Freighter wallet to see live account data</p>
            </motion.div>
          )}

      {/* Search Audit Log */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="rounded-2xl overflow-hidden"
        style={{ background: 'rgba(6,13,20,0.7)', border: '1px solid rgba(0,245,255,0.1)' }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between p-5 border-b border-white/5 gap-3">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-neon-cyan/40" />
            <span className="font-display text-xs text-white/30 tracking-widest">SEARCH AUDIT LOG</span>
            <span className="font-display text-white/15" style={{ fontSize: '10px' }}>· VERIFIED AGAINST HORIZON</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Verification Status Counter Pills */}
            {receipts.length > 0 && (
              <div className="flex items-center gap-1.5 mr-1 font-mono text-[10px]">
                {receiptSummary.confirmed > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-neon-green/10 text-neon-green border border-neon-green/30">
                    {receiptSummary.confirmed} CONFIRMED
                  </span>
                )}
                {receiptSummary.mismatched > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/30">
                    {receiptSummary.mismatched} MISMATCHED
                  </span>
                )}
                {receiptSummary.unverified > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-white/5 text-white/40 border border-white/10">
                    {receiptSummary.unverified} UNVERIFIED
                  </span>
                )}
              </div>
            )}

            {receipts.length > 0 && (
              <>
                <button
                  onClick={() => verifyAllReceipts(receipts)}
                  disabled={verifyingAll}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neon-cyan/20 text-neon-cyan/70 hover:text-neon-cyan hover:border-neon-cyan/40 transition-colors font-display text-[10px] tracking-wider disabled:opacity-40"
                  title="Verify all receipts on Stellar Horizon"
                >
                  <ShieldCheck className={`w-3 h-3 ${verifyingAll ? 'animate-spin' : ''}`} />
                  {verifyingAll ? 'VERIFYING...' : 'VERIFY ALL'}
                </button>
                <button
                  onClick={async () => {
                    const network = IS_MAINNET ? 'stellar:mainnet' : 'stellar:testnet'
                    const bundle = await createReceiptBundle(receipts, network)
                    downloadBundle(bundle)
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-white/60 hover:text-white hover:border-white/20 transition-colors font-display text-[10px] tracking-wider"
                >
                  <Download className="w-3 h-3" />
                  DOWNLOAD BUNDLE
                </button>
              </>
            )}
            <div className="font-display text-[10px] text-white/20 uppercase tracking-wider">
              {receipts.length} RECEIPTS
            </div>
          </div>
        </div>

        <div className="divide-y divide-white/4">
          {receipts.length === 0 ? (
            <div className="text-center py-10">
              <Search className="w-8 h-8 text-white/10 mx-auto mb-3" />
              <p className="font-display text-xs text-white/20 tracking-widest">NO SEARCH RECEIPTS YET</p>
              <p className="text-white/25 text-sm mt-2">Perform a search to see your payment history</p>
            </div>
          ) : (
            receipts.map((receipt, i) => {
              const detail = verificationMap[receipt.txHash]
              const status: ReceiptVerificationStatus = detail?.status || receipt.status || 'unverified'

              return (
                <motion.div
                  key={receipt.txHash}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 hover:bg-white/2 transition-colors"
                >
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    {/* Status Dot */}
                    <div className="mt-1.5 flex-shrink-0">
                      {status === 'confirmed' && (
                        <div
                          className="w-2 h-2 rounded-full bg-neon-green"
                          style={{ boxShadow: '0 0 8px rgba(57,255,20,0.8)' }}
                        />
                      )}
                      {status === 'pending' && (
                        <div className="w-2 h-2 rounded-full bg-neon-cyan animate-pulse" />
                      )}
                      {status === 'mismatched' && (
                        <div
                          className="w-2 h-2 rounded-full bg-red-500"
                          style={{ boxShadow: '0 0 8px rgba(239,68,68,0.8)' }}
                        />
                      )}
                      {status === 'unverified' && (
                        <div className="w-2 h-2 rounded-full bg-white/20" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white/80 font-medium truncate">"{receipt.query}"</p>
                      
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[10px]">
                        <a
                          href={explorerTxUrl(receipt.txHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-white/30 hover:text-neon-cyan transition-colors flex items-center gap-1"
                        >
                          {truncateHash(receipt.txHash, 8)} <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                        
                        {receipt.destination && (
                          <span className="font-mono text-white/20 truncate max-w-[140px]" title={`Destination: ${receipt.destination}`}>
                            to: {truncateAddress(receipt.destination, 4)}
                          </span>
                        )}

                        <span className="text-white/20">{formatTimeAgo(receipt.timestamp)}</span>

                        {(status === 'unverified' || status === 'mismatched') && (
                          <button
                            onClick={() => verifySingleReceipt(receipt)}
                            className="font-mono text-neon-cyan/70 hover:text-neon-cyan underline transition-colors cursor-pointer"
                          >
                            Re-verify
                          </button>
                        )}
                      </div>

                      {/* Mismatch Warning Details */}
                      {status === 'mismatched' && (
                        <div className="mt-2 px-2.5 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 font-mono text-[10px] flex items-center gap-2">
                          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 text-red-400" />
                          <span>
                            {detail?.mismatches && detail.mismatches.length > 0
                              ? detail.mismatches.join('; ')
                              : 'Discrepancy detected against Horizon ledger'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right: Amount & Distinct Status Badge */}
                  <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center flex-shrink-0 gap-1.5 pl-5 sm:pl-0 border-t sm:border-t-0 border-white/5 pt-2 sm:pt-0">
                    <p className="font-display text-sm text-neon-amber/90">
                      {receipt.amount} {receipt.asset || 'USDC'}
                    </p>

                    <div className="flex items-center gap-2">
                      {status === 'confirmed' && (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono bg-neon-green/10 text-neon-green border border-neon-green/30"
                          title={`Verified on Stellar Horizon${detail?.ledgerSequence ? ` at ledger #${detail.ledgerSequence}` : ''}`}
                        >
                          <CheckCircle2 className="w-3 h-3 text-neon-green" />
                          CONFIRMED{detail?.ledgerSequence ? ` #${detail.ledgerSequence}` : ''}
                        </span>
                      )}

                      {status === 'pending' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/30 animate-pulse">
                          <Loader2 className="w-3 h-3 text-neon-cyan animate-spin" />
                          VERIFYING...
                        </span>
                      )}

                      {status === 'mismatched' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono bg-red-500/10 text-red-400 border border-red-500/30">
                          <AlertTriangle className="w-3 h-3 text-red-400" />
                          MISMATCHED
                        </span>
                      )}

                      {status === 'unverified' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono bg-white/5 text-white/40 border border-white/10">
                          <HelpCircle className="w-3 h-3 text-white/40" />
                          UNVERIFIED
                        </span>
                      )}

                      <span className="font-display text-white/20 uppercase text-[9px]">
                        {receipt.network ? receipt.network.split(':')[1] : 'testnet'}
                      </span>
                    </div>
                  </div>
                </motion.div>
              )
            })
          )}
        </div>
      </motion.div>

      {/* Saved Research — notes & tags (#305) */}
      <SavedResearchPanel />

      {/* Network info */}
      <div className="grid sm:grid-cols-3 gap-3">
        {[
          { label: 'Network',          value: IS_MAINNET ? 'Stellar Mainnet' : 'Stellar Testnet',  sub: STELLAR_NETWORK, color: IS_MAINNET ? '#ffb800' : '#00f5ff' },
          { label: 'Price per query',  value: `${AMOUNT_USDC} USDC`,       sub: `≈ $${AMOUNT_USDC} USD`,    color: '#ffb800' },
          { label: 'Settlement',       value: '~5 seconds',       sub: 'Stellar finality', color: '#39ff14' },
        ].map(({ label, value, sub, color }) => (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="rounded-2xl overflow-hidden"
            style={{ background: 'rgba(6,13,20,0.7)', border: '1px solid rgba(0,245,255,0.1)' }}
          >
            <div className="flex items-center justify-between p-5 border-b border-white/5">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-neon-cyan/40" />
                <span className="font-display text-xs text-white/30 tracking-widest">SEARCH AUDIT LOG</span>
                <span className="font-display text-white/15" style={{ fontSize: '10px' }}>· PERSISTED LOCALLY</span>
              </div>
              <div className="font-display text-[10px] text-white/20 uppercase tracking-wider">
                {receipts.length} RECEIPTS
              </div>
            </div>

            <div className="divide-y divide-white/4">
              {receipts.length === 0 ? (
                <div className="text-center py-10">
                  <Search className="w-8 h-8 text-white/10 mx-auto mb-3" />
                  <p className="font-display text-xs text-white/20 tracking-widest">NO SEARCH RECEIPTS YET</p>
                  <p className="text-white/25 text-sm mt-2">Perform a search to see your payment history</p>
                </div>
              ) : (
                receipts.map((receipt, i) => (
                  <motion.div
                    key={receipt.txHash}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className="flex items-center gap-4 px-5 py-3.5 hover:bg-white/2 transition-colors"
                  >
                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${receipt.network === 'stellar:mainnet' ? 'bg-neon-amber' : 'bg-neon-cyan'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white/70 font-medium truncate">"{receipt.query}"</p>
                      <div className="flex items-center gap-3 mt-1">
                        <a
                          href={explorerTxUrl(receipt.txHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-white/25 hover:text-neon-cyan transition-colors flex items-center gap-1"
                          style={{ fontSize: '10px' }}
                        >
                          {truncateHash(receipt.txHash, 8)} <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                        <span className="text-white/20" style={{ fontSize: '10px' }}>{formatTimeAgo(receipt.timestamp)}</span>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-display text-sm text-neon-amber/80">{receipt.amount} USDC</p>
                      <p className="font-display text-white/15 mt-0.5 uppercase" style={{ fontSize: '9px' }}>
                        {receipt.network.split(':')[1]}
                      </p>
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </motion.div>

          {/* Network info */}
          <div className="grid sm:grid-cols-3 gap-3">
            {[
              { label: 'Network',          value: IS_MAINNET ? 'Stellar Mainnet' : 'Stellar Testnet',  sub: STELLAR_NETWORK, color: IS_MAINNET ? '#ffb800' : '#00f5ff' },
              { label: 'Price per query',  value: `${AMOUNT_USDC} USDC`,       sub: `≈ $${AMOUNT_USDC} USD`,    color: '#ffb800' },
              { label: 'Settlement',       value: '~5 seconds',       sub: 'Stellar finality', color: '#39ff14' },
            ].map(({ label, value, sub, color }) => (
              <motion.div
                key={label}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="rounded-xl p-4 flex items-center gap-3"
                style={{ background: 'rgba(6,13,20,0.6)', border: `1px solid ${color}20` }}
              >
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
                <div>
                  <p className="font-display text-white/25 tracking-wider uppercase" style={{ fontSize: '9px' }}>{label}</p>
                  <p className="font-display text-sm text-white mt-0.5">{value}</p>
                  <p className="font-mono text-white/30 mt-0.5" style={{ fontSize: '10px' }}>{sub}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
