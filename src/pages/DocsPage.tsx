import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { ExternalLink, GitBranch, Globe, Shield, Zap, Server } from 'lucide-react'
import { IS_MAINNET, STELLAR_NETWORK, AMOUNT_USDC, STELLAR_EXPERT_URL, HORIZON_URL } from '../lib/stellar'
import { loadNamespace } from '../i18n'

const getSteps = () => [
  {
    num: '01', icon: Globe, color: '#00f5ff',
    title: 'Agent hits /search endpoint',
    desc:  'Any HTTP client sends GET /search?q=query. No API key needed — just a Stellar wallet with USDC.',
    code:  'GET /search?q=AI+agent+payments',
  },
  {
    num: '02', icon: Zap, color: '#ffb800',
    title: 'Server returns HTTP 402',
    desc:  'The @x402/express middleware responds with 402 Payment Required and a payment specification.',
    code:  `HTTP 402 · X-Payment-Required: {"amount":"10000","currency":"USDC","network":"${STELLAR_NETWORK}"}`,
  },
  {
    num: '03', icon: Shield, color: '#7dd3fc',
    title: 'Sign Soroban auth entry',
    desc:  'The x402 client signs a Soroban authorization entry via Freighter — no private key exposure.',
    code:  'signAuthEntry(authEntry) → X-Payment: <base64-sig>',
  },
  {
    num: '04', icon: Server, color: '#39ff14',
    title: 'Settle on Stellar + get results',
    desc:  `OpenZeppelin facilitator verifies the signature, settles ${AMOUNT_USDC} USDC on-chain, and the server returns search results.`,
    code:  'GET /search + X-Payment: <sig> → 200 OK + results',
  },
]

const getStack = () => [
  { label: 'Payment protocol', value: 'x402 (@x402/express + @x402/stellar)',              href: 'https://x402.org' },
  { label: 'Blockchain',       value: IS_MAINNET ? 'Stellar Mainnet' : 'Stellar Testnet',    href: 'https://developers.stellar.org' },
  { label: 'Smart contracts',  value: 'Soroban auth entry signing',                        href: 'https://developers.stellar.org/docs/smart-contracts' },
  { label: 'Facilitator',      value: 'OpenZeppelin x402 (channels.openzeppelin.com)',     href: 'https://docs.openzeppelin.com/relayer/1.4.x/guides/stellar-x402-facilitator-guide' },
  { label: 'Wallet',           value: 'Freighter (@stellar/freighter-api)',                href: 'https://freighter.app' },
  { label: 'Balances / tx',    value: 'Stellar Horizon REST API (live)',                   href: HORIZON_URL },
  { label: 'Search backend',   value: 'Serper.dev API',                                   href: 'https://serper.dev' },
  { label: 'AI assistant',     value: 'Groq (groq-sdk) · Llama 3.3 70B',                  href: 'https://console.groq.com' },
]

