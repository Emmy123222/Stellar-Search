import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SearchResults } from './SearchResults'
import type { SearchResult } from '../../hooks/useSearch'

// framer-motion's exit animations never "complete" under jsdom/fake timers,
// which leaves AnimatePresence nodes stuck in the tree. Render plain elements
// so state-driven mount/unmount stays synchronous and testable.
const MOTION_ONLY_PROPS = [
  'initial', 'animate', 'exit', 'transition', 'whileHover', 'whileTap', 'layout', 'variants',
]

vi.mock('framer-motion', () => {
  // Cache one component per tag — a Proxy `get` trap that manufactures a new
  // component type on every access causes React to remount the element (and
  // its DOM node) on every render, since component identity changed.
  const cache = new Map<string, any>()
  const passthrough = (tag: string) => {
    if (!cache.has(tag)) {
      cache.set(
        tag,
        React.forwardRef((props: any, ref: React.Ref<any>) => {
          const rest = { ...props }
          for (const motionProp of MOTION_ONLY_PROPS) delete rest[motionProp]
          return React.createElement(tag, { ...rest, ref })
        }),
      )
    }
    return cache.get(tag)
  }
  return {
    motion: new Proxy({}, { get: (_target, tag: string) => passthrough(tag) }),
    AnimatePresence: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  }
})

const results: SearchResult[] = [
  {
    id: '1',
    title: 'Stellar Docs',
    url: 'https://stellar.org/docs',
    description: 'Official Stellar documentation',
    source: 'stellar.org',
    relevanceScore: 0.95,
    publishedAt: '2024-01-01',
  },
  {
    id: '2',
    title: 'Stellar Expert',
    url: 'https://stellar.expert',
    description: 'Block explorer for Stellar',
    source: 'stellar.expert',
    relevanceScore: 0.8,
  },
]

function sseStream(raw: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(raw)
  let sent = false
  return new ReadableStream({
    pull(controller) {
      if (!sent) {
        controller.enqueue(bytes)
        sent = true
      } else {
        controller.close()
      }
    },
  })
}

function jsonHeaders() {
  return { get: (key: string) => (key.toLowerCase() === 'content-type' ? 'application/json' : null) }
}

function sseHeaders() {
  return { get: (key: string) => (key.toLowerCase() === 'content-type' ? 'text/event-stream' : null) }
}

