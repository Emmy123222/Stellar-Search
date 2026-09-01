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
  Filter,
  RotateCcw,
  Table as TableIcon,
  ArrowUpDown,
  FileJson,
  FileSpreadsheet,
} from 'lucide-react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import {
  IS_MAINNET,
  STELLAR_NETWORK,
  AMOUNT_USDC,
  STELLAR_EXPERT_URL,
  truncateHash,
  formatTimeAgo,
  explorerTxUrl,
  explorerAccountUrl,
} from '../lib/stellar'
import { SavedResearchPanel } from '../components/search'
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

export type DateFilterOption = 'all' | 'today' | '7d' | '30d' | 'custom'
export type DirectionFilterOption = 'all' | 'in' | 'out'
export type StatusFilterOption = 'all' | 'confirmed' | 'pending' | 'failed'

export function DashboardPage({
  transactions,
  txLoading,
  publicKey,
  usdcBalance,
  xlmBalance,
  onRefresh,
}: Props) {
  const [receipts, setReceipts] = useState<SearchReceipt[]>([])

  // Filter States
  const [dateFilter, setDateFilter] = useState<DateFilterOption>('all')
  const [customStartDate, setCustomStartDate] = useState<string>('')
  const [customEndDate, setCustomEndDate] = useState<string>('')
  const [networkFilter, setNetworkFilter] = useState<string>('all')
  const [directionFilter, setDirectionFilter] = useState<DirectionFilterOption>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilterOption>('all')
  const [endpointFilter, setEndpointFilter] = useState<string>('all')
  const [filterText, setFilterText] = useState<string>('')

  // Accessible View Mode for Chart
  const [chartViewMode, setChartViewMode] = useState<'chart' | 'table'>('chart')
  const [chartSortOrder, setChartSortOrder] = useState<'asc' | 'desc'>('asc')

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

  // Reset all filters
  const handleResetFilters = useCallback(() => {
    setDateFilter('all')
    setCustomStartDate('')
    setCustomEndDate('')
    setNetworkFilter('all')
    setDirectionFilter('all')
    setStatusFilter('all')
    setEndpointFilter('all')
    setFilterText('')
  }, [])

  const hasActiveFilters = useMemo(() => {
    return (
      dateFilter !== 'all' ||
      networkFilter !== 'all' ||
      directionFilter !== 'all' ||
      statusFilter !== 'all' ||
      endpointFilter !== 'all' ||
      filterText.trim().length > 0
    )
  }, [dateFilter, networkFilter, directionFilter, statusFilter, endpointFilter, filterText])

  // Helper date checker
  const matchesDate = useCallback(
    (timestamp: string) => {
      if (dateFilter === 'all') return true
      const date = new Date(timestamp)
      const now = new Date()

      if (dateFilter === 'today') {
        return (
          date.getDate() === now.getDate() &&
          date.getMonth() === now.getMonth() &&
          date.getFullYear() === now.getFullYear()
        )
      }
      if (dateFilter === '7d') {
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        return date >= sevenDaysAgo
      }
      if (dateFilter === '30d') {
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        return date >= thirtyDaysAgo
      }
      if (dateFilter === 'custom') {
        const start = customStartDate ? new Date(customStartDate) : null
        const end = customEndDate ? new Date(customEndDate) : null
        if (start && date < start) return false
        if (end) {
          end.setHours(23, 59, 59, 999)
          if (date > end) return false
        }
        return true
      }
      return true
    },
    [dateFilter, customStartDate, customEndDate]
  )

  // Filtered Receipts
  const filteredReceipts = useMemo(() => {
    return receipts.filter((r) => {
      if (!matchesDate(r.timestamp)) return false

      if (networkFilter !== 'all' && r.network !== networkFilter) return false

      if (endpointFilter !== 'all') {
        const qLower = r.query.toLowerCase()
        if (endpointFilter === 'news' && !qLower.startsWith('/news') && !qLower.includes('news:'))
          return false
        if (
          endpointFilter === 'images' &&
          !qLower.startsWith('/images') &&
          !qLower.includes('image:')
        )
          return false
        if (
          endpointFilter === 'search' &&
          (qLower.startsWith('/news') || qLower.startsWith('/images'))
        )
          return false
      }

      if (filterText.trim()) {
        const search = filterText.toLowerCase()
        const matchQuery = r.query.toLowerCase().includes(search)
        const matchHash = r.txHash.toLowerCase().includes(search)
        if (!matchQuery && !matchHash) return false
      }

      return true
    })
  }, [receipts, matchesDate, networkFilter, endpointFilter, filterText])

  // Filtered Transactions
  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      if (!matchesDate(tx.timestamp)) return false

      if (statusFilter !== 'all' && statusFilter !== 'confirmed') return false

      if (endpointFilter !== 'all') {
        if (endpointFilter !== 'payment' && endpointFilter !== 'create_account') {
          if (tx.type !== endpointFilter) return false
        } else if (tx.type !== endpointFilter) {
          return false
        }
      }

      if (directionFilter !== 'all') {
        // Assume default payments are out unless indicated otherwise
        const isIncoming = tx.type === 'create_account'
        if (directionFilter === 'in' && !isIncoming) return false
        if (directionFilter === 'out' && isIncoming) return false
      }

      if (filterText.trim()) {
        const search = filterText.toLowerCase()
        const matchHash = tx.hash.toLowerCase().includes(search)
        const matchMemo = (tx.memo || '').toLowerCase().includes(search)
        const matchType = tx.type.toLowerCase().includes(search)
        if (!matchHash && !matchMemo && !matchType) return false
      }

      return true
    })
  }, [transactions, matchesDate, statusFilter, endpointFilter, directionFilter, filterText])

  // Chart Data
  const chartData = useMemo(() => {
    const usdcTxs = filteredTransactions.filter((tx) => tx.asset === 'USDC')
    const sortedTxs = [...usdcTxs].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )

    const grouped = sortedTxs.reduce((acc, tx) => {
      const date = new Date(tx.timestamp).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      })
      if (!acc[date]) acc[date] = 0
      acc[date] += parseFloat(tx.amount)
      return acc
    }, {} as Record<string, number>)

    const items = Object.entries(grouped).map(([date, amount]: [string, number]) => ({
      date,
      amount: parseFloat(amount.toFixed(4)),
    }))

    if (chartSortOrder === 'desc') {
      return [...items].reverse()
    }
    return items
  }, [filteredTransactions, chartSortOrder])

  // Export JSON
  const handleExportJSON = () => {
    const exportData = {
      schemaVersion: '1.0.0',
      exportedAt: new Date().toISOString(),
      metadata: {
        accountPublicKey: publicKey,
        network: STELLAR_NETWORK,
        filtersApplied: {
          dateFilter,
          customStartDate,
          customEndDate,
          networkFilter,
          directionFilter,
          statusFilter,
          endpointFilter,
          filterText,
        },
        totalReceipts: filteredReceipts.length,
        totalTransactions: filteredTransactions.length,
      },
      receipts: filteredReceipts,
      transactions: filteredTransactions,
    }

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `stellar-search-audit-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Export CSV
  const handleExportCSV = () => {
    const csvRows: string[] = []

    // Header Metadata
    csvRows.push(`# StellarSearch Export — Generated ${new Date().toISOString()}`)
    csvRows.push(`# Account: ${publicKey || 'Disconnected'} | Network: ${STELLAR_NETWORK}`)
    csvRows.push('')

    // Receipts Section
    csvRows.push('--- SEARCH RECEIPTS ---')
    csvRows.push('Timestamp,Query,Amount,Currency,Network,TransactionHash')
    for (const r of filteredReceipts) {
      const cleanQuery = `"${r.query.replace(/"/g, '""')}"`
      csvRows.push(
        `${r.timestamp},${cleanQuery},${r.amount},USDC,${r.network},${r.txHash}`
      )
    }

    csvRows.push('')
    // Transactions Section
    csvRows.push('--- HORIZON TRANSACTIONS ---')
    csvRows.push('ID,Timestamp,Type,Amount,Asset,Memo,TransactionHash')
    for (const tx of filteredTransactions) {
      const cleanMemo = tx.memo ? `"${tx.memo.replace(/"/g, '""')}"` : ''
      csvRows.push(
        `${tx.id},${tx.timestamp},${tx.type},${tx.amount},${tx.asset},${cleanMemo},${tx.hash}`
      )
    }

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `stellar-search-audit-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-10 space-y-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div>
          <span className="font-display text-xs text-neon-cyan/50 tracking-widest">
            LIVE BLOCKCHAIN DATA
          </span>
          <h1 className="font-display text-3xl text-white mt-1">DASHBOARD</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div
              className={`w-1.5 h-1.5 rounded-full animate-pulse ${
                IS_MAINNET ? 'bg-neon-amber' : 'bg-neon-green'
              }`}
            />
            <span
              className={`font-display text-xs tracking-wider ${
                IS_MAINNET ? 'text-neon-amber/60' : 'text-neon-green/60'
              }`}
            >
              {networkLabel}
            </span>
          </div>
          <button
            onClick={onRefresh}
            disabled={txLoading}
            aria-label="Refresh live data"
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
          style={{
            background: 'rgba(6,13,20,0.7)',
            border: '1px solid rgba(0,245,255,0.12)',
          }}
        >
          <div className="flex items-center justify-between mb-4">
            <span className="font-display text-xs text-white/30 tracking-widest">
              YOUR STELLAR ACCOUNT
            </span>
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
              <p
                className="font-display text-xs text-white/30 mb-1"
                style={{ fontSize: '10px' }}
              >
                PUBLIC KEY
              </p>
              <p className="font-mono text-xs text-white/60 break-all leading-relaxed">
                {publicKey}
              </p>
            </div>
            <div
              className="py-3 px-4 rounded-xl text-center"
              style={{
                background: 'rgba(255,184,0,0.05)',
                border: '1px solid rgba(255,184,0,0.15)',
              }}
            >
              <p
                className="font-display text-xs text-white/30 mb-1"
                style={{ fontSize: '10px' }}
              >
                USDC BALANCE
              </p>
              <p className="font-display text-2xl text-neon-amber">{usdcBalance}</p>
              <p className="font-display text-white/25 mt-1" style={{ fontSize: '9px' }}>
                {Math.floor(
                  parseFloat(usdcBalance) / parseFloat(AMOUNT_USDC)
                ).toLocaleString()}{' '}
                queries remaining
              </p>
            </div>
            <div
              className="py-3 px-4 rounded-xl text-center"
              style={{
                background: 'rgba(0,245,255,0.05)',
                border: '1px solid rgba(0,245,255,0.15)',
              }}
            >
              <p
                className="font-display text-xs text-white/30 mb-1"
                style={{ fontSize: '10px' }}
              >
                XLM BALANCE
              </p>
              <p className="font-display text-2xl text-neon-cyan">{xlmBalance}</p>
              <p className="font-display text-white/25 mt-1" style={{ fontSize: '9px' }}>
                for network fees
              </p>
            </div>
          </div>
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-2xl p-8 text-center"
          style={{
            background: 'rgba(6,13,20,0.5)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <p className="font-display text-white/30 text-sm">
            Connect your Freighter wallet to see live account data
          </p>
        </motion.div>
      )}

      {/* Composable Filters & Export Controls Panel */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12 }}
        className="rounded-2xl p-5"
        style={{
          background: 'rgba(6,13,20,0.85)',
          border: '1px solid rgba(0,245,255,0.18)',
        }}
        aria-label="Dashboard Filters and Export Controls"
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4 pb-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-neon-cyan" />
            <span className="font-display text-xs text-neon-cyan tracking-wider font-semibold">
              FILTERS & AUDIT EXPORT
            </span>
          </div>

          <div className="flex items-center gap-2">
            {hasActiveFilters && (
              <button
                onClick={handleResetFilters}
                aria-label="Reset all filters"
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-display text-white/50 hover:text-white hover:bg-white/5 transition-colors border border-white/10"
              >
                <RotateCcw className="w-3 h-3" />
                <span>RESET</span>
              </button>
            )}
            <button
              onClick={handleExportCSV}
              aria-label="Export audit data as CSV"
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-display text-neon-amber hover:bg-neon-amber/10 transition-colors border border-neon-amber/30"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>EXPORT CSV</span>
            </button>
            <button
              onClick={handleExportJSON}
              aria-label="Export audit data as JSON"
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-display text-neon-cyan hover:bg-neon-cyan/10 transition-colors border border-neon-cyan/30"
            >
              <FileJson className="w-3.5 h-3.5" />
              <span>EXPORT JSON</span>
            </button>
          </div>
        </div>

        {/* Filter controls grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 text-xs">
          {/* Search query / hash filter */}
          <div className="col-span-2 sm:col-span-3 md:col-span-2">
            <label htmlFor="filter-search" className="block text-white/40 mb-1 font-mono text-[10px]">
              SEARCH TEXT / HASH
            </label>
            <div className="relative">
              <input
                id="filter-search"
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Filter by query, memo, hash..."
                className="w-full bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder:text-white/20 outline-none focus:border-neon-cyan"
              />
            </div>
          </div>

          {/* Date Filter */}
          <div>
            <label htmlFor="filter-date" className="block text-white/40 mb-1 font-mono text-[10px]">
              DATE RANGE
            </label>
            <select
              id="filter-date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as DateFilterOption)}
              className="w-full bg-black/60 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-neon-cyan"
            >
              <option value="all">All Time</option>
              <option value="today">Today</option>
              <option value="7d">Past 7 Days</option>
              <option value="30d">Past 30 Days</option>
              <option value="custom">Custom Range</option>
            </select>
          </div>

          {/* Network Filter */}
          <div>
            <label htmlFor="filter-network" className="block text-white/40 mb-1 font-mono text-[10px]">
              NETWORK
            </label>
            <select
              id="filter-network"
              value={networkFilter}
              onChange={(e) => setNetworkFilter(e.target.value)}
              className="w-full bg-black/60 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-neon-cyan"
            >
              <option value="all">All Networks</option>
              <option value="stellar:testnet">Testnet</option>
              <option value="stellar:mainnet">Mainnet</option>
            </select>
          </div>

          {/* Direction Filter */}
          <div>
            <label htmlFor="filter-direction" className="block text-white/40 mb-1 font-mono text-[10px]">
              DIRECTION
            </label>
            <select
              id="filter-direction"
              value={directionFilter}
              onChange={(e) => setDirectionFilter(e.target.value as DirectionFilterOption)}
              className="w-full bg-black/60 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-neon-cyan"
            >
              <option value="all">All Directions</option>
              <option value="out">Outgoing (Paid)</option>
              <option value="in">Incoming (Funded)</option>
            </select>
          </div>

          {/* Status / Endpoint Filter */}
          <div>
            <label htmlFor="filter-endpoint" className="block text-white/40 mb-1 font-mono text-[10px]">
              ENDPOINT / TYPE
            </label>
            <select
              id="filter-endpoint"
              value={endpointFilter}
              onChange={(e) => setEndpointFilter(e.target.value)}
              className="w-full bg-black/60 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-neon-cyan"
            >
              <option value="all">All Endpoints</option>
              <option value="search">Web Search</option>
              <option value="news">News Search</option>
              <option value="images">Image Search</option>
              <option value="payment">Horizon Payment</option>
              <option value="create_account">Create Account</option>
            </select>
          </div>
        </div>

        {/* Custom date range inputs */}
        {dateFilter === 'custom' && (
          <div className="flex items-center gap-3 mt-3 pt-3 border-t border-white/5">
            <div>
              <label htmlFor="custom-start-date" className="block text-white/40 mb-1 font-mono text-[10px]">
                START DATE
              </label>
              <input
                id="custom-start-date"
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="bg-black/60 border border-white/10 rounded-lg px-2 py-1 text-xs text-white outline-none focus:border-neon-cyan"
              />
            </div>
            <div>
              <label htmlFor="custom-end-date" className="block text-white/40 mb-1 font-mono text-[10px]">
                END DATE
              </label>
              <input
                id="custom-end-date"
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="bg-black/60 border border-white/10 rounded-lg px-2 py-1 text-xs text-white outline-none focus:border-neon-cyan"
              />
            </div>
          </div>
        )}
      </motion.div>

      {/* USDC Spent Chart & Accessible Table Alternative (Issue #344) */}
      {publicKey && chartData.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="rounded-2xl p-5"
          style={{
            background: 'rgba(6,13,20,0.7)',
            border: '1px solid rgba(255,184,0,0.15)',
          }}
        >
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-neon-amber/40" />
              <span className="font-display text-xs text-white/30 tracking-widest">
                USDC SPENT OVER TIME
              </span>
            </div>

            {/* View Mode Toggle */}
            <div className="flex items-center gap-1 bg-black/40 p-1 rounded-lg border border-white/10">
              <button
                onClick={() => setChartViewMode('chart')}
                aria-label="View as visual chart"
                className={`px-2.5 py-1 rounded text-xs font-display transition-colors ${
                  chartViewMode === 'chart'
                    ? 'bg-neon-amber/20 text-neon-amber border border-neon-amber/40'
                    : 'text-white/40 hover:text-white'
                }`}
              >
                CHART VIEW
              </button>
              <button
                onClick={() => setChartViewMode('table')}
                aria-label="View as accessible tabular data"
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-display transition-colors ${
                  chartViewMode === 'table'
                    ? 'bg-neon-amber/20 text-neon-amber border border-neon-amber/40'
                    : 'text-white/40 hover:text-white'
                }`}
              >
                <TableIcon className="w-3 h-3" />
                <span>TABLE VIEW</span>
              </button>
            </div>
          </div>

          {chartViewMode === 'chart' ? (
            <div className="h-64 w-full" aria-hidden="true">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(255,255,255,0.05)"
                    vertical={false}
                  />
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
                      fontSize: '12px',
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
          ) : (
            /* Accessible Table View (Issue #344) */
            <div className="overflow-x-auto">
              <table
                className="w-full text-left text-xs font-mono"
                aria-label="USDC Spent Over Time Summary Table"
              >
                <caption className="sr-only">
                  USDC Spent Over Time summarized by date
                </caption>
                <thead>
                  <tr className="border-b border-white/10 text-white/40">
                    <th scope="col" className="py-2.5 px-3">
                      <button
                        onClick={() =>
                          setChartSortOrder(chartSortOrder === 'asc' ? 'desc' : 'asc')
                        }
                        className="flex items-center gap-1 hover:text-white"
                        aria-label={`Sort by Date, currently ${chartSortOrder}ending`}
                      >
                        <span>DATE</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th scope="col" className="py-2.5 px-3 text-right">
                      AMOUNT (USDC)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-white/70">
                  {chartData.map((row) => (
                    <tr key={row.date} className="hover:bg-white/5">
                      <td className="py-2.5 px-3">{row.date}</td>
                      <td className="py-2.5 px-3 text-right text-neon-amber font-semibold">
                        {row.amount.toFixed(4)} USDC
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </motion.div>
      )}

      {/* Live transactions from Horizon */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="rounded-2xl overflow-hidden"
        style={{
          background: 'rgba(6,13,20,0.7)',
          border: '1px solid rgba(255,255,255,0.07)',
        }}
      >
        <div className="flex items-center justify-between p-5 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-neon-cyan/40" />
            <span className="font-display text-xs text-white/30 tracking-widest">
              LIVE TRANSACTION HISTORY
            </span>
            <span className="font-display text-white/15" style={{ fontSize: '10px' }}>
              · {filteredTransactions.length} RECORDS
            </span>
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
          ) : filteredTransactions.length === 0 ? (
            <div className="text-center py-10">
              <BarChart2 className="w-8 h-8 text-white/10 mx-auto mb-3" />
              <p className="font-display text-xs text-white/20 tracking-widest">
                NO TRANSACTIONS MATCHING CRITERIA
              </p>
              {hasActiveFilters ? (
                <button
                  onClick={handleResetFilters}
                  className="mt-3 px-3 py-1 text-xs text-neon-cyan border border-neon-cyan/30 rounded-lg hover:bg-neon-cyan/10"
                >
                  Clear Filters
                </button>
              ) : (
                !publicKey && (
                  <p className="text-white/25 text-sm mt-2">
                    Connect your wallet to see your history
                  </p>
                )
              )}
            </div>
          ) : (
            filteredTransactions.map((tx, i) => (
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
                    <p className="text-sm text-white/60 capitalize truncate">
                      {tx.type.replace('_', ' ')}
                    </p>
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
                    <span className="text-white/20" style={{ fontSize: '10px' }}>
                      {formatTimeAgo(tx.timestamp)}
                    </span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-display text-sm text-white/60">
                    {tx.amount} {tx.asset}
                  </p>
                  <p
                    className="font-display text-neon-green/50 mt-0.5"
                    style={{ fontSize: '9px' }}
                  >
                    CONFIRMED
                  </p>
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
        style={{
          background: 'rgba(6,13,20,0.7)',
          border: '1px solid rgba(0,245,255,0.1)',
        }}
      >
        <div className="flex items-center justify-between p-5 border-b border-white/5">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-neon-cyan/40" />
            <span className="font-display text-xs text-white/30 tracking-widest">
              SEARCH AUDIT LOG
            </span>
            <span className="font-display text-white/15" style={{ fontSize: '10px' }}>
              · PERSISTED LOCALLY
            </span>
          </div>
          <div className="font-display text-[10px] text-white/20 uppercase tracking-wider">
            {filteredReceipts.length} RECEIPTS
          </div>
        </div>

        <div className="divide-y divide-white/4">
          {filteredReceipts.length === 0 ? (
            <div className="text-center py-10">
              <Search className="w-8 h-8 text-white/10 mx-auto mb-3" />
              <p className="font-display text-xs text-white/20 tracking-widest">
                NO SEARCH RECEIPTS MATCHING CRITERIA
              </p>
              {hasActiveFilters ? (
                <button
                  onClick={handleResetFilters}
                  className="mt-3 px-3 py-1 text-xs text-neon-cyan border border-neon-cyan/30 rounded-lg hover:bg-neon-cyan/10"
                >
                  Clear Filters
                </button>
              ) : (
                <p className="text-white/25 text-sm mt-2">
                  Perform a search to see your payment history
                </p>
              )}
            </div>
          ) : (
            filteredReceipts.map((receipt, i) => (
              <motion.div
                key={receipt.txHash}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03 }}
                className="flex items-center gap-4 px-5 py-3.5 hover:bg-white/2 transition-colors"
              >
                <div
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    receipt.network === 'stellar:mainnet'
                      ? 'bg-neon-amber'
                      : 'bg-neon-cyan'
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white/70 font-medium truncate">
                    "{receipt.query}"
                  </p>
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
                    <span className="text-white/20" style={{ fontSize: '10px' }}>
                      {formatTimeAgo(receipt.timestamp)}
                    </span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-display text-sm text-neon-amber/80">
                    {receipt.amount} USDC
                  </p>
                  <p
                    className="font-display text-white/15 mt-0.5 uppercase"
                    style={{ fontSize: '9px' }}
                  >
                    {receipt.network.split(':')[1]}
                  </p>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </motion.div>

      {/* Saved Research — notes & tags (#305) */}
      <SavedResearchPanel />

      {/* Network info */}
      <div className="grid sm:grid-cols-3 gap-3">
        {[
          {
            label: 'Network',
            value: IS_MAINNET ? 'Stellar Mainnet' : 'Stellar Testnet',
            sub: STELLAR_NETWORK,
            color: IS_MAINNET ? '#ffb800' : '#00f5ff',
          },
          {
            label: 'Price per query',
            value: `${AMOUNT_USDC} USDC`,
            sub: `≈ $${AMOUNT_USDC} USD`,
            color: '#ffb800',
          },
          {
            label: 'Settlement',
            value: '~5 seconds',
            sub: 'Stellar finality',
            color: '#39ff14',
          },
        ].map(({ label, value, sub, color }) => (
          <motion.div
            key={label}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-xl p-4 flex items-center gap-3"
            style={{
              background: 'rgba(6,13,20,0.6)',
              border: `1px solid ${color}20`,
            }}
          >
            <div
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: color, boxShadow: `0 0 6px ${color}` }}
            />
            <div>
              <p
                className="font-display text-white/25 tracking-wider uppercase"
                style={{ fontSize: '9px' }}
              >
                {label}
              </p>
              <p className="font-display text-sm text-white mt-0.5">{value}</p>
              <p className="font-mono text-white/30 mt-0.5" style={{ fontSize: '10px' }}>
                {sub}
              </p>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
