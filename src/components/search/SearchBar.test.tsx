import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SearchBar, FRESHNESS_OPTIONS } from './SearchBar'

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}))

describe('SearchBar — UI pay-per-query', () => {
  const baseProps = {
    onSearch: vi.fn(),
    isSearching: false,
    walletConnected: true,
    usdcBalance: '1.000000',
    walletNetwork: 'TESTNET',
    defaultQuery: '',
  }

  it('provides all 4 freshness options', () => {
    expect(FRESHNESS_OPTIONS.map(o => o.value)).toEqual(['', 'pd', 'pw', 'pm'])
    expect(FRESHNESS_OPTIONS.map(o => o.label)).toEqual(['Any Time', 'Past Day', 'Past Week', 'Past Month'])
    expect(FRESHNESS_OPTIONS).toHaveLength(4)
  })

  it('renders search input and freshness chips', () => {
    render(<SearchBar {...baseProps} />)
    expect(screen.getByLabelText('Search query')).toBeInTheDocument()
    expect(screen.getByRole('search')).toBeInTheDocument()
    expect(screen.getByText('Freshness:')).toBeInTheDocument()
    for (const opt of FRESHNESS_OPTIONS) {
      expect(screen.getByRole('button', { name: opt.label })).toBeInTheDocument()
    }
  })

  it('calls onSearch with query and freshness on submit', () => {
    const onSearch = vi.fn()
    render(<SearchBar {...baseProps} onSearch={onSearch} />)
    // Select freshness pw
    fireEvent.click(screen.getByRole('button', { name: 'Past Week' }))
    const input = screen.getByLabelText('Search query') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'stellar x402' } })
    // Submit form
    const form = screen.getByRole('search')
    fireEvent.submit(form)
    expect(onSearch).toHaveBeenCalledWith('stellar x402', 'pw', 'moderate')
  })

  it('does not call onSearch when query empty', () => {
    const onSearch = vi.fn()
    render(<SearchBar {...baseProps} onSearch={onSearch} />)
    const form = screen.getByRole('search')
    fireEvent.submit(form)
    expect(onSearch).not.toHaveBeenCalled()
  })

  it('disables input when isSearching', () => {
    const { container } = render(<SearchBar {...baseProps} isSearching={true} />)
    expect(screen.getByLabelText('Search query')).toBeDisabled()
    // When searching, submit button shows spinner; query via type=submit
    const submitBtn = container.querySelector('button[type="submit"]') as HTMLButtonElement
    expect(submitBtn).not.toBeNull()
    expect(submitBtn.disabled).toBe(true)
  })

  it('shows network mismatch when walletNetwork mismatched', () => {
    render(<SearchBar {...baseProps} walletNetwork="PUBLIC" />)
    expect(screen.getByText(/NETWORK MISMATCH/)).toBeInTheDocument()
    expect(screen.getByLabelText('Search query')).toBeDisabled()
    expect(screen.getByLabelText('Search query').getAttribute('placeholder')).toMatch(/Switch network/)
  })

  it('freshness chip aria-pressed reflects selection', () => {
    render(<SearchBar {...baseProps} />)
    const anyTime = screen.getByRole('button', { name: 'Any Time' })
    expect(anyTime).toHaveAttribute('aria-pressed', 'true')
    const pastDay = screen.getByRole('button', { name: 'Past Day' })
    expect(pastDay).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(pastDay)
    expect(pastDay).toHaveAttribute('aria-pressed', 'true')
    expect(anyTime).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows queries left calculated from balance', () => {
    render(<SearchBar {...baseProps} usdcBalance="0.005" />)
    // 0.005 / 0.001 = 5 queries
    expect(screen.getByText(/Balance: 0\.005 USDC/)).toBeInTheDocument()
    expect(screen.getByText(/5 queries left/)).toBeInTheDocument()
  })

  it('shows connect wallet prompt when not connected', () => {
    render(<SearchBar {...baseProps} walletConnected={false} />)
    expect(screen.getByText('Connect Freighter wallet to search')).toBeInTheDocument()
  })

  it('displays USDC amount from constants', () => {
    render(<SearchBar {...baseProps} />)
    // Button shows "0.001 USDC"
    expect(screen.getByText(/0\.001 USDC/)).toBeInTheDocument()
  })
})
