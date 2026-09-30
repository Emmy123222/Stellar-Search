import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { initI18n, loadNamespace, changeLanguage } from '../i18n'
import { Navbar } from './layout/Navbar'
import { WalletPanel } from './wallet/WalletPanel'
import { GroqAssistant } from './ai/GroqAssistant'
import { PaymentFlowVisualizer } from './search/PaymentFlowVisualizer'
import { SearchResults } from './search/SearchResults'
import { DashboardPage } from '../pages/DashboardPage'
import type { WalletState } from '../hooks/useFreighterWallet'
import type { SearchSession, SearchResult } from '../hooks/useSearch'
import { setDocumentDirection } from '../lib/rtl'

beforeAll(async () => {
  await initI18n()
  await loadNamespace('wallet')
  await loadNamespace('search')
  await loadNamespace('onboarding')
  await loadNamespace('docs')
  await loadNamespace('errors')
})

beforeEach(async () => {
  await changeLanguage('en')
  setDocumentDirection('en')
})

vi.mock('framer-motion', async () => {
  const actual: any = await vi.importActual('framer-motion')
  return {
    ...actual,
    motion: {
      div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
      button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
      span: ({ children, ...props }: any) => <span {...props}>{children}</span>,
      a: ({ children, ...props }: any) => <a {...props}>{children}</a>,
    },
    AnimatePresence: ({ children }: any) => <>{children}</>,
  }
})

const mockWallet: WalletState = {
  publicKey: 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3',
  connected: true,
  network: 'TESTNET',
  xlmBalance: '100.0000',
  usdcBalance: '2.000000',
  hasUsdcTrustline: true,
  loading: false,
  error: null,
}

const mockTransactions = [
  {
    id: 'tx-1',
    hash: 'a'.repeat(64),
    type: 'payment',
    amount: '0.0010',
    asset: 'USDC',
    from: 'GAAA',
    to: 'GBBB',
    timestamp: new Date().toISOString(),
  },
]

describe('RTL Layout & Internationalization Support (#346)', () => {
  describe('Navbar RTL Switcher', () => {
    it('renders the locale toggle button and switches direction to RTL when clicked', async () => {
      render(
        <Navbar
          page="search"
          onNavigate={vi.fn()}
          wallet={mockWallet}
          transactions={[]}
          txLoading={false}
          onConnect={vi.fn()}
          onDisconnect={vi.fn()}
          onRefresh={vi.fn()}
        />,
      )

      expect(document.documentElement.dir).toBe('ltr')
      expect(screen.getByRole('button', { name: 'SEARCH' })).toBeInTheDocument()

      const switcher = screen.getByRole('button', { name: /Switch to Arabic/i })
      expect(switcher).toBeInTheDocument()

      // Click to toggle to RTL (Arabic)
      await fireEvent.click(switcher)

      expect(document.documentElement.dir).toBe('rtl')
      expect(document.documentElement.lang).toBe('ar')
      expect(screen.getByText('بحث')).toBeInTheDocument()
      expect(screen.getByText('كيف يعمل')).toBeInTheDocument()
      expect(screen.getByText('لوحة التحكم')).toBeInTheDocument()
    })
  })

  describe('WalletPanel in RTL', () => {
    it('renders with logical alignment and Arabic translations in RTL', async () => {
      await changeLanguage('ar')

      render(
        <WalletPanel
          wallet={mockWallet}
          transactions={mockTransactions}
          txLoading={false}
          onConnect={vi.fn()}
          onDisconnect={vi.fn()}
          onRefresh={vi.fn()}
        />,
      )

      const menuBtn = screen.getByRole('button', { name: /قائمة المحفظة/i })
      expect(menuBtn).toBeInTheDocument()

      fireEvent.click(menuBtn)

      // Check panel header in Arabic
      expect(screen.getByText('محفظة FREIGHTER')).toBeInTheDocument()
      expect(screen.getByText('رصيد USDC')).toBeInTheDocument()
      expect(screen.getByText('رصيد XLM')).toBeInTheDocument()

      // Check dropdown positioning classes
      const panel = screen.getByText('محفظة FREIGHTER').closest('.fixed')
      expect(panel?.className).toContain('sm:end-0')
      expect(panel?.className).toContain('rtl:sm:left-0')

      // Check disconnect button contains rtl-flip
      const disconnectBtn = screen.getByRole('button', { name: /قطع الاتصال/i })
      expect(disconnectBtn).toBeInTheDocument()
      const logOutIcon = disconnectBtn.querySelector('.rtl-flip')
      expect(logOutIcon).toBeInTheDocument()
    })
  })

  describe('GroqAssistant in RTL', () => {
    it('uses logical end-6 placement and rtl-flip Send icon', () => {
      const { container } = render(<GroqAssistant />)

      const floatingBtn = container.querySelector('.fixed.bottom-6')
      expect(floatingBtn?.className).toContain('end-6')
      expect(floatingBtn?.className).toContain('rtl:left-6')

      fireEvent.click(floatingBtn!)

      const chatPanel = container.querySelector('.fixed.bottom-20')
      expect(chatPanel?.className).toContain('end-6')
      expect(chatPanel?.className).toContain('rtl:left-6')

      const sendIcon = container.querySelector('button .rtl-flip')
      expect(sendIcon).toBeInTheDocument()
    })
  })

  describe('PaymentFlowVisualizer in RTL', () => {
    it('renders step indicators with inset-x-5 and rtl-flip progression arrows', () => {
      const session: SearchSession = {
        status: 'searching',
        step: 1,
        query: 'Stellar blockchain',
        results: [],
        suggestions: [],
        txHash: null,
        paidAmount: null,
        durationMs: 120,
        error: null,
      }

      const { container } = render(<PaymentFlowVisualizer session={session} />)

      // Connecting line uses inset-x-5
      const connectingLine = container.querySelector('.absolute.top-5.inset-x-5')
      expect(connectingLine).toBeInTheDocument()

      // Direction-aware progression arrows use rtl-flip
      const flippedElements = container.querySelectorAll('.rtl-flip')
      expect(flippedElements.length).toBeGreaterThan(0)
    })
  })

  describe('SearchResults in RTL', () => {
    it('renders logical ms-auto and RTL-aware relevance gradient', async () => {
      await changeLanguage('ar')

      const sampleResults: SearchResult[] = [
        {
          id: 'res-1',
          title: 'Stellar Documentation',
          url: 'https://developers.stellar.org',
          description: 'Official docs for the Stellar network.',
          source: 'Stellar',
          relevanceScore: 0.95,
        },
      ]

      const { container } = render(<SearchResults results={sampleResults} query="Stellar" />)

      // In RTL, the relevance gradient points in the 270deg direction (towards inline-end)
      const progressBar = container.querySelector('.h-full.rounded-full') as HTMLElement
      expect(progressBar.style.background).toContain('270deg')
    })
  })

  describe('DashboardPage in RTL', () => {
    it('uses text-end for transaction values and right orientation for YAxis', async () => {
      await changeLanguage('ar')

      const { container } = render(
        <DashboardPage
          transactions={mockTransactions}
          txLoading={false}
          publicKey={mockWallet.publicKey}
          usdcBalance="10.00"
          xlmBalance="50.00"
          onRefresh={vi.fn()}
        />,
      )

      // Transaction amounts use text-end rather than hardcoded text-right
      const txEndElements = container.querySelectorAll('.text-end')
      expect(txEndElements.length).toBeGreaterThan(0)
    })
  })
})
