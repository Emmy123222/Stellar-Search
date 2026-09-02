import { lazy, Suspense, useEffect, useState, useMemo } from 'react'
import { motion, AnimatePresence }             from 'framer-motion'
import { AnimatedBackground, Navbar, LiveTicker, Footer } from './components/layout'
import { OnboardingFlow, shouldAutoOpenOnboarding } from './components/onboarding'
import { SearchPage, DocsPage, DashboardPage } from './pages'
import { useFreighterWallet, useSearch }       from './hooks'
import { clearOnboardingDismissed }            from './lib/onboarding'
import { Toaster }                             from 'sonner'

const GroqAssistant = lazy(() =>
  import('./components/ai/GroqAssistant').then(m => ({ default: m.GroqAssistant })),
)

type Page = 'search' | 'docs' | 'dashboard'

export default function App() {
  const [page, setPage] = useState<Page>('search')

  const {
    wallet, transactions, txLoading,
    connect, disconnect, refresh,
  } = useFreighterWallet()

  // First-run onboarding (#342): auto-opens once per browser (unless
  // already dismissed or already fully set up), and can always be reopened
  // via Navbar's "Setup Guide" button.
  const [showOnboarding, setShowOnboarding] = useState(false)
  useEffect(() => {
    if (shouldAutoOpenOnboarding(wallet)) setShowOnboarding(true)
    // Intentionally checked once on mount only — re-running this on every
    // wallet change would re-open the guide the instant a step regresses
    // (e.g. disconnecting), which isn't the "first run" behavior we want.
  }, [])

  const reopenOnboarding = () => {
    clearOnboardingDismissed()
    setShowOnboarding(true)
  }

  // Lifted so the floating GroqAssistant can read the last completed search
  // and pre-populate context (issue #57).
  const { session, search, reset } = useSearch(
    wallet.connected ? wallet.publicKey : null
  )

  const lastSearch = useMemo(
    () => session.status === 'complete' && session.results.length
      ? { query: session.query, results: session.results }
      : null,
    [session.status, session.query, session.results],
  )

  return (
    <div className="min-h-screen relative text-white">
      {/* Canvas particle / matrix background */}
      <AnimatedBackground />

      <div className="relative z-10 flex flex-col min-h-screen">

        {/* Top navigation bar */}
        <Navbar
          page={page}
          onNavigate={setPage}
          wallet={wallet}
          transactions={transactions}
          txLoading={txLoading}
          onConnect={connect}
          onDisconnect={disconnect}
          onRefresh={refresh}
          onOpenOnboarding={reopenOnboarding}
        />

        {/* Scrolling stats ticker */}
        <LiveTicker walletConnected={wallet.connected} />

        {/* Page content */}
        <main className="flex-1">
          <AnimatePresence mode="wait">
            <motion.div
              key={page}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              {page === 'search' && (
                <SearchPage
                  wallet={wallet}
                  onConnectWallet={connect}
                  session={session}
                  search={search}
                  reset={reset}
                />
              )}
              {page === 'docs' && <DocsPage />}
              {page === 'dashboard' && (
                <DashboardPage
                  transactions={transactions}
                  txLoading={txLoading}
                  publicKey={wallet.publicKey}
                  usdcBalance={wallet.usdcBalance}
                  xlmBalance={wallet.xlmBalance}
                  onRefresh={refresh}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </main>

        {/* Footer */}
        <Footer />
      </div>

      {/* Floating Groq AI assistant — lazy-loaded on first render */}
      <Suspense fallback={
        <div className="fixed bottom-6 right-6 z-40 w-12 h-12 rounded-full flex items-center justify-center"
          style={{ background: 'rgba(0,245,255,0.15)', border: '1px solid rgba(0,245,255,0.4)' }}>
          <motion.div className="w-2 h-2 rounded-full bg-neon-cyan"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 0.8, repeat: Infinity }} />
        </div>
      }>
        <GroqAssistant lastSearch={lastSearch} />
      </Suspense>

      <Toaster position="bottom-right" theme="dark" duration={4000} richColors />

      <OnboardingFlow
        wallet={wallet}
        onConnectWallet={connect}
        open={showOnboarding}
        onOpenChange={setShowOnboarding}
      />
    </div>
  )
}
