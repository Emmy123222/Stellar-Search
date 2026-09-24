import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PaymentFlowVisualizer } from './PaymentFlowVisualizer'
import type { SearchSession } from '../../hooks/useSearch'
import type { ChallengeDeadline } from '../../lib/paymentChallenge'

/**
 * Payment expiry UI (#114).
 *
 * The active challenge deadline must be visible while signing/settlement are in
 * flight, and an expired flow must offer a deliberate retry that obtains a new
 * challenge instead of showing a generic failure.
 */

function sessionWith(overrides: Partial<SearchSession> = {}): SearchSession {
  return {
    query: 'stellar',
    results: [],
    txHash: null,
    paidAmount: null,
    status: 'searching',
    step: 3,
    suggestions: [],
    challenge: null,
    challengeExpired: false,
    ...overrides,
  }
}

function liveDeadline(secondsLeft = 299): ChallengeDeadline {
  const now = Date.now()
  return { issuedAt: now, expiresAt: now + secondsLeft * 1000, maxTimeoutSeconds: 300 }
}

function expiredDeadline(): ChallengeDeadline {
  const now = Date.now()
  return { issuedAt: now - 300_000, expiresAt: now - 1_000, maxTimeoutSeconds: 300 }
}

describe('PaymentFlowVisualizer — challenge deadline (#114)', () => {
  it('renders nothing while the session is idle', () => {
    const { container } = render(<PaymentFlowVisualizer session={sessionWith({ status: 'idle' })} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the countdown for a live challenge during signing/settlement', () => {
    render(<PaymentFlowVisualizer session={sessionWith({ challenge: liveDeadline() })} />)

    const countdown = screen.getByTestId('challenge-countdown')
    expect(countdown).toHaveTextContent(/EXPIRES \d+:\d{2}/)
    expect(screen.queryByTestId('challenge-expired-notice')).not.toBeInTheDocument()
  })

  it('does not show a countdown when the challenge carries no deadline', () => {
    render(<PaymentFlowVisualizer session={sessionWith({ challenge: null })} />)
    expect(screen.queryByTestId('challenge-countdown')).not.toBeInTheDocument()
  })

  it('does not show a countdown on a completed session', () => {
    render(
      <PaymentFlowVisualizer
        session={sessionWith({ status: 'complete', step: 6, challenge: liveDeadline(), txHash: 'abc', paidAmount: '0.001' })}
      />,
    )
    expect(screen.queryByTestId('challenge-countdown')).not.toBeInTheDocument()
  })

  it('flags an expired challenge and offers a fresh challenge', async () => {
    const onRetry = vi.fn()
    render(<PaymentFlowVisualizer session={sessionWith({ challenge: expiredDeadline() })} onRetry={onRetry} />)

    expect(screen.getByTestId('challenge-expired-notice')).toHaveTextContent(/PAYMENT CHALLENGE EXPIRED/)
    // The expired window is never presented as a live countdown.
    expect(screen.queryByTestId('challenge-countdown')).not.toBeInTheDocument()

    await userEvent.click(screen.getByTestId('challenge-retry-button'))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('explains that nothing was sent to the network', () => {
    render(<PaymentFlowVisualizer session={sessionWith({ challenge: expiredDeadline() })} onRetry={vi.fn()} />)

    const notice = screen.getByTestId('challenge-expired-notice')
    expect(notice).toHaveTextContent(/Nothing was sent to the network/i)
    expect(notice).toHaveTextContent(/300s signing window/)
  })

  it('shows the expiry notice on the error state when the hook flagged it', () => {
    render(
      <PaymentFlowVisualizer
        session={sessionWith({
          status: 'error',
          step: 3,
          challenge: expiredDeadline(),
          challengeExpired: true,
          error: 'The payment challenge expired before it could be signed.',
        })}
        onRetry={vi.fn()}
      />,
    )

    expect(screen.getByTestId('challenge-expired-notice')).toBeInTheDocument()
    expect(screen.queryByText('✗ FAILED')).not.toBeInTheDocument()
  })

  it('omits the retry control when no handler is supplied', () => {
    render(<PaymentFlowVisualizer session={sessionWith({ challenge: expiredDeadline(), challengeExpired: true })} />)

    expect(screen.getByTestId('challenge-expired-notice')).toBeInTheDocument()
    expect(screen.queryByTestId('challenge-retry-button')).not.toBeInTheDocument()
  })
})