describe('SearchResults — export / copy / summary regression', () => {
  let lastAnchor: HTMLAnchorElement | null

  beforeEach(() => {
    lastAnchor = null
    const realCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreateElement(tag)
      if (tag === 'a') lastAnchor = el as HTMLAnchorElement
      return el
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    ;(URL as any).createObjectURL = vi.fn(() => 'blob:mock-url')
    ;(URL as any).revokeObjectURL = vi.fn()

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })
    document.execCommand = vi.fn().mockReturnValue(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  describe('export', () => {
    it('exports results as JSON with a timestamped filename', async () => {
      render(<SearchResults results={results} query="stellar" />)
      fireEvent.click(screen.getByLabelText('Export search results'))
      fireEvent.click(screen.getByText('JSON Format'))

      expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
      const blob = (URL.createObjectURL as any).mock.calls[0][0] as Blob
      expect(blob.type).toBe('application/json')
      expect(JSON.parse(await blob.text())).toEqual(results)

      expect(lastAnchor?.download).toMatch(/^search-results-\d+\.json$/)
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
      // Menu closes after export
      expect(screen.queryByText('JSON Format')).not.toBeInTheDocument()
    })

    it('exports results as CSV with escaped quotes in fields', async () => {
      const withQuotes: SearchResult[] = [{ ...results[0], title: 'Say "Hello" World' }]
      render(<SearchResults results={withQuotes} query="stellar" />)
      fireEvent.click(screen.getByLabelText('Export search results'))
      fireEvent.click(screen.getByText('CSV Format'))

      const blob = (URL.createObjectURL as any).mock.calls[0][0] as Blob
      expect(blob.type).toBe('text/csv')
      const text = await blob.text()
      expect(text.split('\n')[0]).toBe('Title,URL,Description,Source,Relevance Score')
      expect(text).toContain('"Say ""Hello"" World"')
      expect(lastAnchor?.download).toMatch(/^search-results-\d+\.csv$/)
    })

    it('toggles the export menu open and closed', () => {
      render(<SearchResults results={results} query="stellar" />)
      expect(screen.queryByText('JSON Format')).not.toBeInTheDocument()
      fireEvent.click(screen.getByLabelText('Export search results'))
      expect(screen.getByText('JSON Format')).toBeInTheDocument()
      fireEvent.click(screen.getByLabelText('Export search results'))
      expect(screen.queryByText('JSON Format')).not.toBeInTheDocument()
    })
  })

  describe('copy to clipboard', () => {
    it('copies the result URL and shows a confirmation that resets after 1.5s', async () => {
      vi.useFakeTimers()
      render(<SearchResults results={results} query="stellar" />)
      const copyButtons = screen.getAllByLabelText('Copy URL to clipboard')

      await act(async () => {
        fireEvent.click(copyButtons[0])
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(results[0].url)
      expect(screen.getByText('Copied!')).toBeInTheDocument()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500)
      })
      expect(screen.queryByText('Copied!')).not.toBeInTheDocument()
    })

    it('falls back to execCommand when the async clipboard API rejects', async () => {
      ;(navigator.clipboard.writeText as any).mockRejectedValue(new Error('denied'))
      render(<SearchResults results={results} query="stellar" />)
      const copyButtons = screen.getAllByLabelText('Copy URL to clipboard')

      fireEvent.click(copyButtons[0])

      await waitFor(() => expect(document.execCommand).toHaveBeenCalledWith('copy'))
      expect(await screen.findByText('Copied!')).toBeInTheDocument()
    })

    it('does not clear a newer copy confirmation when an older timeout fires', async () => {
      vi.useFakeTimers()
      render(<SearchResults results={results} query="stellar" />)
      const copyButtons = screen.getAllByLabelText('Copy URL to clipboard')

      await act(async () => {
        fireEvent.click(copyButtons[0]) // copy A at t=0
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(screen.getByText('Copied!')).toBeInTheDocument()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000) // t=1000
        fireEvent.click(copyButtons[1]) // copy B at t=1000
        await vi.advanceTimersByTimeAsync(0)
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500) // t=1500 — A's stale timeout fires
      })
      // B's confirmation (fires at t=2500) must still be visible
      expect(screen.getByText('Copied!')).toBeInTheDocument()
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(results[1].url)
    })
  })

  describe('AI summary', () => {
    it('requests a summary and renders the non-streaming JSON fallback', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        headers: jsonHeaders(),
        json: () => Promise.resolve({ content: 'Stellar is a payments network.' }),
      })
      vi.stubGlobal('fetch', fetchMock)

      render(<SearchResults results={results} query="stellar" />)
      fireEvent.click(screen.getByRole('button', { name: /SUMMARIZE/i }))

      expect(await screen.findByText('Stellar is a payments network.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'REGENERATE' })).toBeInTheDocument()

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/ai/chat'),
        expect.objectContaining({ method: 'POST' }),
      )
      const body = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(body.messages[0].content).toContain('stellar')
    })

    it('streams SSE delta events and accumulates the summary text', async () => {
      const raw =
        'event: delta\ndata: {"content":"Stellar "}\n\n' +
        'event: delta\ndata: {"content":"is fast."}\n\n' +
        'event: done\ndata: {"model":"llama-3.3-70b-versatile"}\n\n'

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, headers: sseHeaders(), body: sseStream(raw) }),
      )

      render(<SearchResults results={results} query="stellar" />)
      fireEvent.click(screen.getByRole('button', { name: /SUMMARIZE/i }))

      await waitFor(() => expect(screen.getByText('Stellar is fast.')).toBeInTheDocument())
      expect(screen.getByRole('button', { name: 'REGENERATE' })).toBeInTheDocument()
    })

    it('surfaces a sanitized error message from an SSE error event', async () => {
      const raw =
        'event: error\ndata: {"error":"AI assistant is temporarily unavailable. Please try again later."}\n\n'
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, headers: sseHeaders(), body: sseStream(raw) }),
      )

      render(<SearchResults results={results} query="stellar" />)
      fireEvent.click(screen.getByRole('button', { name: /SUMMARIZE/i }))

      expect(
        await screen.findByText(/AI assistant is temporarily unavailable/),
      ).toBeInTheDocument()
      // Never surface a raw Groq SDK error to the user
      expect(screen.queryByText(/Groq AI error/i)).not.toBeInTheDocument()
    })

    it('shows an error when the server responds with a non-OK status', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, headers: jsonHeaders() }))

      render(<SearchResults results={results} query="stellar" />)
      fireEvent.click(screen.getByRole('button', { name: /SUMMARIZE/i }))

      expect(await screen.findByText(/Server error 502/)).toBeInTheDocument()
    })

    it('disables the summarize button while a request is in flight', async () => {
      let resolveFetch: (value: any) => void
      const pending = new Promise((resolve) => {
        resolveFetch = resolve
      })
      vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending))

      render(<SearchResults results={results} query="stellar" />)
      fireEvent.click(screen.getByRole('button', { name: /SUMMARIZE/i }))

      const button = await screen.findByRole('button', { name: /SUMMARIZING/i })
      expect(button).toBeDisabled()

      resolveFetch!({ ok: true, headers: jsonHeaders(), json: () => Promise.resolve({ content: 'Done.' }) })
      expect(await screen.findByText('Done.')).toBeInTheDocument()
    })
  })
})
