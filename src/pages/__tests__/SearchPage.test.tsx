import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { SearchPage } from '../SearchPage'
import type { WalletState, SearchSession } from '../../types'
import { toast } from 'sonner'

vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('../../components/ui', async (importOriginal) => {
  const orig: any = await importOriginal()
  return {
    ...orig,
    StatsGrid: () => <div data-testid="stats-grid" />,
  }
})

vi.mock('../../lib/stellar', async (importOriginal) => {
  const orig: any = await importOriginal()
  return {
    ...orig,
    fetchServerStats: vi.fn().mockResolvedValue(null),
  }
})

describe('SearchPage — Issue #137: Auto-resume pending search after wallet connection', () => {
  const disconnectedWallet: WalletState = {
    publicKey: null,
    connected: false,
    network: 'TESTNET',
    xlmBalance: '0',
    usdcBalance: '0',
    loading: false,
    error: null,
  }

  const connectedWallet: WalletState = {
    publicKey: 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3',
    connected: true,
    network: 'TESTNET',
    xlmBalance: '50.0000',
    usdcBalance: '10.000000',
    loading: false,
    error: null,
  }

  const idleSession: SearchSession = {
    query: '',
    results: [],
    txHash: null,
    paidAmount: null,
    status: 'idle',
    suggestions: [],
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('disconnected search attempt saves query and freshness and prompts wallet connect', async () => {
    const onConnectWallet = vi.fn()
    const search = vi.fn().mockResolvedValue(undefined)
    const reset = vi.fn()

    render(
      <SearchPage
        wallet={disconnectedWallet}
        onConnectWallet={onConnectWallet}
        session={idleSession}
        search={search}
        reset={reset}
      />
    )

    // Select freshness chip
    const pastWeekChip = screen.getByRole('button', { name: 'Past Week' })
    fireEvent.click(pastWeekChip)
    expect(pastWeekChip).toHaveAttribute('aria-pressed', 'true')

    // Enter search query
    const input = screen.getByLabelText('Search query') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'stellar x402 payment' } })
    expect(input.value).toBe('stellar x402 payment')

    // Submit form
    const form = screen.getByRole('search')
    fireEvent.submit(form)

    // onConnectWallet should have been called, but not search
    expect(onConnectWallet).toHaveBeenCalledTimes(1)
    expect(search).not.toHaveBeenCalled()

    // Clean UI feedback: pending status banner should be visible with query and filter
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText(/Connecting wallet to resume search for/)).toBeInTheDocument()
    expect(screen.getByText('"stellar x402 payment"')).toBeInTheDocument()
    expect(screen.getByText('(pw)')).toBeInTheDocument()

    // Toast feedback shown
    expect(toast.info).toHaveBeenCalledWith(
      'Connect Freighter',
      expect.objectContaining({
        description: expect.stringMatching(/connect your wallet to resume/i),
      })
    )

    // Input and freshness retain their values
    expect(input.value).toBe('stellar x402 payment')
    expect(pastWeekChip).toHaveAttribute('aria-pressed', 'true')
  })

  it('successful wallet connection auto-triggers the search with saved params', async () => {
    const onConnectWallet = vi.fn()
    const search = vi.fn().mockResolvedValue(undefined)
    const reset = vi.fn()

    const { rerender } = render(
      <SearchPage
        wallet={disconnectedWallet}
        onConnectWallet={onConnectWallet}
        session={idleSession}
        search={search}
        reset={reset}
      />
    )

    // Select freshness 'Past Day' (pd)
    fireEvent.click(screen.getByRole('button', { name: 'Past Day' }))
    const input = screen.getByLabelText('Search query') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'soroban contracts' } })

    // Submit while disconnected
    fireEvent.submit(screen.getByRole('search'))
    expect(onConnectWallet).toHaveBeenCalled()
    expect(search).not.toHaveBeenCalled()

    // Now wallet connects successfully
    rerender(
      <SearchPage
        wallet={connectedWallet}
        onConnectWallet={onConnectWallet}
        session={idleSession}
        search={search}
        reset={reset}
      />
    )

    // Search should automatically be called with saved query and freshness
    await waitFor(() => {
      expect(search).toHaveBeenCalledWith('soroban contracts', 'pd')
    })
    expect(search).toHaveBeenCalledTimes(1)

    // Pending banner is cleared
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    // Subsequent re-renders do NOT re-trigger search (state was cleared)
    rerender(
      <SearchPage
        wallet={connectedWallet}
        onConnectWallet={onConnectWallet}
        session={idleSession}
        search={search}
        reset={reset}
      />
    )
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('wallet rejection preserves form inputs without executing payments', async () => {
    // Simulate user cancelling or declining access
    const onConnectWallet = vi.fn().mockResolvedValue(false)
    const search = vi.fn().mockResolvedValue(undefined)
    const reset = vi.fn()

    render(
      <SearchPage
        wallet={disconnectedWallet}
        onConnectWallet={onConnectWallet}
        session={idleSession}
        search={search}
        reset={reset}
      />
    )

    // Select freshness 'Past Month' (pm)
    const pastMonthChip = screen.getByRole('button', { name: 'Past Month' })
    fireEvent.click(pastMonthChip)
    const input = screen.getByLabelText('Search query') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'stellar lumens tokenomics' } })

    // Submit form
    await act(async () => {
      fireEvent.submit(screen.getByRole('search'))
    })

    // Search must NOT be called
    expect(search).not.toHaveBeenCalled()

    // Toast error shows cancellation feedback
    expect(toast.error).toHaveBeenCalledWith(
      'Wallet connection cancelled',
      expect.objectContaining({
        description: expect.stringMatching(/query was retained/i),
      })
    )

    // Input values and filter selections are preserved in the form
    expect(input.value).toBe('stellar lumens tokenomics')
    expect(pastMonthChip).toHaveAttribute('aria-pressed', 'true')
  })

  it('wallet connection error via rejection/exception clears pending search, preserves inputs, and displays alert', async () => {
    const onConnectWallet = vi.fn().mockRejectedValue(new Error('Freighter extension closed by user'))
    const search = vi.fn().mockResolvedValue(undefined)
    const reset = vi.fn()

    const { rerender } = render(
      <SearchPage
        wallet={disconnectedWallet}
        onConnectWallet={onConnectWallet}
        session={idleSession}
        search={search}
        reset={reset}
      />
    )

    const input = screen.getByLabelText('Search query') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'stellar anchor usd' } })

    await act(async () => {
      fireEvent.submit(screen.getByRole('search'))
    })

    // Search must NOT be called
    expect(search).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(
      'Wallet connection failed',
      expect.objectContaining({
        description: expect.stringMatching(/Freighter extension closed by user/),
      })
    )

    // Now wallet updates with error state
    rerender(
      <SearchPage
        wallet={{
          ...disconnectedWallet,
          error: 'User declined access',
        }}
        onConnectWallet={onConnectWallet}
        session={idleSession}
        search={search}
        reset={reset}
      />
    )

    // Alert feedback displays error with reassurance that inputs were retained
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('User declined access')).toBeInTheDocument()
    expect(
      screen.getByText(/Your query and filters have been preserved in the search bar/i)
    ).toBeInTheDocument()

    // Form inputs preserved
    expect(input.value).toBe('stellar anchor usd')
    expect(search).not.toHaveBeenCalled()
  })

  it('allows user to manually cancel pending search before wallet connects', async () => {
    const onConnectWallet = vi.fn()
    const search = vi.fn().mockResolvedValue(undefined)
    const reset = vi.fn()

    const { rerender } = render(
      <SearchPage
        wallet={disconnectedWallet}
        onConnectWallet={onConnectWallet}
        session={idleSession}
        search={search}
        reset={reset}
      />
    )

    const input = screen.getByLabelText('Search query') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'cancel test query' } })

    fireEvent.submit(screen.getByRole('search'))
    expect(screen.getByRole('status')).toBeInTheDocument()

    // Click CANCEL button
    const cancelBtn = screen.getByRole('button', { name: 'CANCEL' })
    fireEvent.click(cancelBtn)

    // Pending banner is removed
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    // Now when wallet connects, search should NOT execute because it was cancelled
    rerender(
      <SearchPage
        wallet={connectedWallet}
        onConnectWallet={onConnectWallet}
        session={idleSession}
        search={search}
        reset={reset}
      />
    )

    expect(search).not.toHaveBeenCalled()
  })

  it('connected search immediately executes without pending state', () => {
    const onConnectWallet = vi.fn()
    const search = vi.fn().mockResolvedValue(undefined)
    const reset = vi.fn()

    render(
      <SearchPage
        wallet={connectedWallet}
        onConnectWallet={onConnectWallet}
        session={idleSession}
        search={search}
        reset={reset}
      />
    )

    const input = screen.getByLabelText('Search query') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'immediate search' } })

    fireEvent.submit(screen.getByRole('search'))

    expect(onConnectWallet).not.toHaveBeenCalled()
    expect(search).toHaveBeenCalledWith('immediate search', '')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
