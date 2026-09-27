import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PaymentFlowVisualizer } from './PaymentFlowVisualizer'
import type { SearchSession } from '../../hooks/useSearch'
import { readFeeSponsorship } from '../../lib/feeSponsorship'

/**
 * Fee sponsorship & network-fee disclosure (#312).
 *
 * The UI must show who pays the Stellar network fee, surface any estimated
 * payer fee the challenge provided, and require an explicit acknowledgement
 * (never optimistic copy) when that metadata is unknown or changed.
 *
 * Plain matchers are used deliberately here so the assertions do not depend on
 * the jest-dom setup file.
 */

function challengeWith(extra: Record<string, unknown> | undefined) {
  return {
    accepts: [
      { scheme: 'exact', amount: '10000', network: 'stellar:testnet', payTo: 'GABC', maxTimeoutSeconds: 300, extra },
    ],
  }
}

function sessionWith(overrides: Partial<SearchSession> = {}): SearchSession {
  return {
    query: 'stellar',
    results: [],
    txHash: null,
    paidAmount: null,
    status: 'searching',
    step: 2,
    suggestions: [],
    ...overrides,
  }
}

describe('PaymentFlowVisualizer — fee sponsorship (#312)', () => {
  it('renders no fee panel when the session has no sponsorship info', () => {
    render(<PaymentFlowVisualizer session={sessionWith({ sponsorship: null })} />)
    expect(screen.queryByTestId('sponsorship-row')).toBeNull()
  })

  it('shows sponsored status and states that no extra fee applies', () => {
    const sponsorship = readFeeSponsorship(challengeWith({ areFeesSponsored: true }))
    render(<PaymentFlowVisualizer session={sessionWith({ sponsorship })} />)

    expect(screen.getByTestId('sponsorship-row').getAttribute('data-payer')).toBe('sponsor')
    expect(screen.getByTestId('sponsorship-label').textContent).toMatch(/Network fees sponsored/i)
    expect(screen.getByTestId('sponsorship-detail').textContent).toMatch(/StellarSearch covers the Stellar network fee/i)
    expect(screen.queryByTestId('sponsorship-acknowledgement')).toBeNull()
  })

  it('shows a payer-funded status with the challenge-provided estimate', () => {
    const sponsorship = readFeeSponsorship(challengeWith({ areFeesSponsored: false, estimatedFeeStroops: 100 }))
    render(<PaymentFlowVisualizer session={sessionWith({ sponsorship })} />)

    expect(screen.getByTestId('sponsorship-row').getAttribute('data-payer')).toBe('payer')
    expect(screen.getByTestId('sponsorship-label').textContent).toMatch(/You pay network fees/i)
    expect(screen.getByTestId('sponsorship-estimated-fee').textContent).toContain('0.00001 XLM')
    expect(screen.queryByTestId('sponsorship-acknowledgement')).toBeNull()
  })

  it('omits the estimate rather than inventing one', () => {
    const sponsorship = readFeeSponsorship(challengeWith({ areFeesSponsored: false }))
    render(<PaymentFlowVisualizer session={sessionWith({ sponsorship })} />)

    expect(screen.queryByTestId('sponsorship-estimated-fee')).toBeNull()
    expect(screen.getByTestId('sponsorship-detail').textContent).toMatch(/did not state an estimate/i)
  })

  it('requires acknowledgement for an unstated sponsorship and calls back on confirm', async () => {
    const onAcknowledge = vi.fn()
    const sponsorship = readFeeSponsorship(challengeWith({}))
    render(
      <PaymentFlowVisualizer
        session={sessionWith({ sponsorship, awaitingSponsorshipAcknowledgement: true })}
        onAcknowledge={onAcknowledge}
      />,
    )

    expect(screen.getByTestId('sponsorship-row').getAttribute('data-payer')).toBe('unknown')
    const panel = screen.getByTestId('sponsorship-acknowledgement')
    expect(panel.textContent).toMatch(/does not state who pays the network fee/i)
    expect(panel.textContent).toMatch(/Nothing is signed until you confirm/i)

    await userEvent.click(screen.getByTestId('sponsorship-acknowledge-button'))
    expect(onAcknowledge).toHaveBeenCalledTimes(1)
  })

  it('explains a changed sponsorship in the acknowledgement copy', () => {
    const sponsorship = readFeeSponsorship(challengeWith({}), true)
    render(
      <PaymentFlowVisualizer
        session={sessionWith({ sponsorship, awaitingSponsorshipAcknowledgement: true })}
        onAcknowledge={vi.fn()}
      />,
    )

    expect(screen.getByTestId('sponsorship-acknowledgement').textContent).toMatch(/Fee sponsorship changed/i)
  })

  it('does not show the acknowledgement panel until the flow pauses', () => {
    const sponsorship = readFeeSponsorship(challengeWith({}))
    render(
      <PaymentFlowVisualizer
        session={sessionWith({ sponsorship, awaitingSponsorshipAcknowledgement: false })}
        onAcknowledge={vi.fn()}
      />,
    )

    expect(screen.getByTestId('sponsorship-row')).not.toBeNull()
    expect(screen.queryByTestId('sponsorship-acknowledgement')).toBeNull()
  })

  it('omits the confirm control when no handler is supplied', () => {
    const sponsorship = readFeeSponsorship(challengeWith({}))
    render(
      <PaymentFlowVisualizer
        session={sessionWith({ sponsorship, awaitingSponsorshipAcknowledgement: true })}
      />,
    )

    expect(screen.getByTestId('sponsorship-acknowledgement')).not.toBeNull()
    expect(screen.queryByTestId('sponsorship-acknowledge-button')).toBeNull()
  })
})
