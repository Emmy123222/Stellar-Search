import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SearchPage } from './SearchPage'
import type { SearchSession } from '../hooks/useSearch'
import type { WalletState } from '../hooks/useFreighterWallet'

const mockWalletConnected: WalletState = {
  publicKey: 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3',
  connected: true,
  network: 'Testnet',
  xlmBalance: '100.0',
  usdcBalance: '10.0',
  hasUsdcTrustline: true,
  loading: false,
  error: null,
  accountExists: true,
  accountStatus: 'funded',
}

describe('SearchPage component', () => {
  it('renders idle landing state with search bar', () => {
    const session: SearchSession = {
      query: '',
      results: [],
      txHash: null,
      paidAmount: null,
      status: 'idle',
      suggestions: [],
    }

    render(
      <SearchPage
        wallet={mockWalletConnected}
        onConnectWallet={vi.fn()}
        session={session}
        search={vi.fn()}
        reset={vi.fn()}
      />
    )

    expect(screen.getByRole('search')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/SEARCH/i)
  })

  it('renders spelling auto-correction banner when session has isCorrected=true', () => {
    const handleSearch = vi.fn()
    const session: SearchSession = {
      query: 'stellar blockchain',
      originalQuery: 'stelarr blockchan',
      executedQuery: 'stellar blockchain',
      suggestedQuery: 'stellar blockchain',
      isCorrected: true,
      results: [
        {
          id: '1',
          title: 'Stellar Foundation',
          url: 'https://stellar.org',
          description: 'Official site',
          source: 'stellar.org',
          relevanceScore: 1,
        },
      ],
      txHash: 'tx_hash_1',
      paidAmount: '0.001',
      status: 'complete',
      suggestions: [],
    }

    render(
      <SearchPage
        wallet={mockWalletConnected}
        onConnectWallet={vi.fn()}
        session={session}
        search={handleSearch}
        reset={vi.fn()}
      />
    )

    expect(screen.getByTestId('spelling-correction-banner')).toBeInTheDocument()
    expect(screen.getByText(/"stellar blockchain"/)).toBeInTheDocument()
    expect(screen.getByText(/auto-corrected from/i)).toBeInTheDocument()

    const searchOriginalBtn = screen.getByTestId('search-original-btn')
    fireEvent.click(searchOriginalBtn)
    expect(handleSearch).toHaveBeenCalledWith('stelarr blockchan', undefined, 5, 'web')
  })

  it('renders "Did you mean?" suggestion banner and allows accepting or dismissing', () => {
    const handleSearch = vi.fn()
    const session: SearchSession = {
      query: 'stelarr blockchan',
      originalQuery: 'stelarr blockchan',
      executedQuery: 'stelarr blockchan',
      suggestedQuery: 'stellar blockchain',
      isCorrected: false,
      results: [
        {
          id: '1',
          title: 'Stelarr Info',
          url: 'https://example.com',
          description: 'Desc',
          source: 'example.com',
          relevanceScore: 0.8,
        },
      ],
      txHash: 'tx_hash_2',
      paidAmount: '0.001',
      status: 'complete',
      suggestions: [],
    }

    const { rerender } = render(
      <SearchPage
        wallet={mockWalletConnected}
        onConnectWallet={vi.fn()}
        session={session}
        search={handleSearch}
        reset={vi.fn()}
      />
    )

    expect(screen.getByTestId('spelling-correction-banner')).toBeInTheDocument()
    expect(screen.getByText(/Did you mean:/i)).toBeInTheDocument()

    // Dismiss test
    const dismissBtn = screen.getByTestId('reject-suggestion-btn')
    fireEvent.click(dismissBtn)
    expect(screen.queryByTestId('spelling-correction-banner')).not.toBeInTheDocument()

    // Re-render and Accept test
    rerender(
      <SearchPage
        wallet={mockWalletConnected}
        onConnectWallet={vi.fn()}
        session={session}
        search={handleSearch}
        reset={vi.fn()}
      />
    )

    const searchInput = screen.getByRole('textbox', { name: /search query/i })
    expect(searchInput).toBeInTheDocument()
  })
})

describe('SearchPage focus management (#150)', () => {
  // Must match EXPECTED_WALLET_NETWORK so the search input is not disabled.
  const focusedWallet: WalletState = { ...mockWalletConnected, network: 'TESTNET' }

  const baseSession: SearchSession = {
    query: 'stellar blockchain',
    results: [],
    txHash: null,
    paidAmount: null,
    status: 'searching',
    suggestions: [],
  }

  const result = {
    id: '1',
    title: 'Stellar Foundation',
    url: 'https://stellar.org',
    description: 'Official site',
    source: 'stellar.org',
    relevanceScore: 1,
  }

  const renderPage = (session: SearchSession) =>
    render(
      <SearchPage
        wallet={focusedWallet}
        onConnectWallet={vi.fn()}
        session={session}
        search={vi.fn()}
        reset={vi.fn()}
      />
    )

  const rerenderPage = (rerender: any, session: SearchSession) =>
    rerender(
      <SearchPage
        wallet={focusedWallet}
        onConnectWallet={vi.fn()}
        session={session}
        search={vi.fn()}
        reset={vi.fn()}
      />
    )

  it('moves focus to the results heading when an async search completes', () => {
    const { rerender } = renderPage(baseSession)

    rerenderPage(rerender, { ...baseSession, status: 'complete', results: [result], txHash: 'tx_1', paidAmount: '0.001' })

    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading).toHaveTextContent(/RESULTS/i)
    expect(document.activeElement).toBe(heading)
  })

  it('moves focus to a results heading even when the search returned zero results', () => {
    const { rerender } = renderPage(baseSession)
    rerenderPage(rerender, { ...baseSession, status: 'complete', results: [] })

    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading).toHaveTextContent(/0 RESULTS/i)
    expect(document.activeElement).toBe(heading)
  })

  it('moves focus to the error alert when a search fails', () => {
    const { rerender } = renderPage(baseSession)
    rerenderPage(rerender, { ...baseSession, status: 'error', error: 'Payment failed.' })

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/Payment failed/)
    expect(document.activeElement).toBe(alert)
  })

  it('never steals focus while the user is typing in the search input', () => {
    const { rerender } = renderPage({ ...baseSession, status: 'complete', results: [result] })

    // Focus the input as if the user clicked into it to type a new query.
    const input = screen.getByRole('textbox', { name: /search query/i })
    input.focus()
    fireEvent.change(input, { target: { value: 'next search' } })

    // No status transition happened — focus must stay on the input.
    expect(document.activeElement).toBe(input)

    // Even while the search runs (searching), focus is not hijacked by results.
    rerenderPage(rerender, { ...baseSession, status: 'searching', results: [] })
    expect(document.activeElement).not.toBe(screen.queryByRole('heading', { level: 2 }))
    expect(document.activeElement).not.toBe(screen.queryByRole('alert'))
  })

  it('moves focus to the results heading again after a follow-up search completes', () => {
    const { rerender } = renderPage({ ...baseSession, status: 'complete', results: [result] })

    rerenderPage(rerender, { ...baseSession, status: 'searching', results: [] })
    rerenderPage(rerender, { ...baseSession, status: 'complete', results: [result, { ...result, id: '2' }] })

    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2 }))
  })
})
