import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LiveTicker } from './LiveTicker'

describe('LiveTicker — accessibility', () => {
  it('exposes exactly one semantic copy of each item to assistive tech', () => {
    render(<LiveTicker walletConnected={false} />)
    expect(screen.getAllByText('PROTOCOL').filter(e => !e.closest('[aria-hidden="true"]'))).toHaveLength(1)
    expect(screen.getAllByText('x402').filter(e => !e.closest('[aria-hidden="true"]'))).toHaveLength(1)
  })

  it('hides the duplicated loop copy from screen readers', () => {
    const { container } = render(<LiveTicker walletConnected={false} />)
    const hidden = container.querySelector('[aria-hidden="true"]')
    expect(hidden).not.toBeNull()
    expect(hidden?.textContent).toContain('PROTOCOL')
  })

  it('exposes the ticker as a focusable marquee region', () => {
    render(<LiveTicker walletConnected={true} />)
    const marquee = screen.getByRole('marquee')
    expect(marquee).toHaveAttribute('tabindex', '0')
  })

  it('reflects wallet connection status', () => {
    render(<LiveTicker walletConnected={true} />)
    expect(screen.getAllByText('WALLET CONNECTED').filter(e => !e.closest('[aria-hidden="true"]'))).toHaveLength(1)
  })
})
