import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DashboardPage } from './DashboardPage'
import type { StellarTransaction } from '../hooks/useFreighterWallet'

const mockTransactions: StellarTransaction[] = [
  {
    id: 'tx-1',
    hash: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff66667777888899990000',
    type: 'payment',
    amount: '0.0010',
    asset: 'USDC',
    timestamp: new Date().toISOString(),
    memo: 'Search query 1',
  },
  {
    id: 'tx-2',
    hash: 'bbbb2222cccc3333dddd4444eeee5555ffff66667777888899990000aaaa1111',
    type: 'payment',
    amount: '0.0020',
    asset: 'USDC',
    timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    memo: 'News search 2',
  },
]

describe('DashboardPage Filters & Audit Export (Issue #343 & #344)', () => {
  const onRefresh = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.setItem(
      'stellarsearch_receipts',
      JSON.stringify([
        {
          query: 'Stellar blockchain protocol',
          txHash: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff66667777888899990000',
          amount: '0.001',
          timestamp: new Date().toISOString(),
          network: 'stellar:testnet',
        },
      ])
    )
  })

  it('renders filters, export controls, and live account data', () => {
    render(
      <DashboardPage
        transactions={mockTransactions}
        txLoading={false}
        publicKey="GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
        usdcBalance="50.0000"
        xlmBalance="10.0000"
        onRefresh={onRefresh}
      />
    )

    expect(screen.getByText(/FILTERS & AUDIT EXPORT/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /export.*csv/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /export.*json/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/search text \/ hash/i)).toBeInTheDocument()
  })

  it('filters records by search text and shows empty state when no match', () => {
    render(
      <DashboardPage
        transactions={mockTransactions}
        txLoading={false}
        publicKey="GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
        usdcBalance="50.0000"
        xlmBalance="10.0000"
        onRefresh={onRefresh}
      />
    )

    const searchInput = screen.getByLabelText(/search text \/ hash/i)
    fireEvent.change(searchInput, { target: { value: 'nonexistent-query-12345' } })

    expect(screen.getByText(/NO TRANSACTIONS MATCHING CRITERIA/i)).toBeInTheDocument()
    expect(screen.getByText(/NO SEARCH RECEIPTS MATCHING CRITERIA/i)).toBeInTheDocument()

    // Reset filters
    const resetButtons = screen.getAllByRole('button', { name: /clear filters|reset all filters/i })
    expect(resetButtons.length).toBeGreaterThan(0)
    fireEvent.click(resetButtons[0])

    expect(screen.queryByText(/NO TRANSACTIONS MATCHING CRITERIA/i)).not.toBeInTheDocument()
  })

  it('toggles between chart view and accessible table view (Issue #344)', () => {
    render(
      <DashboardPage
        transactions={mockTransactions}
        txLoading={false}
        publicKey="GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
        usdcBalance="50.0000"
        xlmBalance="10.0000"
        onRefresh={onRefresh}
      />
    )

    const tableViewBtn = screen.getByRole('button', { name: /view as accessible tabular data/i })
    fireEvent.click(tableViewBtn)

    const table = screen.getByRole('table', { name: /usdc spent over time summary table/i })
    expect(table).toBeInTheDocument()
    expect(screen.getByText(/AMOUNT \(USDC\)/i)).toBeInTheDocument()
  })

  it('triggers CSV and JSON export without crashing', () => {
    const originalCreateObjectURL = window.URL.createObjectURL
    const originalRevokeObjectURL = window.URL.revokeObjectURL
    window.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url')
    window.URL.revokeObjectURL = vi.fn()

    render(
      <DashboardPage
        transactions={mockTransactions}
        txLoading={false}
        publicKey="GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
        usdcBalance="50.0000"
        xlmBalance="10.0000"
        onRefresh={onRefresh}
      />
    )

    const exportCsvBtn = screen.getByRole('button', { name: /export audit data as csv/i })
    fireEvent.click(exportCsvBtn)
    expect(window.URL.createObjectURL).toHaveBeenCalled()

    const exportJsonBtn = screen.getByRole('button', { name: /export audit data as json/i })
    fireEvent.click(exportJsonBtn)
    expect(window.URL.createObjectURL).toHaveBeenCalledTimes(2)

    window.URL.createObjectURL = originalCreateObjectURL
    window.URL.revokeObjectURL = originalRevokeObjectURL
  })
})
