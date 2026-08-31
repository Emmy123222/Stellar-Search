import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { GroqAssistant } from './GroqAssistant'

// Mock scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn()

describe('GroqAssistant Accessibility & Dialog Semantics (Issue #152)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders trigger button with accessible attributes and label', () => {
    render(<GroqAssistant />)
    const trigger = screen.getByRole('button', { name: /open ai research assistant/i })
    expect(trigger).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens dialog with proper dialog role and modal semantics on click', async () => {
    render(<GroqAssistant />)
    const trigger = screen.getByRole('button', { name: /open ai research assistant/i })
    fireEvent.click(trigger)

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-labelledby', 'groq-assistant-title')
    expect(dialog).toHaveAttribute('aria-describedby', 'groq-assistant-desc')

    const closeBtn = screen.getByRole('button', { name: /close ai research assistant/i })
    expect(closeBtn).toBeInTheDocument()
  })

  it('closes dialog when Escape key is pressed', async () => {
    render(<GroqAssistant />)
    const trigger = screen.getByRole('button', { name: /open ai research assistant/i })
    fireEvent.click(trigger)

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('provides accessible model dropdown selection', async () => {
    render(<GroqAssistant />)
    const trigger = screen.getByRole('button', { name: /open ai research assistant/i })
    fireEvent.click(trigger)

    const modelSelector = await screen.findByRole('button', { name: /select ai model/i })
    expect(modelSelector).toBeInTheDocument()
    expect(modelSelector).toHaveAttribute('aria-haspopup', 'listbox')
    expect(modelSelector).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(modelSelector)
    expect(modelSelector).toHaveAttribute('aria-expanded', 'true')

    const listbox = screen.getByRole('listbox')
    expect(listbox).toBeInTheDocument()

    const options = screen.getAllByRole('option')
    expect(options.length).toBeGreaterThanOrEqual(3)
  })
})
