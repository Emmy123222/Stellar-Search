import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { ExternalLink, GitBranch, Globe, Shield, Zap, Server } from 'lucide-react'
import { IS_MAINNET, STELLAR_NETWORK, AMOUNT_USDC, AMOUNT_STROOPS, USDC_CONTRACT, STELLAR_EXPERT_URL, HORIZON_URL } from '../lib/stellar'
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
    desc:  'The @x402/express middleware responds with 402 and an empty JSON body — the payment specification travels base64-encoded in the PAYMENT-REQUIRED response header.',
    code:  `HTTP 402 · PAYMENT-REQUIRED: base64({"x402Version":2,"accepts":[{"amount":"${AMOUNT_STROOPS}","network":"${STELLAR_NETWORK}"}]})`,
  },
  {
    num: '03', icon: Shield, color: '#7dd3fc',
    title: 'Sign Soroban auth entry',
    desc:  'The x402 client signs a Soroban authorization entry via Freighter — no private key exposure. The signed payload goes back on PAYMENT-SIGNATURE (x402 v2); X-PAYMENT is accepted for v1 clients.',
    code:  'signAuthEntry(authEntry) → PAYMENT-SIGNATURE: <base64-payload>',
  },
  {
    num: '04', icon: Server, color: '#39ff14',
    title: 'Settle on Stellar + get results',
    desc:  `OpenZeppelin facilitator verifies the signature, settles ${AMOUNT_USDC} USDC on-chain, and the server returns search results.`,
    code:  'GET /search + PAYMENT-SIGNATURE → 200 OK + results + X-PAYMENT-RESPONSE',
  },
]

/**
 * The paid HTTP endpoints, documented from the shared contract in
 * `src/lib/paramValidation.ts` so the page cannot drift from the server:
 * `count` bounds and the `freshness` enum are the same values the routes
 * validate against.
 */
