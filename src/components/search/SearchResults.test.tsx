import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { SearchResults } from './SearchResults'
import type { SearchResult } from '../../hooks/useSearch'

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...filterMotionProps(props)}>{children}</div>,
    a: ({ children, ...props }: any) => <a {...filterMotionProps(props)}>{children}</a>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

function filterMotionProps(props: Record<string, any>) {
  const safe: Record<string, any> = {}
  for (const [k, v] of Object.entries(props)) {
    if (k === 'initial' || k === 'animate' || k === 'exit' || k === 'transition' || k === 'whileHover') continue
    safe[k] = v
  }
  return safe
}

// Mock sonner
vi.mock('sonner', () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}))

const makeResult = (id: string, title: string): SearchResult => ({
  id,
  title,
  url: `https://example.com/${id}`,
  description: `Description for ${title}`,
  source: 'example.com',
  relevanceScore: 0.9,
})

const mockResults: SearchResult[] = [
  makeResult('1', 'Stellar blockchain'),
  makeResult('2', 'x402 protocol'),
]

const mockResults2: SearchResult[] = [
  makeResult('3', 'Soroban smart contracts'),
  makeResult('4', 'Stellar DEX'),
]

// Mock fetch for summarize
const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  headers: { get: () => 'application/json' },
  json: async () => ({ content: 'AI summary of results' }),
})
global.fetch = mockFetch as any

describe('SearchResults — summary state reset (issue #95)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = mockFetch as any
  })

  it('clears summary when query prop changes', async () => {
    const { rerender } = render(
      <SearchResults results={mockResults} query="first query" />,
    )

    // Click summarize button
    const summarizeBtn = screen.getByText('SUMMARIZE')
    await act(async () => {
      summarizeBtn.click()
    })

    // After summarize completes, summary should appear
    await act(async () => {
      // wait for fetch to resolve
    })

    // Verify summary or regenerate button is showing
    const regenerateBtn = screen.queryByText('REGENERATE')
    expect(regenerateBtn).not.toBeNull()

    // Now re-render with a new query
    rerender(<SearchResults results={mockResults2} query="second query" />)

    // Summary should be cleared — SUMMARIZE button should be back (not REGENERATE)
    expect(screen.queryByText('REGENERATE')).toBeNull()
    expect(screen.getByText('SUMMARIZE')).toBeInTheDocument()
  })

  it('clears summary when results prop changes', async () => {
    const { rerender } = render(
      <SearchResults results={mockResults} query="same query" />,
    )

    // Click summarize
    const summarizeBtn = screen.getByText('SUMMARIZE')
    await act(async () => {
      summarizeBtn.click()
    })

    await act(async () => {})

    // Verify summary state is set
    expect(screen.queryByText('REGENERATE')).not.toBeNull()

    // Re-render with different results (same query)
    rerender(<SearchResults results={mockResults2} query="same query" />)

    // Summary should be cleared
    expect(screen.queryByText('REGENERATE')).toBeNull()
    expect(screen.getByText('SUMMARIZE')).toBeInTheDocument()
  })

  it('clears summary error when query changes', async () => {
    // Make fetch fail
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    const { rerender } = render(
      <SearchResults results={mockResults} query="failing query" />,
    )

    // Click summarize — will fail
    const summarizeBtn = screen.getByText('SUMMARIZE')
    await act(async () => {
      summarizeBtn.click()
    })

    await act(async () => {})

    // Error should appear
    expect(screen.getByText(/Network error/)).toBeInTheDocument()

    // Restore fetch and re-render with new query
    global.fetch = mockFetch as any
    rerender(<SearchResults results={mockResults2} query="new query" />)

    // Error should be cleared
    expect(screen.queryByText(/Network error/)).toBeNull()
    expect(screen.getByText('SUMMARIZE')).toBeInTheDocument()
  })

  it('renders results correctly after query change', () => {
    const { rerender } = render(
      <SearchResults results={mockResults} query="first" />,
    )

    expect(screen.getByText('Stellar blockchain')).toBeInTheDocument()
    expect(screen.getByText('x402 protocol')).toBeInTheDocument()

    rerender(<SearchResults results={mockResults2} query="second" />)

    expect(screen.getByText('Soroban smart contracts')).toBeInTheDocument()
    expect(screen.getByText('Stellar DEX')).toBeInTheDocument()
    expect(screen.queryByText('Stellar blockchain')).toBeNull()
  })

  it('shows loading skeleton when isLoading is true', () => {
    const { rerender } = render(
      <SearchResults results={[]} query="test" isLoading={true} />,
    )

    // Should show skeleton loading animation
    const skeletons = document.querySelectorAll('.animate-pulse')
    expect(skeletons.length).toBeGreaterThan(0)

    // After loading finishes with results
    rerender(<SearchResults results={mockResults} query="test" isLoading={false} />)
    expect(screen.getByText('Stellar blockchain')).toBeInTheDocument()
  })

  it('returns null when results are empty and not loading', () => {
    const { container } = render(
      <SearchResults results={[]} query="empty" />,
    )

    // Should not render any result cards
    expect(screen.queryByText('SUMMARIZE')).toBeNull()
  })
})
