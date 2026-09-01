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
    expect(handleSearch).toHaveBeenCalledWith('stelarr blockchan', undefined)
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