const getEndpoints = () => [
  {
    method: 'GET', path: '/search', color: '#00f5ff',
    summary: 'Organic web results, with optional AI-suggested follow-up queries.',
    count: '1–20 (default 5)',
    freshness: 'pd · pw · pm',
    fields: 'id, title, url, description, source, relevanceScore, publishedAt?',
    runtimes: 'Express · Vercel · MCP web_search',
    example: `curl --get --data-urlencode 'q=stellar lumens' \\\n  --data-urlencode 'count=5' \\\n  -H "PAYMENT-SIGNATURE: $SIGNED_PAYLOAD" \\\n  http://localhost:3001/search`,
  },
  {
    method: 'GET', path: '/images', color: '#ffb800',
    summary: 'Image results from the Serper images API. No date filter — `freshness` is ignored.',
    count: '1–10 (default 10)',
    freshness: 'not supported',
    fields: 'id, title, imageUrl, thumbnailUrl, sourceUrl, source, width?, height?',
    runtimes: 'Express · MCP image_search (no Vercel route)',
    example: `curl --get --data-urlencode 'q=stellar lumens' \\\n  --data-urlencode 'count=10' \\\n  -H "PAYMENT-SIGNATURE: $SIGNED_PAYLOAD" \\\n  http://localhost:3001/images`,
  },
  {
    method: 'GET', path: '/news', color: '#39ff14',
    summary: 'Recent articles from the Serper news API, optionally limited by age.',
    count: '1–20 (default 10)',
    freshness: 'pd · pw · pm',
    fields: 'id, title, url, snippet, source, publishedAt?, imageUrl?',
    runtimes: 'Express · MCP news_search (no Vercel route)',
    example: `curl --get --data-urlencode 'q=stellar lumens' \\\n  --data-urlencode 'count=10' --data-urlencode 'freshness=pw' \\\n  -H "PAYMENT-SIGNATURE: $SIGNED_PAYLOAD" \\\n  http://localhost:3001/news`,
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
  const reducedMotion = useReducedMotion()
  const { t } = useTranslation('docs')
  const STEPS = getSteps()
  const STACK = getStack()
  const ENDPOINTS = getEndpoints()
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
        <span className="font-display text-xs text-neon-cyan/50 tracking-widest">DOCUMENTATION</span>
        <h1 className="font-display text-3xl sm:text-4xl text-white">HOW IT WORKS</h1>
        <p className="text-white/55 text-lg max-w-2xl leading-relaxed">
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
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg font-display text-xs tracking-wider text-white/55 hover:text-neon-cyan transition-all"
              style={{ border: '1px solid rgba(255,255,255,0.08)' }}
            >
              {label} <ExternalLink className="w-3 h-3" />
            </a>
          ))}
        </div>
      </motion.div>

      {/* Advanced search builder */}
      <section className="space-y-5">
        <div>
          <span className="font-display text-xs text-neon-cyan/35 tracking-widest">ADVANCED SEARCH</span>
          <h2 className="font-display text-2xl text-white mt-1">Query builder</h2>
          <p className="text-white/45 text-sm leading-relaxed mt-2">
            Compose advanced search operators visually. The generated query is editable and length-validated.
          </p>
        </div>

        <div className="rounded-2xl p-5" style={{ background: 'rgba(6,13,20,0.6)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="font-display text-xs text-white/40 tracking-wide" htmlFor="terms">Search terms</label>
              <input
                id="terms"
                type="text"
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                placeholder="e.g. AI agent payments"
                className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-white text-sm focus:outline-none focus:border-neon-cyan/50"
              />
            </div>
            <div className="space-y-1.5">
              <label className="font-display text-xs text-white/40 tracking-wide" htmlFor="site">Site operator</label>
              <input
                id="site"
                type="text"
                value={site}
                onChange={(e) => setSite(e.target.value)}
                placeholder="stellar.org"
                className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-white text-sm focus:outline-none focus:border-neon-cyan/50"
              />
            </div>
            <div className="space-y-1.5">
              <label className="font-display text-xs text-white/40 tracking-wide" htmlFor="filetype">Filetype operator</label>
              <input
                id="filetype"
                type="text"
                value={filetype}
                onChange={(e) => setFiletype(e.target.value)}
                placeholder="pdf"
                className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-white text-sm focus:outline-none focus:border-neon-cyan/50"
              />
            </div>
            <div className="space-y-1.5">
              <label className="font-display text-xs text-white/40 tracking-wide" htmlFor="exclude">Exclude words</label>
              <input
                id="exclude"
                type="text"
                value={exclude}
                onChange={(e) => setExclude(e.target.value)}
                placeholder="tutorial, outdated"
                className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-white text-sm focus:outline-none focus:border-neon-cyan/50"
              />
            </div>
            <label className="flex items-center gap-2 sm:col-span-2 cursor-pointer">
              <input
                type="checkbox"
                checked={exact}
                onChange={(e) => setExact(e.target.checked)}
                className="w-4 h-4 rounded border-white/20 bg-black/30 text-neon-cyan focus:ring-neon-cyan/50"
              />
              <span className="font-display text-xs text-white/50">Exact phrase (wraps in double quotes)</span>
            </label>
          </div>

          <div className="flex flex-wrap gap-3 mt-5">
            <button
              onClick={handleCompose}
              className="px-4 py-2 rounded-lg font-display text-xs tracking-wider text-black bg-neon-cyan hover:opacity-90 transition-opacity"
            >
              Compose query
            </button>
            <button
              onClick={() => { setTerms(''); setSite(''); setFiletype(''); setExclude(''); setExact(false); setQuery(''); setCharCount(0); }}
              className="px-4 py-2 rounded-lg font-display text-xs tracking-wider text-white/40 hover:text-white transition-colors"
              style={{ border: '1px solid rgba(255,255,255,0.1)' }}
            >
              Reset
            </button>
          </div>

          <div className="mt-5">
            <label className="font-display text-xs text-white/40 tracking-wide" htmlFor="query">Generated query</label>
            <textarea
              id="query"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              rows={2}
              placeholder="Your query appears here"
              className="w-full mt-1.5 px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-white text-sm font-mono focus:outline-none focus:border-neon-cyan/50 resize-y"
            />
            <div className="flex justify-between mt-1.5 text-xs font-mono">
              <span style={{ color: charCount > MAX_QUERY_LENGTH ? '#ff4d4d' : 'rgba(255,255,255,0.35)' }}>
                {charCount} / {MAX_QUERY_LENGTH} chars
              </span>
              {charCount > MAX_QUERY_LENGTH && (
                <span style={{ color: '#ff4d4d' }}>Query too long — payment amount unchanged, but results may be truncated.</span>
              )}
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-white/5 text-xs text-white/35 leading-relaxed">
            <span className="font-display text-white/50 tracking-wider">OPERATORS DOCUMENTATION:</span>{' '}
            <code className="font-mono text-neon-cyan/60">site:</code> limit to domain,{' '}
            <code className="font-mono text-neon-cyan/60">filetype:</code> limit to file type,{' '}
            <code className="font-mono text-neon-cyan/60">"exact phrase"</code> for exact match,{' '}
            <code className="font-mono text-neon-cyan/60">-term</code> to exclude. Length-validated client-side before payment.
          </div>
        </div>
      </section>

      {/* x402 payment flow */}
      <section className="space-y-5">
        <div>
          <span className="font-display text-xs text-neon-cyan/55 tracking-widest">THE x402 PROTOCOL</span>
          <h2 className="font-display text-2xl text-white mt-1">Payment flow</h2>
        </div>
        <div className="space-y-3">
          {STEPS.map((step, i) => {
            const Icon = step.icon
            return (
              <motion.div
                key={step.num}
                initial={{ opacity: reducedMotion ? 1 : 0, x: reducedMotion ? 0 : -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={reducedMotion ? { duration: 0 } : { delay: i * 0.08 }}
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
                    <span className="font-display text-xs text-white/45">{step.num}</span>
                    <h3 className="font-display text-sm text-white">{step.title}</h3>
                  </div>
                  <p className="text-white/55 text-sm leading-relaxed mb-3">{step.desc}</p>
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

      {/* Paid endpoints */}
      <section className="space-y-5">
        <div>
          <span className="font-display text-xs text-neon-cyan/35 tracking-widest">PAY-PER-QUERY HTTP API</span>
          <h2 className="font-display text-2xl text-white mt-1">Paid endpoints</h2>
          <p className="text-white/45 text-sm leading-relaxed mt-2 max-w-2xl">
            Three paid endpoints, each {AMOUNT_USDC} USDC ({AMOUNT_STROOPS} stroops) per request. All of them
            share one contract: <code className="font-mono text-xs text-white/60">q</code> is required (1–256
            characters), and <code className="font-mono text-xs text-white/60">count</code> /{' '}
            <code className="font-mono text-xs text-white/60">freshness</code> are validated <em>before</em> any
            payment challenge — an out-of-range or repeated value returns{' '}
            <span className="text-white/60">400</span>, never a 402, so you are never charged for a request the
            server was always going to refuse.
          </p>
        </div>

        <div className="space-y-3">
          {ENDPOINTS.map((ep, i) => (
            <motion.div
              key={ep.path}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="rounded-xl p-5 space-y-3"
              style={{ background: 'rgba(6,13,20,0.6)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="px-2 py-0.5 rounded font-display"
                  style={{ background: `${ep.color}15`, color: ep.color, border: `1px solid ${ep.color}30`, fontSize: '10px' }}
                >
                  {ep.method}
                </span>
                <code className="font-mono text-sm text-white">{ep.path}</code>
                <span className="font-display text-white/25" style={{ fontSize: '10px' }}>
                  {AMOUNT_USDC} USDC
                </span>
              </div>

              <p className="text-white/45 text-sm leading-relaxed">{ep.summary}</p>

              <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
                {[
                  ['count', ep.count],
                  ['freshness', ep.freshness],
                  ['result fields', ep.fields],
                  ['available on', ep.runtimes],
                ].map(([label, value]) => (
                  <div key={label} className="flex gap-2 min-w-0">
                    <dt
                      className="font-display text-white/25 tracking-wider uppercase flex-shrink-0 w-24"
                      style={{ fontSize: '10px', paddingTop: '2px' }}
                    >
                      {label}
                    </dt>
                    <dd className="font-mono text-white/55 break-words min-w-0" style={{ fontSize: '11px' }}>
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>

              <pre
                className="py-2.5 px-3 rounded-lg bg-black/30 border border-white/5 overflow-x-auto"
              >
                <code className="font-mono text-xs whitespace-pre" style={{ color: 'rgba(0,245,255,0.6)' }}>
                  {ep.example}
                </code>
              </pre>
            </motion.div>
          ))}
        </div>

        {/* 402 challenge */}
        <div
          className="rounded-xl p-5 space-y-3"
          style={{ background: 'rgba(6,13,20,0.6)', border: '1px solid rgba(255,184,0,0.18)' }}
        >
          <h3 className="font-display text-sm text-white">The 402 challenge</h3>
          <p className="text-white/45 text-sm leading-relaxed">
            An unpaid request returns <span className="text-white/60">402</span> with an <em>empty JSON body</em>.
            The challenge itself is base64-encoded in the{' '}
            <code className="font-mono text-xs text-white/60">PAYMENT-REQUIRED</code> response header, which is
            listed in <code className="font-mono text-xs text-white/60">Access-Control-Expose-Headers</code> so
            browser clients can read it cross-origin. Decode it, sign{' '}
            <code className="font-mono text-xs text-white/60">accepts[0]</code>, and retry with the payload on{' '}
            <code className="font-mono text-xs text-white/60">PAYMENT-SIGNATURE</code>. The settlement receipt
            comes back on <code className="font-mono text-xs text-white/60">X-PAYMENT-RESPONSE</code> and is
            echoed into the body as <code className="font-mono text-xs text-white/60">txHash</code>.
          </p>
          <pre className="py-2.5 px-3 rounded-lg bg-black/30 border border-white/5 overflow-x-auto">
            <code className="font-mono text-xs whitespace-pre" style={{ color: 'rgba(255,184,0,0.65)' }}>
{`{
  "x402Version": 2,
  "error": "Payment required",
  "accepts": [{
    "scheme": "exact",
    "network": "${STELLAR_NETWORK}",
    "amount": "${AMOUNT_STROOPS}",
    "asset": "${USDC_CONTRACT}",
    "payTo": "G...",
    "maxTimeoutSeconds": 300
  }]
}`}
            </code>
          </pre>
          <p className="text-white/35 text-xs leading-relaxed">
            Each signed payload is single-use — replaying one inside its validity window returns 402{' '}
            <code className="font-mono">Payment payload already consumed</code>. The{' '}
            <code className="font-mono">asset</code> is always a Soroban <code className="font-mono">C…</code>{' '}
            contract address, never <code className="font-mono">USDC:ISSUER</code>, and{' '}
            <code className="font-mono">amount</code> is always in stroops.
          </p>
        </div>
      </section>

      {/* Real stack */}
      <section className="space-y-5">
        <div>
          <span className="font-display text-xs text-neon-cyan/55 tracking-widest">REAL STACK — NO MOCKS</span>
          <h2 className="font-display text-2xl text-white mt-1">Technology used</h2>
        </div>
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
          {STACK.map(({ label, value, href }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: reducedMotion ? 1 : 0 }}
              animate={{ opacity: 1 }}
              transition={reducedMotion ? { duration: 0 } : { delay: i * 0.04 }}
              className="flex items-center justify-between py-3.5 px-5 group"
              style={{
                borderBottom: i < STACK.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                background: 'rgba(6,13,20,0.5)',
              }}
            >
              <span className="font-display text-white/50 tracking-wider w-44 flex-shrink-0 uppercase" style={{ fontSize: '10px' }}>
                {label}
              </span>
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-white/65 hover:text-neon-cyan transition-colors"
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
        initial={{ opacity: reducedMotion ? 1 : 0, y: reducedMotion ? 0 : 16 }}
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
            <p className="text-white/55 text-sm leading-relaxed">
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
