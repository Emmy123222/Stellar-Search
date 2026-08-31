import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GroqAssistant } from './GroqAssistant'

// Mock matchMedia if framer-motion requires it
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

describe('GroqAssistant', () => {
  let confirmMock: any
  let createObjectURLMock: any
  let revokeObjectURLMock: any
  
  beforeEach(() => {
    confirmMock = vi.spyOn(window, 'confirm')
    createObjectURLMock = vi.fn().mockReturnValue('blob:test-url')
    revokeObjectURLMock = vi.fn()
    
    global.URL.createObjectURL = createObjectURLMock
    global.URL.revokeObjectURL = revokeObjectURLMock
    
    // mock scrollIntoView
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders and opens', () => {
    render(<GroqAssistant />)
    const openBtn = screen.getAllByRole('button')[0]
    fireEvent.click(openBtn)
    expect(screen.getByText(/Hi! I'm your AI research assistant/)).toBeInTheDocument()
  })

  it('clears conversation when confirmed', async () => {
    render(<GroqAssistant />)
    fireEvent.click(screen.getAllByRole('button')[0])
    
    const clearBtn = screen.getByTitle('Clear conversation')
    confirmMock.mockReturnValue(true)
    
    fireEvent.click(clearBtn)
    expect(confirmMock).toHaveBeenCalledWith('Clear conversation?')
    // System intro is still there after clear
    expect(screen.getByText(/Hi! I'm your AI research assistant/)).toBeInTheDocument()
  })

  it('exports conversation as JSON', async () => {
    render(<GroqAssistant />)
    fireEvent.click(screen.getAllByRole('button')[0])
    
    const exportBtn = screen.getByTitle('Export conversation')
    // First confirm: true for JSON
    // Second confirm: false for system messages
    confirmMock.mockReturnValueOnce(true).mockReturnValueOnce(false)
    
    fireEvent.click(exportBtn)
    expect(confirmMock).toHaveBeenCalledTimes(2)
    expect(createObjectURLMock).toHaveBeenCalled()
  })

  it('exports conversation as Markdown', async () => {
    render(<GroqAssistant />)
    fireEvent.click(screen.getAllByRole('button')[0])
    
    const exportBtn = screen.getByTitle('Export conversation')
    // First confirm: false for Markdown
    // Second confirm: true for system messages
    confirmMock.mockReturnValueOnce(false).mockReturnValueOnce(true)
    
    fireEvent.click(exportBtn)
    expect(confirmMock).toHaveBeenCalledTimes(2)
    expect(createObjectURLMock).toHaveBeenCalled()
  })
})
