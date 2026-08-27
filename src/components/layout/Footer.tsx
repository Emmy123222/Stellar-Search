import { Zap } from 'lucide-react'
import { STELLAR_EXPERT_URL, IS_MAINNET } from '../../lib/stellar'

const LINKS = [
  { label: 'x402.org', href: 'https://x402.org' },
  { label: 'Stellar Docs', href: 'https://developers.stellar.org' },
  { label: `${IS_MAINNET ? 'Mainnet' : 'Testnet'} Explorer`, href: STELLAR_EXPERT_URL },
  { label: 'Freighter', href: 'https://freighter.app' },
]

export function Footer() {
  return (
    <footer className="border-t border-white/4 py-5">
      <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div
            className="w-5 h-5 rounded flex items-center justify-center"
            style={{ background: 'rgba(0,245,255,0.1)', border: '1px solid rgba(0,245,255,0.25)' }}
          >
            <Zap className="w-2.5 h-2.5 text-neon-cyan" />
          </div>
          <span className="font-display text-xs text-white/20">
            STELLARSEARCH · Stellar Hackathon 2026
          </span>
        </div>
        <div className="flex items-center gap-5">
          {LINKS.map(({ label, href }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-display text-xs text-white/20 hover:text-neon-cyan/60 transition-colors hidden sm:inline"
            >
              {label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  )
}
