import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Search, BookOpen, BarChart2, ExternalLink, Zap, Github, Globe, HelpCircle } from 'lucide-react'
import { WalletPanel } from '../wallet/WalletPanel'
import type { WalletState, StellarTransaction } from '../../hooks/useFreighterWallet'
import { IS_MAINNET } from '../../lib/stellar'

type Page = 'search' | 'docs' | 'dashboard'

const NAV_ITEMS: { id: Page; labelKey: string; Icon: React.FC<{ className?: string }> }[] = [
  { id: 'search',    labelKey: 'nav.search',    Icon: Search    },
  { id: 'docs',      labelKey: 'nav.docs',      Icon: BookOpen  },
  { id: 'dashboard', labelKey: 'nav.dashboard', Icon: BarChart2 },
]

interface Props {
  page: Page
  onNavigate: (p: Page) => void
  wallet: WalletState
  transactions: StellarTransaction[]
  txLoading: boolean
  onConnect: () => void
  onDisconnect: () => void
  onRefresh: () => void
  onOpenOnboarding: () => void
}

export function Navbar({
  page, onNavigate,
  wallet, transactions, txLoading,
  onConnect, onDisconnect, onRefresh,
  onOpenOnboarding,
}: Props) {
  const { t } = useTranslation('common')

  return (
    <header
      className="sticky top-0 z-40 border-b border-white/5"
      style={{ background: 'rgba(2,4,8,0.85)', backdropFilter: 'blur(16px)' }}
    >
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-5">

        {/* Logo */}
        <button
          onClick={() => onNavigate('search')}
          className="flex items-center gap-2 flex-shrink-0 group"
        >
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
            style={{ background: 'rgba(0,245,255,0.12)', border: '1px solid rgba(0,245,255,0.35)' }}
          >
            <Zap className="w-3.5 h-3.5 text-neon-cyan" />
          </div>
          <span className="font-display text-sm text-white tracking-wider">
            STELLAR<span className="text-neon-cyan">SEARCH</span>
          </span>
        </button>

        {/* Network Badge */}
        <div 
          className={`hidden md:flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] font-display tracking-widest ${
            IS_MAINNET 
              ? 'bg-neon-amber/10 border-neon-amber/30 text-neon-amber' 
              : 'bg-neon-cyan/10 border-neon-cyan/30 text-neon-cyan'
          }`}
        >
          <Globe className="w-2.5 h-2.5" />
          {IS_MAINNET ? 'MAINNET' : 'TESTNET'}
        </div>

        {/* Nav links */}
        <nav className="flex items-center gap-1 flex-1" role="navigation" aria-label="Main navigation">
          {NAV_ITEMS.map(({ id, labelKey, Icon }) => (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              aria-current={page === id ? "page" : undefined}
              className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-display text-xs tracking-wider transition-colors"
              style={{ color: page === id ? '#00f5ff' : 'rgba(255,255,255,0.3)' }}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t(labelKey)}</span>
              {page === id && (
                <motion.div
                  layoutId="nav-active"
                  className="absolute inset-0 rounded-lg"
                  style={{
                    background: 'rgba(0,245,255,0.08)',
                    border: '1px solid rgba(0,245,255,0.15)',
                  }}
                  transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
                />
              )}
            </button>
          ))}
        </nav>

        {/* Right actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={onOpenOnboarding}
            aria-label={t('nav.setupGuide')}
            title={t('nav.setupGuide')}
            className="p-2 rounded-lg text-white/25 hover:text-white/55 hover:bg-white/5 transition-all"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
          <a
            href="https://github.com/stellar/x402-stellar"
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-lg text-white/25 hover:text-white/55 hover:bg-white/5 transition-all"
          >
            <Github className="w-4 h-4" />
          </a>
          <a
            href="https://developers.stellar.org/docs/build/agentic-payments/x402"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-display text-xs text-white/25 hover:text-white/50 transition-all"
            style={{ border: '1px solid rgba(255,255,255,0.08)' }}
          >
            x402 DOCS <ExternalLink className="w-3 h-3" />
          </a>
          <WalletPanel
            wallet={wallet}
            transactions={transactions}
            txLoading={txLoading}
            onConnect={onConnect}
            onDisconnect={onDisconnect}
            onRefresh={onRefresh}
          />
        </div>
      </div>
    </header>
  )
}
