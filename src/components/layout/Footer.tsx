import { useTranslation } from 'react-i18next'
import { Zap } from 'lucide-react'
import { STELLAR_EXPERT_URL, IS_MAINNET } from '../../lib/stellar'

export function Footer() {
  const { t } = useTranslation('common')

  const links = [
    { label: t('footer.links.x402'),        href: 'https://x402.org' },
    { label: t('footer.links.stellarDocs'), href: 'https://developers.stellar.org' },
    { label: t('footer.links.explorer', { network: IS_MAINNET ? 'Mainnet' : 'Testnet' }), href: STELLAR_EXPERT_URL },
    { label: t('footer.links.freighter'),   href: 'https://freighter.app' },
  ]

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
            {t('footer.tagline')}
          </span>
        </div>
        <div className="flex items-center gap-5">
          {links.map(({ label, href }) => (
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