export function DocsPage() {
  const { t } = useTranslation('docs')
  const STEPS = getSteps()
  const STACK = getStack()
  const networkLabel = IS_MAINNET ? 'Mainnet' : 'Testnet'

  // `docs` is the one namespace loaded lazily rather than at app boot
  // (#345) — DocsPage is the only place it's needed, so it's only fetched
  // once this page actually mounts. `t()`'s default-value argument covers
  // the render before the namespace resolves, so there's no flash of a
  // raw translation key.
  useEffect(() => {
    loadNamespace('docs')
  }, [])

  return (
    <div className="max-w-4xl mx-auto px-4 py-12 space-y-16">

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
        <span className="font-display text-xs text-neon-cyan/50 tracking-widest">{t('kicker', 'DOCUMENTATION')}</span>
        <h1 className="font-display text-3xl sm:text-4xl text-white">{t('title', 'HOW IT WORKS')}</h1>
        <p className="text-white/45 text-lg max-w-2xl leading-relaxed">
          StellarSearch is a pay-per-query search API for autonomous AI agents. It uses the real x402 protocol
          on Stellar — no mock data, no fake payments. Every search costs {AMOUNT_USDC} USDC settled on-chain.
        </p>
        <div className="flex flex-wrap gap-3 pt-1">
          {[
            { label: 'x402 Docs',        href: 'https://developers.stellar.org/docs/build/agentic-payments/x402' },
            { label: 'GitHub Repo',      href: 'https://github.com/stellar/x402-stellar' },
            { label: `${networkLabel} Explorer`, href: STELLAR_EXPERT_URL },
          ].map(({ label, href }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg font-display text-xs tracking-wider text-white/40 hover:text-neon-cyan transition-all"
              style={{ border: '1px solid rgba(255,255,255,0.08)' }}
            >
              {label} <ExternalLink className="w-3 h-3" />
            </a>
          ))}
        </div>
      </motion.div>

      {/* x402 payment flow */}
      <section className="space-y-5">
        <div>
          <span className="font-display text-xs text-neon-cyan/35 tracking-widest">THE x402 PROTOCOL</span>
          <h2 className="font-display text-2xl text-white mt-1">Payment flow</h2>
        </div>
        <div className="space-y-3">
          {STEPS.map((step, i) => {
            const Icon = step.icon
            return (
              <motion.div
                key={step.num}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.08 }}
                className="flex gap-5 rounded-xl p-5"
                style={{ background: 'rgba(6,13,20,0.6)', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                <div className="flex-shrink-0 flex flex-col items-center gap-2">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center"
                    style={{ background: `${step.color}15`, border: `1px solid ${step.color}30` }}
                  >
                    <Icon className="w-5 h-5" style={{ color: step.color }} />
                  </div>
                  {i < STEPS.length - 1 && <div className="flex-1 w-px bg-white/5 min-h-4" />}
                </div>
                <div className="flex-1 pb-2">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="font-display text-xs text-white/20">{step.num}</span>
                    <h3 className="font-display text-sm text-white">{step.title}</h3>
                  </div>
                  <p className="text-white/45 text-sm leading-relaxed mb-3">{step.desc}</p>
                  <div className="py-2 px-3 rounded-lg bg-black/30 border border-white/5">
                    <code className="font-mono text-xs break-all" style={{ color: 'rgba(0,245,255,0.6)' }}>
                      {step.code}
                    </code>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>
      </section>

      {/* Real stack */}
      <section className="space-y-5">
        <div>
          <span className="font-display text-xs text-neon-cyan/35 tracking-widest">REAL STACK — NO MOCKS</span>
          <h2 className="font-display text-2xl text-white mt-1">Technology used</h2>
        </div>
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
          {STACK.map(({ label, value, href }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.04 }}
              className="flex items-center justify-between py-3.5 px-5 group"
              style={{
                borderBottom: i < STACK.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                background: 'rgba(6,13,20,0.5)',
              }}
            >
              <span className="font-display text-white/25 tracking-wider w-44 flex-shrink-0 uppercase" style={{ fontSize: '10px' }}>
                {label}
              </span>
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-white/55 hover:text-neon-cyan transition-colors"
              >
                {value}
                <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
              </a>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Hackathon note */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl p-6"
        style={{ background: 'rgba(6,13,20,0.7)', border: '1px solid rgba(0,245,255,0.2)' }}
      >
        <div className="flex items-start gap-4">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(0,245,255,0.1)', border: '1px solid rgba(0,245,255,0.3)' }}
          >
            <GitBranch className="w-5 h-5 text-neon-cyan" />
          </div>
          <div className="space-y-2">
            <h3 className="font-display text-sm text-neon-cyan">STELLAR HACKATHON 2026 · AGENTS ON STELLAR</h3>
            <p className="text-white/45 text-sm leading-relaxed">
              Built for the Agents on Stellar hackathon (March 30 – April 13, 2026). Addresses the explicit
              demand signal: pay-per-query web search instead of monthly subscriptions. Uses real x402 protocol,
              real Stellar testnet transactions, real search results, and real Groq AI — zero mock data.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {['x402 Protocol', 'Soroban Auth', 'USDC Micropayments', 'Freighter Wallet', 'Serper.dev', 'Groq AI', 'MCP Server'].map(tag => (
                <span
                  key={tag}
                  className="px-2 py-0.5 rounded-full font-display"
                  style={{ background: 'rgba(0,245,255,0.08)', color: 'rgba(0,245,255,0.6)', border: '1px solid rgba(0,245,255,0.15)', fontSize: '10px' }}
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
