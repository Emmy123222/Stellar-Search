import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { DashboardPage } from './DashboardPage'
import * as receiptVerification from '../lib/receiptVerification'
import * as receiptBundle from '../lib/receiptBundle'
import type { SearchReceipt } from '../types'

// Mock recharts ResponsiveContainer / BarChart
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  BarChart: ({ children }: any) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  CartesianGrid: () => null,
}))

// Mock SavedResearchPanel
vi.mock('../components/search', () => ({
  SavedResearchPanel: () => <div data-testid="saved-research-panel" />,
}))

function stubLocalStorage(initialData: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initialData))
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
  })
}

describe('DashboardPage — Receipt Verification & Search Audit Log (Issue #136)', () => {
  const mockOnRefresh = vi.fn()

  const SAMPLE_RECEIPTS: SearchReceipt[] = [
    {
      txHash: 'tx_confirmed_1234567890',
      query: 'stellar sdk docs',
      amount: '0.001',
      asset: 'USDC',
      destination: 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3',
      network: 'stellar:testnet',
      timestamp: '2026-09-01T10:00:00.000Z',
    },
    {
      txHash: 'tx_mismatched_9876543210',
      query: 'soroban contracts tutorial',
      amount: '0.001',
      asset: 'USDC',
      destination: 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3',
      network: 'stellar:testnet',
      timestamp: '2026-09-01T11:00:00.000Z',
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders empty audit log state when no receipts are in localStorage', () => {
    stubLocalStorage({})
    render(
      <DashboardPage
        transactions={[]}
        txLoading={false}
        publicKey="GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3"
        usdcBalance="10.0"
        xlmBalance="50.0"
        onRefresh={mockOnRefresh}
      />
    )

    expect(screen.getByText('SEARCH AUDIT LOG')).toBeDefined()
    expect(screen.getByText('NO SEARCH RECEIPTS YET')).toBeDefined()
    expect(screen.getByText('0 RECEIPTS')).toBeDefined()
  })

  it('loads receipts and automatically verifies them against Horizon on mount', async () => {
    stubLocalStorage({
      stellarsearch_receipts: JSON.stringify(SAMPLE_RECEIPTS),
    })

    const verifySpy = vi.spyOn(receiptVerification, 'verifyReceiptAgainstHorizon').mockImplementation(
      async (receipt) => {
        if (receipt.txHash === 'tx_confirmed_1234567890') {
          return {
            status: 'confirmed',
            ledgerSequence: 887766,
            txHash: receipt.txHash,
            network: receipt.network,
          }
        }
        return {
          status: 'mismatched',
          mismatches: ['Amount mismatch: expected 0.001, found 0.0005'],
          txHash: receipt.txHash,
          network: receipt.network,
        }
      }
    )

    render(
      <DashboardPage
        transactions={[]}
        txLoading={false}
        publicKey="GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3"
        usdcBalance="10.0"
        xlmBalance="50.0"
        onRefresh={mockOnRefresh}
      />
    )

    // Verify receipt titles are displayed
    expect(screen.getByText('"stellar sdk docs"')).toBeDefined()
    expect(screen.getByText('"soroban contracts tutorial"')).toBeDefined()

    // Wait for async verification results
    await waitFor(() => {
      expect(screen.getByText(/CONFIRMED #887766/)).toBeDefined()
      expect(screen.getByText('MISMATCHED')).toBeDefined()
      expect(screen.getByText(/Amount mismatch: expected 0.001, found 0.0005/)).toBeDefined()
    })

    // Verify header counter pills
    expect(screen.getByText('1 CONFIRMED')).toBeDefined()
    expect(screen.getByText('1 MISMATCHED')).toBeDefined()

    expect(verifySpy).toHaveBeenCalledTimes(2)
  })

  it('allows manual re-verification via VERIFY ALL button', async () => {
    stubLocalStorage({
      stellarsearch_receipts: JSON.stringify([SAMPLE_RECEIPTS[0]]),
    })

    const verifySpy = vi.spyOn(receiptVerification, 'verifyReceiptAgainstHorizon').mockResolvedValue({
      status: 'confirmed',
      ledgerSequence: 12345,
      txHash: SAMPLE_RECEIPTS[0].txHash,
      network: SAMPLE_RECEIPTS[0].network,
    })

    render(
      <DashboardPage
        transactions={[]}
        txLoading={false}
        publicKey="GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3"
        usdcBalance="10.0"
        xlmBalance="50.0"
        onRefresh={mockOnRefresh}
      />
    )

    await waitFor(() => {
      expect(screen.getByText(/CONFIRMED #12345/)).toBeDefined()
    })

    const verifyAllBtn = screen.getByText('VERIFY ALL')
    fireEvent.click(verifyAllBtn)

    await waitFor(() => {
      expect(verifySpy).toHaveBeenCalledTimes(2)
    })
  })

  it('triggers bundle creation and download on DOWNLOAD BUNDLE click', async () => {
    stubLocalStorage({
      stellarsearch_receipts: JSON.stringify(SAMPLE_RECEIPTS),
    })

    vi.spyOn(receiptVerification, 'verifyReceiptAgainstHorizon').mockResolvedValue({
      status: 'confirmed',
      txHash: 'hash',
      network: 'stellar:testnet',
    })

    const createBundleSpy = vi.spyOn(receiptBundle, 'createReceiptBundle').mockResolvedValue({
      version: 1,
      generatedAt: '2026-09-01T12:00:00Z',
      applicationName: 'StellarSearch',
      network: 'stellar:testnet',
      receipts: SAMPLE_RECEIPTS,
      metadata: '{}',
      proof: 'abcproof',
    })

    const downloadSpy = vi.spyOn(receiptBundle, 'downloadBundle').mockImplementation(() => {})

    render(
      <DashboardPage
        transactions={[]}
        txLoading={false}
        publicKey="GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3"
        usdcBalance="10.0"
        xlmBalance="50.0"
        onRefresh={mockOnRefresh}
      />
    )

    const downloadBtn = screen.getByText('DOWNLOAD BUNDLE')
    fireEvent.click(downloadBtn)

    await waitFor(() => {
      expect(createBundleSpy).toHaveBeenCalledTimes(1)
      expect(downloadSpy).toHaveBeenCalledTimes(1)
    })
  })
})
