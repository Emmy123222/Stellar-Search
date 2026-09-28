import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { SearchResults } from './SearchResults'
import type { SearchResult } from '../../hooks/useSearch'

// ── Framer-motion stub ─────────────────────────────────────────────────────
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...filterMotionProps(props)}>{children}</div>,
    a:   ({ children, ...props }: any) => <a   {...filterMotionProps(props)}>{children}</a>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

function filterMotionProps(props: Record<string, any>) {
  const safe: Record<string, any> = {}
  for (const [k, v] of Object.entries(props)) {
    if (['initial', 'animate', 'exit', 'transition', 'whileHover', 'whileTap'].includes(k)) continue
    safe[k] = v
  }
  return safe
}

// ── ResearchWorkflowPanel stub ─────────────────────────────────────────────
vi.mock('./ResearchWorkflowPanel', () => ({
  ResearchWorkflowPanel: ({ results, query }: any) => (
    <div data-testid="research-workflow-panel" data-query={query} data-count={results.length} />
  ),
}))

// ── Sonner stub ────────────────────────────────────────────────────────────
vi.mock('sonner', () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}))

// ── Helpers ────────────────────────────────────────────────────────────────
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

// ── Fetch mock ─────────────────────────────────────────────────────────────
const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  headers: { get: () => 'application/json' },
  json: async () => ({ content: 'AI summary of results' }),
})
global.fetch = mockFetch as any

// ── Tests ──────────────────────────────────────────────────────────────────

describe('SearchResults — summary state reset (issue #95)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = mockFetch as any
  })

  it('clears summary when query prop changes', async () => {
    const { rerender } = render(
      <SearchResults results={mockResults} query="first query" />,
    )

    // Click summarize to open summarize panel and trigger the AI call
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /quick ai summary/i }))
    })
    await act(async () => {})

    // REGENERATE label should appear on the summarize button
    expect(screen.queryByRole('button', { name: /regenerate/i })).not.toBeNull()

    // New query
    rerender(<SearchResults results={mockResults2} query="second query" />)

    // Panel should reset
    expect(screen.queryByRole('button', { name: /regenerate/i })).toBeNull()
    expect(screen.getByRole('button', { name: /quick ai summary/i })).not.toBeNull()
  })

  it('clears summary when results prop changes', async () => {
    const { rerender } = render(
      <SearchResults results={mockResults} query="same query" />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /quick ai summary/i }))
    })
    await act(async () => {})

    expect(screen.queryByRole('button', { name: /regenerate/i })).not.toBeNull()

    rerender(<SearchResults results={mockResults2} query="same query" />)

    expect(screen.queryByRole('button', { name: /regenerate/i })).toBeNull()
  })

  it('clears summary error when query changes', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    const { rerender } = render(
      <SearchResults results={mockResults} query="failing query" />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /quick ai summary/i }))
    })
    await act(async () => {})

    expect(screen.queryByText(/Network error/)).not.toBeNull()

    global.fetch = mockFetch as any
    rerender(<SearchResults results={mockResults2} query="new query" />)

    expect(screen.queryByText(/Network error/)).toBeNull()
  })

  it('renders results correctly after query change', () => {
    const { rerender } = render(
      <SearchResults results={mockResults} query="first" />,
    )

    expect(screen.queryByText('Stellar blockchain')).not.toBeNull()
    expect(screen.queryByText('x402 protocol')).not.toBeNull()

    rerender(<SearchResults results={mockResults2} query="second" />)

    expect(screen.queryByText('Soroban smart contracts')).not.toBeNull()
    expect(screen.queryByText('Stellar DEX')).not.toBeNull()
    expect(screen.queryByText('Stellar blockchain')).toBeNull()
  })

  it('shows loading skeleton when isLoading is true', () => {
    const { rerender } = render(
      <SearchResults results={[]} query="test" isLoading={true} />,
    )

    const skeletons = document.querySelectorAll('.animate-pulse')
    expect(skeletons.length).toBeGreaterThan(0)

    rerender(<SearchResults results={mockResults} query="test" isLoading={false} />)
    expect(screen.queryByText('Stellar blockchain')).not.toBeNull()
  })

  it('returns null when results are empty and not loading', () => {
    const { container } = render(
      <SearchResults results={[]} query="empty" />,
    )
    expect(screen.queryByRole('button', { name: /quick ai summary/i })).toBeNull()
    expect(container.firstChild).toBeNull()
  })
})

describe('SearchResults — Research mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = mockFetch as any
  })

  it('renders the RESEARCH button alongside SUMMARIZE', () => {
    render(<SearchResults results={mockResults} query="stellar" />)

    expect(screen.getByRole('button', { name: /quick ai summary/i })).not.toBeNull()
    expect(screen.getByRole('button', { name: /research report/i })).not.toBeNull()
  })

  it('shows ResearchWorkflowPanel when RESEARCH button is clicked', async () => {
    render(<SearchResults results={mockResults} query="stellar" />)

    expect(screen.queryByTestId('research-workflow-panel')).toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /research report/i }))
    })

    expect(screen.queryByTestId('research-workflow-panel')).not.toBeNull()
  })

  it('hides ResearchWorkflowPanel when RESEARCH is clicked again (toggle)', async () => {
    render(<SearchResults results={mockResults} query="stellar" />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /research report/i }))
    })
    expect(screen.queryByTestId('research-workflow-panel')).not.toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /research report/i }))
    })
    expect(screen.queryByTestId('research-workflow-panel')).toBeNull()
  })

  it('passes correct results and query to ResearchWorkflowPanel', async () => {
    render(<SearchResults results={mockResults} query="test query" />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /research report/i }))
    })

    const panel = screen.getByTestId('research-workflow-panel')
    expect(panel.getAttribute('data-query')).toBe('test query')
    expect(panel.getAttribute('data-count')).toBe(String(mockResults.length))
  })

  it('hides ResearchWorkflowPanel and resets when query changes', async () => {
    const { rerender } = render(
      <SearchResults results={mockResults} query="first" />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /research report/i }))
    })
    expect(screen.queryByTestId('research-workflow-panel')).not.toBeNull()

    rerender(<SearchResults results={mockResults2} query="second" />)

    expect(screen.queryByTestId('research-workflow-panel')).toBeNull()
  })
})

describe('SearchResults — result cards with citation IDs', () => {
  it('renders each result card with an id of result-card-{n}', () => {
    render(<SearchResults results={mockResults} query="stellar" />)

    const card1 = document.getElementById('result-card-1')
    const card2 = document.getElementById('result-card-2')

    expect(card1).not.toBeNull()
    expect(card2).not.toBeNull()
    expect(card1?.tagName.toLowerCase()).toBe('a')
  })

  it('card IDs are 1-based and match result order', () => {
    render(<SearchResults results={mockResults} query="stellar" />)

    const card1 = document.getElementById('result-card-1')
    const card2 = document.getElementById('result-card-2')

    expect(card1?.textContent).toContain('Stellar blockchain')
    expect(card2?.textContent).toContain('x402 protocol')
  })
})
