import { motion } from 'framer-motion'
import { useState, useEffect, useMemo } from 'react'
import { ExternalLink, Activity, BarChart2, RefreshCw, History, Search } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { IS_MAINNET, STELLAR_NETWORK, AMOUNT_USDC, STELLAR_EXPERT_URL, truncateHash, formatTimeAgo, explorerTxUrl, explorerAccountUrl } from '../lib/stellar'
import type { StellarTransaction } from '../hooks/useFreighterWallet'
import type { SearchReceipt } from '../types'

interface Props {
  transactions: StellarTransaction[]
  txLoading: boolean
  publicKey: string | null
  usdcBalance: string
  xlmBalance: string
  onRefresh: () => void
}

export function DashboardPage({ transactions, txLoading, publicKey, usdcBalance, xlmBalance, onRefresh }: Props) {
  const [receipts, setReceipts] = useState<SearchReceipt[]>([])

  useEffect(() => {
    const raw = localStorage.getItem('stellarsearch_receipts')
    if (raw) {
      try {
        setReceipts(JSON.parse(raw))
      } catch (e) {
        console.error('Failed to parse receipts:', e)
      }
    }
  }, [])

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
            onClick={onRefresh}
            disabled={txLoading}
            className="p-2 rounded-lg border border-white/10 text-white/30 hover:text-neon-cyan transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`w-4 h-4 ${txLoading ? 'animate-spin' : ''}`} />
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

      {/* Live transactions from Horizon */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="rounded-2xl overflow-hidden"
        style={{ background: 'rgba(6,13,20,0.7)', border: '1px solid rgba(255,255,255,0.07)' }}
      >
        <div className="flex items-center justify-between p-5 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-neon-cyan/40" />
            <span className="font-display text-xs text-white/30 tracking-widest">LIVE TRANSACTION HISTORY</span>
            <span className="font-display text-white/15" style={{ fontSize: '10px' }}>· FROM STELLAR HORIZON</span>
          </div>
          <a
            href={STELLAR_EXPERT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 font-display text-xs text-white/20 hover:text-neon-cyan transition-colors"
          >
            EXPLORER <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        <div className="divide-y divide-white/4">
          {txLoading ? (
            <div className="flex justify-center py-10">
              <motion.div
                className="w-6 h-6 rounded-full border-2 border-neon-cyan/30 border-t-neon-cyan"
                animate={{ rotate: 360 }}
                transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
              />
            </div>
          ) : transactions.length === 0 ? (
            <div className="text-center py-10">
              <BarChart2 className="w-8 h-8 text-white/10 mx-auto mb-3" />
              <p className="font-display text-xs text-white/20 tracking-widest">NO TRANSACTIONS YET</p>
              {!publicKey && <p className="text-white/25 text-sm mt-2">Connect your wallet to see your history</p>}
            </div>
          ) : (
            transactions.map((tx, i) => (
              <motion.div
                key={tx.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
                className="flex items-center gap-4 px-5 py-3.5 hover:bg-white/2 transition-colors"
              >
                <div className="w-1.5 h-1.5 rounded-full bg-neon-green flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-white/60 capitalize truncate">{tx.type.replace('_', ' ')}</p>
                    {tx.memo && (
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-neon-cyan/10 text-neon-cyan/70 border border-neon-cyan/20 truncate max-w-[180px]"
                        title={`Memo: ${tx.memo}`}
                      >
                        Memo: {tx.memo}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <a
                      href={explorerTxUrl(tx.hash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-white/25 hover:text-neon-cyan transition-colors flex items-center gap-1"
                      style={{ fontSize: '10px' }}
                    >
                      {truncateHash(tx.hash, 6)} <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                    <span className="text-white/20" style={{ fontSize: '10px' }}>{formatTimeAgo(tx.timestamp)}</span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-display text-sm text-white/60">{tx.amount} {tx.asset}</p>
                  <p className="font-display text-neon-green/50 mt-0.5" style={{ fontSize: '9px' }}>CONFIRMED</p>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </motion.div>

      {/* Search Audit Log */}
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
    </div>
  )
}
