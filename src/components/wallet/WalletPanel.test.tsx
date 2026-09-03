import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WalletPanel } from './WalletPanel'
import type { WalletState } from '../../hooks/useFreighterWallet'
import { initI18n, loadNamespace } from '../../i18n'

// WalletPanel renders copy through i18next (#345) — mirror main.tsx and
// initialize the `wallet` namespace so labels resolve (e.g. menu aria-label)
// instead of coming back as raw keys.
beforeAll(async () => {
  await initI18n()
  await loadNamespace('wallet')
})

vi.mock('framer-motion', async () => {
  const actual: any = await vi.importActual('framer-motion')
  return {
    ...actual,
    motion: {
      div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
      button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
    },
    AnimatePresence: ({ children }: any) => <>{children}</>,
  }
})

const baseWallet: WalletState = {
  publicKey: 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3',
  connected: true,
  network: 'TESTNET',
  xlmBalance: '100.0000',
  usdcBalance: '2.000000',
  hasUsdcTrustline: false,
  loading: false,
  error: null,
}

const baseHistory = [{ id: '1', hash: 'a'.repeat(64), type: 'payment', amount: '0.0010', asset: 'USDC', from: 'GAAA', to: 'GBBB', timestamp: new Date(Date.now() - 60000).toISOString() }]

describe('WalletPanel — independent resource states', () => {
  it('shows connection error from wallet.error', () => {
    const wallet = { ...baseWallet, error: 'Freighter not found' }
    render(<WalletPanel wallet={wallet} transactions={[]} txLoading={false} onConnect={vi.fn()} onDisconnect={vi.fn()} onRefresh={vi.fn()} />)
    // Need to open panel to see error
    fireEvent.click(screen.getByLabelText('Wallet menu'))
    expect(screen.getByText('Freighter not found')).toBeInTheDocument()
  })

  it('shows balance loading, error and lastUpdated independently', () => {
    const onRefreshBalances = vi.fn()
    const balance = { loading: true, error: null, lastUpdated: null }
    const { rerender } = render(
      <WalletPanel
        wallet={baseWallet}
        transactions={[]}
        txLoading={false}
        balance={balance}
        history={{ loading: false, error: null, lastUpdated: null }}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onRefresh={vi.fn()}
        onRefreshBalances={onRefreshBalances}
      />
    )
    fireEvent.click(screen.getByLabelText('Wallet menu'))
    // balance loading shows spinner - find refresh balances button and check disabled
    expect(screen.getByLabelText('Refresh balances')).toBeDisabled()

    // Rerender with error and lastUpdated
    const lastUpdated = new Date(Date.now() - 120000).toISOString()
    rerender(
      <WalletPanel
        wallet={baseWallet}
        transactions={[]}
        txLoading={false}
        balance={{ loading: false, error: 'Horizon balance down', lastUpdated }}
        history={{ loading: false, error: null, lastUpdated: null }}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onRefresh={vi.fn()}
        onRefreshBalances={onRefreshBalances}
      />
    )
    expect(screen.getByText('Balance: Horizon balance down')).toBeInTheDocument()
    expect(screen.getByText(/Updated/)).toBeInTheDocument()
    // history error not shown
    expect(screen.queryByText(/History: Horizon/)).not.toBeInTheDocument()
  })

  it('shows history loading, error and lastUpdated independently from balance', () => {
    const onRefreshHistory = vi.fn()
    const historyError = 'Horizon history down'
    const historyLastUpdated = new Date(Date.now() - 300000).toISOString()
    render(
      <WalletPanel
        wallet={baseWallet}
        transactions={baseHistory}
        txLoading={true}
        balance={{ loading: false, error: null, lastUpdated: new Date().toISOString() }}
        history={{ loading: true, error: null, lastUpdated: null }}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onRefresh={vi.fn()}
        onRefreshHistory={onRefreshHistory}
      />
    )
    fireEvent.click(screen.getByLabelText('Wallet menu'))
    expect(screen.getByLabelText('Refresh history')).toBeDisabled()
    // also test error rendering
    render(
      <WalletPanel
        wallet={baseWallet}
        transactions={baseHistory}
        txLoading={false}
        balance={{ loading: false, error: null, lastUpdated: null }}
        history={{ loading: false, error: historyError, lastUpdated: historyLastUpdated }}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onRefresh={vi.fn()}
      />
    )
    render(
      <WalletPanel
        wallet={baseWallet}
        transactions={baseHistory}
        txLoading={false}
        history={{ loading: false, error: historyError, lastUpdated: historyLastUpdated }}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onRefresh={vi.fn()}
      />
    )
    // Open panel for second instance (last rendered)
    const buttons = screen.getAllByLabelText('Wallet menu')
    fireEvent.click(buttons[buttons.length - 1])
    expect(screen.getByText('History: Horizon history down')).toBeInTheDocument()
  })

  it('refreshing balance calls onRefreshBalances not onRefresh, and vice versa', () => {
    const onRefresh = vi.fn()
    const onRefreshBalances = vi.fn()
    const onRefreshHistory = vi.fn()
    render(
      <WalletPanel
        wallet={baseWallet}
        transactions={baseHistory}
        txLoading={false}
        balance={{ loading: false, error: null, lastUpdated: null }}
        history={{ loading: false, error: null, lastUpdated: null }}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onRefresh={onRefresh}
        onRefreshBalances={onRefreshBalances}
        onRefreshHistory={onRefreshHistory}
      />
    )
    fireEvent.click(screen.getByLabelText('Wallet menu'))
    fireEvent.click(screen.getByLabelText('Refresh balances'))
    expect(onRefreshBalances).toHaveBeenCalledTimes(1)
    expect(onRefresh).not.toHaveBeenCalled()
    expect(onRefreshHistory).not.toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText('Refresh history'))
    expect(onRefreshHistory).toHaveBeenCalledTimes(1)
  })

  it('balance error does not erase history transactions', () => {
    const balanceWithError = { loading: false, error: 'Balance failed', lastUpdated: null }
    render(
      <WalletPanel
        wallet={baseWallet}
        transactions={baseHistory}
        txLoading={false}
        balance={balanceWithError}
        history={{ loading: false, error: null, lastUpdated: null }}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onRefresh={vi.fn()}
      />
    )
    fireEvent.click(screen.getByLabelText('Wallet menu'))
    expect(screen.getByText('Balance: Balance failed')).toBeInTheDocument()
    // history still shown
    expect(screen.getByText('payment')).toBeInTheDocument()
  })
})
