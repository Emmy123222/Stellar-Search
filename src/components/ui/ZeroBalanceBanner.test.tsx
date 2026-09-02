import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ZeroBalanceBanner } from './ZeroBalanceBanner'

const TEST_ACCOUNT = 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3'

describe('ZeroBalanceBanner — wallet and trustline state guidance', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('renders unfunded state with account activation instructions and Stellar Lab link', () => {
    render(
      <ZeroBalanceBanner
        connected={true}
        publicKey={TEST_ACCOUNT}
        usdcBalance="0"
        accountExists={false}
        hasUsdcTrustline={false}
        accountStatus="unfunded"
      />
    )

    expect(screen.getByRole('status')).toHaveAttribute('data-account-status', 'unfunded')
    expect(screen.getByText(/Your Stellar account is not funded/i)).toBeInTheDocument()
    expect(screen.getByText(/minimum XLM reserve/i)).toBeInTheDocument()

    const labLink = screen.getByRole('link', { name: /Fund account on Stellar Lab/i })
    expect(labLink).toHaveAttribute('href', expect.stringContaining('laboratory.stellar.org'))

    const reserveLink = screen.getByRole('link', { name: /Account reserve guide/i })
    expect(reserveLink).toHaveAttribute('href', expect.stringContaining('minimum-account-balance'))
  })

  it('renders no_trustline state with trustline setup guidance and setup guide link', () => {
    render(
      <ZeroBalanceBanner
        connected={true}
        publicKey={TEST_ACCOUNT}
        usdcBalance="0"
        accountExists={true}
        hasUsdcTrustline={false}
        accountStatus="no_trustline"
      />
    )

    expect(screen.getByRole('status')).toHaveAttribute('data-account-status', 'no_trustline')
    expect(screen.getByText(/Your account is active, but you need a USDC trustline/i)).toBeInTheDocument()
    expect(screen.getByText(/Add the USDC trustline in your Freighter wallet/i)).toBeInTheDocument()

    const trustlineLink = screen.getByRole('link', { name: /USDC trustline setup guide/i })
    expect(trustlineLink).toHaveAttribute('href', expect.stringContaining('trustlines'))
  })

  it('renders zero_balance state when trustline exists but USDC balance is zero', () => {
    render(
      <ZeroBalanceBanner
        connected={true}
        publicKey={TEST_ACCOUNT}
        usdcBalance="0.000000"
        accountExists={true}
        hasUsdcTrustline={true}
        accountStatus="zero_balance"
      />
    )

    expect(screen.getByRole('status')).toHaveAttribute('data-account-status', 'zero_balance')
    expect(screen.getByText(/You need testnet USDC to search/i)).toBeInTheDocument()

    const faucetLink = screen.getByRole('link', { name: /Get free USDC/i })
    expect(faucetLink).toHaveAttribute('href', expect.stringContaining('laboratory.stellar.org'))
  })

  it('infers status correctly when accountStatus is not explicitly provided', () => {
    const { rerender } = render(
      <ZeroBalanceBanner
        connected={true}
        publicKey={TEST_ACCOUNT}
        usdcBalance="0"
        accountExists={false}
      />
    )
    expect(screen.getByRole('status')).toHaveAttribute('data-account-status', 'unfunded')

    rerender(
      <ZeroBalanceBanner
        connected={true}
        publicKey={TEST_ACCOUNT}
        usdcBalance="0"
        accountExists={true}
        hasUsdcTrustline={false}
      />
    )
    expect(screen.getByRole('status')).toHaveAttribute('data-account-status', 'no_trustline')

    rerender(
      <ZeroBalanceBanner
        connected={true}
        publicKey={TEST_ACCOUNT}
        usdcBalance="0"
        accountExists={true}
        hasUsdcTrustline={true}
      />
    )
    expect(screen.getByRole('status')).toHaveAttribute('data-account-status', 'zero_balance')
  })

  it('does not render banner when account is funded with positive USDC balance', () => {
    render(
      <ZeroBalanceBanner
        connected={true}
        publicKey={TEST_ACCOUNT}
        usdcBalance="5.000000"
        accountExists={true}
        hasUsdcTrustline={true}
        accountStatus="funded"
      />
    )

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('does not render when wallet is disconnected', () => {
    render(
      <ZeroBalanceBanner
        connected={false}
        publicKey={null}
        usdcBalance="0"
        accountExists={false}
        accountStatus="unfunded"
      />
    )

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('allows user to dismiss banner and preserves dismissal in sessionStorage', async () => {
    const { rerender } = render(
      <ZeroBalanceBanner
        connected={true}
        publicKey={TEST_ACCOUNT}
        usdcBalance="0"
        accountStatus="unfunded"
      />
    )

    const dismissBtn = screen.getByRole('button', { name: /Dismiss zero-balance notice/i })
    expect(dismissBtn).toBeInTheDocument()

    fireEvent.click(dismissBtn)
    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })
    expect(sessionStorage.getItem(`zero-balance-banner-dismissed:${TEST_ACCOUNT}`)).toBe('1')

    // Rerendering retains dismissal
    rerender(
      <ZeroBalanceBanner
        connected={true}
        publicKey={TEST_ACCOUNT}
        usdcBalance="0"
        accountStatus="unfunded"
      />
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
