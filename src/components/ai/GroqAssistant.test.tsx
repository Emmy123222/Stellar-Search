import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GroqAssistant } from './GroqAssistant'

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

describe('GroqAssistant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  it('renders floating button initially', () => {
    render(<GroqAssistant />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('opens chat panel when clicked and allows retry on failure', async () => {
    render(<GroqAssistant />)
    
    // Open chat
    const button = screen.getByRole('button')
    fireEvent.click(button)

    // Wait for the panel to open
    expect(screen.getByPlaceholderText('Ask anything...')).toBeInTheDocument()

    // Send a message
    const input = screen.getByPlaceholderText('Ask anything...')
    fireEvent.change(input, { target: { value: 'Hello' } })
    
    // Mock a failed fetch
    ;(global.fetch as any).mockRejectedValueOnce(new Error('Network error'))
    
    const sendButton = screen.getAllByRole('button').find(b => b.querySelector('svg.text-neon-cyan'))
    fireEvent.click(sendButton!)

    // Wait for error message
    await waitFor(() => {
      expect(screen.getByText(/Could not reach AI server/)).toBeInTheDocument()
    })

    // Verify Retry button appears
    const retryButton = screen.getByText('Retry')
    expect(retryButton).toBeInTheDocument()

    // Mock successful fetch for retry
    ;(global.fetch as any).mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ content: 'Hello! How can I help?', model: 'llama-3.1-8b-instant' })
    })

    // Click retry
    fireEvent.click(retryButton)

    // Ensure the network request is made again
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })
    
    // Check successful response replaced the error
    await waitFor(() => {
      expect(screen.queryByText(/Could not reach AI server/)).not.toBeInTheDocument()
      expect(screen.getByText('Hello! How can I help?')).toBeInTheDocument()
    })
  })
})
