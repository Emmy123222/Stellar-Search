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

// ── Fetch mock helpers ─────────────────────────────────────────────────────
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
    // The badge renders "3/3 selected" split across text nodes — find by partial match
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

    // Expand the source list first (click the header to show it)
    const header = screen.getByRole('button', { name: /SOURCES/i })
    await act(async () => {
      fireEvent.click(header)
    })
    await act(async () => {
      fireEvent.click(header)
    })

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

    // Open the sources panel
    const headerBtn = screen.getByRole('button', { name: /SOURCES/i })
    await act(async () => { fireEvent.click(headerBtn) })
    // Open again (toggle back open)
    await act(async () => { fireEvent.click(headerBtn) })

    // Deselect all
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Deselect all sources'))
    })
    for (const r of results) {
      expect((screen.getByLabelText(`Include source: ${r.title}`) as HTMLInputElement).checked).toBe(false)
    }

    // Select all
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Select all sources'))
    })
    for (const r of results) {
      expect((screen.getByLabelText(`Include source: ${r.title}`) as HTMLInputElement).checked).toBe(true)
    }
  })

  // ── Generate button state ────────────────────────────────────────────

  it('disables the generate button when no sources are selected', async () => {
    render(<ResearchWorkflowPanel results={results} query="stellar" />)

    // Expand source list to access NONE button
    const headerBtn = screen.getByRole('button', { name: /SOURCES/i })
    await act(async () => { fireEvent.click(headerBtn) })
    await act(async () => { fireEvent.click(headerBtn) })

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Deselect all sources'))
    })

    const btn = screen.getByRole('button', { name: /select at least one source/i }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('enables the generate button when at least one source is selected', () => {
    render(<ResearchWorkflowPanel results={results} query="stellar" />)
    const btn = screen.getByRole('button', { name: /generate research report/i }) as HTMLButtonElement
    expect(btn.disabled).toBe(false)
  })

  // ── Format selection ─────────────────────────────────────────────────

  it('changes format when a different radio is clicked', async () => {
    render(<ResearchWorkflowPanel results={results} query="stellar" />)

    const narrativeRadio = screen.getByLabelText('NARRATIVE') as HTMLInputElement
    await act(async () => {
      fireEvent.click(narrativeRadio)
    })
    expect(narrativeRadio.checked).toBe(true)

    const bulletsRadio = screen.getByLabelText('BULLET POINTS') as HTMLInputElement
    expect(bulletsRadio.checked).toBe(false)
  })

  // ── Report generation (JSON response) ───────────────────────────────

  it('calls /ai/chat and renders the report via AiMarkdown', async () => {
    const mockFetch = makeMockFetch('**Findings**: Stellar is great [1].')
    global.fetch = mockFetch as any

    render(<ResearchWorkflowPanel results={results} query="stellar" />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /generate research report/i }))
    })

    await waitFor(() => {
      expect(screen.getByTestId('ai-markdown')).not.toBeNull()
    })
    expect(screen.getByTestId('ai-markdown').textContent).toContain('Findings')
    expect(mockFetch).toHaveBeenCalledOnce()
  })

  it('includes all selected source data in the POST body', async () => {
    const mockFetch = makeMockFetch('Report content.')
    global.fetch = mockFetch as any

    render(<ResearchWorkflowPanel results={results} query="stellar test" />)

    // Deselect result #3 — it's in the DOM even when sources section is collapsed
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Include source: Serper.dev API'))
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /generate research report/i }))
    })

    await waitFor(() => expect(mockFetch).toHaveBeenCalledOnce())

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    const prompt: string = body.messages[0].content
    expect(prompt).toContain('stellar test')
    expect(prompt).toContain('Stellar blockchain')
    expect(prompt).toContain('x402 protocol')
    // Deselected source should not be in prompt
    expect(prompt).not.toContain('Serper.dev API')
  })

  it('shows report header with format name after generation', async () => {
    global.fetch = makeMockFetch('Report here.') as any

    render(<ResearchWorkflowPanel results={results} query="stellar" />)

    // Switch to narrative
    await act(async () => {
      fireEvent.click(screen.getByLabelText('NARRATIVE'))
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /generate research report/i }))
    })

    await waitFor(() => {
      const reportHeader = document.querySelector('[class*="font-display"][class*="text-neon-cyan"]')
      expect(reportHeader).not.toBeNull()
    })
  })

  // ── Omitted source footer ────────────────────────────────────────────

  it('shows omitted sources in the footer when sources are deselected', async () => {
    global.fetch = makeMockFetch('Report.') as any

    render(<ResearchWorkflowPanel results={results} query="stellar" />)

    // Deselect source 2
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Include source: x402 protocol'))
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /generate research report/i }))
    })

    await waitFor(() => {
      const footer = screen.queryByLabelText('Source status')
      expect(footer).not.toBeNull()
    })

    const footer = screen.getByLabelText('Source status')
    expect(footer.textContent).toContain('OMITTED')
    expect(footer.textContent).toContain('[2]')
    expect(footer.textContent).toContain('deselected by you')
  })

  it('does not show the source status footer when all sources are used', async () => {
    global.fetch = makeMockFetch('Report.') as any

    render(<ResearchWorkflowPanel results={results} query="stellar" />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /generate research report/i }))
    })

    await waitFor(() => expect(screen.queryByTestId('ai-markdown')).not.toBeNull())

    expect(screen.queryByLabelText('Source status')).toBeNull()
  })

  // ── Error handling ───────────────────────────────────────────────────

  it('shows an error alert when fetch fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network failure')) as any

    render(<ResearchWorkflowPanel results={results} query="stellar" />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /generate research report/i }))
    })

    await waitFor(() => {
      const alert = screen.queryByRole('alert')
      expect(alert).not.toBeNull()
    })
    expect(screen.getByRole('alert').textContent).toContain('Network failure')
  })

  it('shows an error alert when server returns non-ok status', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      headers: { get: () => 'application/json' },
    }) as any

    render(<ResearchWorkflowPanel results={results} query="stellar" />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /generate research report/i }))
    })

    await waitFor(() => {
      const alert = screen.queryByRole('alert')
      expect(alert).not.toBeNull()
    })
    expect(screen.getByRole('alert').textContent).toContain('503')
  })

  // ── State reset on query/results change ─────────────────────────────

  it('resets all state when query prop changes', async () => {
    global.fetch = makeMockFetch('Old report.') as any

    const newResults = [makeResult('10', 'New result')]
    const { rerender } = render(<ResearchWorkflowPanel results={results} query="old query" />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /generate research report/i }))
    })
    await waitFor(() => expect(screen.queryByTestId('ai-markdown')).not.toBeNull())

    rerender(<ResearchWorkflowPanel results={newResults} query="new query" />)

    // Report should be cleared
    expect(screen.queryByTestId('ai-markdown')).toBeNull()
    // New source should appear, selected
    expect(screen.getByLabelText('Include source: New result')).not.toBeNull()
  })

  // ── REGENERATE button ─────────────────────────────────────────────────

  it('shows REGENERATE REPORT label after a report has been generated', async () => {
    global.fetch = makeMockFetch('Report content.') as any

    render(<ResearchWorkflowPanel results={results} query="stellar" />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /generate research report/i }))
    })

    await waitFor(() => {
      const btn = screen.queryByRole('button', { name: /regenerate report/i })
      expect(btn).not.toBeNull()
    })
  })
})
