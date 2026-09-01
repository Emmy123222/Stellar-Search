import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SpellingCorrectionBanner } from './SpellingCorrectionBanner'

describe('SpellingCorrectionBanner component', () => {
  it('renders nothing when no correction or suggestion is present', () => {
    const { container } = render(
      <SpellingCorrectionBanner
        originalQuery="stellar"
        executedQuery="stellar"
        isCorrected={false}
        onSearch={vi.fn()}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when isDismissed is true', () => {
    const { container } = render(
      <SpellingCorrectionBanner
        originalQuery="stelarr blockchan"
        suggestedQuery="stellar blockchain"
        isCorrected={false}
        isDismissed={true}
        onSearch={vi.fn()}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders auto-correction notification when isCorrected is true', () => {
    const handleSearch = vi.fn()
    render(
      <SpellingCorrectionBanner
        originalQuery="stelarr blockchan"
        executedQuery="stellar blockchain"
        isCorrected={true}
        onSearch={handleSearch}
      />
    )

    expect(screen.getByTestId('spelling-correction-banner')).toBeInTheDocument()
    expect(screen.getByText(/"stellar blockchain"/)).toBeInTheDocument()
    expect(screen.getByText(/auto-corrected from/i)).toBeInTheDocument()

    const searchOriginalBtn = screen.getByTestId('search-original-btn')
    expect(searchOriginalBtn).toBeInTheDocument()

    fireEvent.click(searchOriginalBtn)
    expect(handleSearch).toHaveBeenCalledTimes(1)
    expect(handleSearch).toHaveBeenCalledWith('stelarr blockchan')
  })

  it('renders "Did you mean?" suggestion banner and allows accepting without automatic payment', () => {
    const handleSearch = vi.fn()
    const handleDismiss = vi.fn()

    render(
      <SpellingCorrectionBanner
        originalQuery="stelarr blockchan"
        executedQuery="stelarr blockchan"
        suggestedQuery="stellar blockchain"
        isCorrected={false}
        onSearch={handleSearch}
        onDismiss={handleDismiss}
      />
    )

    expect(screen.getByTestId('spelling-correction-banner')).toBeInTheDocument()
    expect(screen.getByText(/Did you mean:/i)).toBeInTheDocument()
    expect(screen.getByText(/"stellar blockchain"/)).toBeInTheDocument()

    const acceptBtn = screen.getByTestId('accept-suggestion-btn')
    fireEvent.click(acceptBtn)
    expect(handleSearch).toHaveBeenCalledTimes(1)
    expect(handleSearch).toHaveBeenCalledWith('stellar blockchain')
    expect(handleDismiss).not.toHaveBeenCalled()
  })

  it('allows rejecting/dismissing a suggestion without triggering any search or payment', () => {
    const handleSearch = vi.fn()
    const handleDismiss = vi.fn()

    render(
      <SpellingCorrectionBanner
        originalQuery="stelarr blockchan"
        executedQuery="stelarr blockchan"
        suggestedQuery="stellar blockchain"
        isCorrected={false}
        onSearch={handleSearch}
        onDismiss={handleDismiss}
      />
    )

    const rejectBtn = screen.getByTestId('reject-suggestion-btn')
    fireEvent.click(rejectBtn)
    expect(handleDismiss).toHaveBeenCalledTimes(1)
    expect(handleSearch).not.toHaveBeenCalled()
  })
})
