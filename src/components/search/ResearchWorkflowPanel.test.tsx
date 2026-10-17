import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import { ResearchWorkflowPanel } from './ResearchWorkflowPanel'
import type { SearchResult } from '../../hooks/useSearch'

// ── Framer-motion stub ─────────────────────────────────────────────────────
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...stripMotion(props)}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

function stripMotion(props: Record<string, any>) {
  const SKIP = new Set(['initial', 'animate', 'exit', 'transition', 'whileHover', 'whileTap'])
  return Object.fromEntries(Object.entries(props).filter(([k]) => !SKIP.has(k)))
}

// ── AiMarkdown stub ────────────────────────────────────────────────────────
vi.mock('../ai/AiMarkdown', () => ({
  AiMarkdown: ({ content }: { content: string }) => <div data-testid="ai-markdown">{content}</div>,
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

const results: SearchResult[] = [
  makeResult('1', 'Stellar blockchain'),
  makeResult('2', 'x402 protocol'),
  makeResult('3', 'Serper.dev API'),
]

function makeMockFetch(content: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => ({ content }),
  })
}

describe('ResearchWorkflowPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── Rendering ────────────────────────────────────────────────────────

  it('renders all result source checkboxes with correct labels', () => {
    render(<ResearchWorkflowPanel results={results} query="stellar" />)

    for (const r of results) {
      expect(screen.getByLabelText(`Include source: ${r.title}`)).not.toBeNull()
    }
  })

  it('renders all 4 format radio buttons', () => {
    render(<ResearchWorkflowPanel results={results} query="stellar" />)

    expect(screen.getByLabelText('BULLET POINTS')).not.toBeNull()
    expect(screen.getByLabelText('NARRATIVE')).not.toBeNull()
    expect(screen.getByLabelText('TABLE')).not.toBeNull()
    expect(screen.getByLabelText('COMPARISON')).not.toBeNull()
  })

  it('starts with all sources checked', () => {
    render(<ResearchWorkflowPanel results={results} query="stellar" />)

    for (const r of results) {
      const checkbox = screen.getByLabelText(`Include source: ${r.title}`) as HTMLInputElement
      expect(checkbox.checked).toBe(true)
    }
  })

  it('starts with bullets format selected', () => {
    render(<ResearchWorkflowPanel results={results} query="stellar" />)
    const radio = screen.getByLabelText('BULLET POINTS') as HTMLInputElement
    expect(radio.checked).toBe(true)
  })

  it('shows the source count badge', () => {
    render(<ResearchWorkflowPanel results={results} query="stellar" />)
    const badge = document.querySelector('[style*="font-size: 10px"]')
    expect(badge).not.toBeNull()
    expect(badge!.textContent).toContain('3')
  })

  // ── Source selection ─────────────────────────────────────────────────

  it('toggles a source off when checkbox is unchecked', async () => {
    render(<ResearchWorkflowPanel results={results} query="stellar" />)

    const checkbox = screen.getByLabelText('Include source: Stellar blockchain') as HTMLInputElement
    expect(checkbox.checked).toBe(true)

    await act(async () => {
      fireEvent.click(checkbox)
    })

    expect(checkbox.checked).toBe(false)
  })

  it('deselects all sources when NONE is clicked', async () => {
    render(<ResearchWorkflowPanel results={results} query="stellar" />)

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Deselect all sources'))
    })

    for (const r of results) {
      const cb = screen.getByLabelText(`Include source: ${r.title}`) as HTMLInputElement
      expect(cb.checked).toBe(false)
    }
  })

  it('re-selects all sources when ALL is clicked after deselecting', async () => {
    render(<ResearchWorkflowPanel results={results} query="stellar" />)

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Deselect all sources'))
    })

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Select all sources'))
    })

    for (const r of results) {
      const cb = screen.getByLabelText(`Include source: ${r.title}`) as HTMLInputElement
      expect(cb.checked).toBe(true)
    }
  })

  // ── Format selection ─────────────────────────────────────────────────

  it('switches format when a different radio button is selected', async () => {
    render(<ResearchWorkflowPanel results={results} query="stellar" />)

    const tableRadio = screen.getByLabelText('TABLE') as HTMLInputElement
    await act(async () => {
      fireEvent.click(tableRadio)
    })

    expect(tableRadio.checked).toBe(true)
    const bulletsRadio = screen.getByLabelText('BULLET POINTS') as HTMLInputElement
    expect(bulletsRadio.checked).toBe(false)
  })

  // ── Generate button state ────────────────────────────────────────────

  it('disables the generate button and shows warning when no sources are selected', async () => {
    render(<ResearchWorkflowPanel results={results} query="stellar" />)

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Deselect all sources'))
    })

    const generateBtn = screen.getByRole('button', {
      name: 'Select at least one source to generate a report',
    })
    expect(generateBtn).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Select at least one source to generate a report.',
    )
  })

  it('enables the generate button when at least one source is selected', async () => {
    render(<ResearchWorkflowPanel results={results} query="stellar" />)

    const generateBtn = screen.getByRole('button', { name: 'Generate research report' })
    expect(generateBtn).not.toBeDisabled()
  })

  // ── Report generation ────────────────────────────────────────────────

  it('generates a report and displays content via AiMarkdown', async () => {
    const reportText = '• Key finding 1 [1]\n• Key finding 2 [2]'
    global.fetch = makeMockFetch(reportText)

    render(<ResearchWorkflowPanel results={results} query="stellar" />)

    const generateBtn = screen.getByRole('button', { name: 'Generate research report' })
    await act(async () => {
      fireEvent.click(generateBtn)
    })

    await waitFor(() => {
      expect(screen.getByTestId('ai-markdown')).toHaveTextContent(/Key finding 1 \[1\]/)
      expect(screen.getByTestId('ai-markdown')).toHaveTextContent(/Key finding 2 \[2\]/)
    })
  })

  it('shows omitted sources in footer when some sources were deselected', async () => {
    global.fetch = makeMockFetch('Some report content')

    render(<ResearchWorkflowPanel results={results} query="stellar" />)

    // Uncheck source 2
    const cb2 = screen.getByLabelText('Include source: x402 protocol')
    await act(async () => {
      fireEvent.click(cb2)
    })

    const generateBtn = screen.getByRole('button', { name: 'Generate research report' })
    await act(async () => {
      fireEvent.click(generateBtn)
    })

    await waitFor(() => {
      const footer = screen.getByLabelText('Source status')
      expect(footer).toHaveTextContent('[2]')
      expect(footer).toHaveTextContent('(deselected by you)')
    })
  })

  it('displays error message when report generation fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Server exploded' }),
    })

    render(<ResearchWorkflowPanel results={results} query="stellar" />)

    const generateBtn = screen.getByRole('button', { name: 'Generate research report' })
    await act(async () => {
      fireEvent.click(generateBtn)
    })

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Server error 500/)
    })
  })

  // ── State reset ──────────────────────────────────────────────────────

  it('resets selected sources and clears report when query changes', async () => {
    global.fetch = makeMockFetch('Report for query 1')

    const { rerender } = render(<ResearchWorkflowPanel results={results} query="query 1" />)

    // Generate report
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Generate research report' }))
    })

    await waitFor(() => {
      expect(screen.getByTestId('ai-markdown')).toBeInTheDocument()
    })

    // Rerender with new query
    rerender(<ResearchWorkflowPanel results={results} query="query 2" />)

    // Report should be cleared
    expect(screen.queryByTestId('ai-markdown')).toBeNull()
    // Button should be back to initial state
    expect(screen.getByRole('button', { name: 'Generate research report' })).toBeInTheDocument()
  })
})
