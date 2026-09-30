import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { forwardRef } from 'react'
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
      div: forwardRef<HTMLDivElement, any>(({ children, ...props }, ref) => <div ref={ref} {...props}>{children}</div>),
      button: forwardRef<HTMLButtonElement, any>(({ children, ...props }, ref) => <button ref={ref} {...props}>{children}</button>),
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
  it('moves focus into the dialog, closes on Escape, and restores trigger focus', async () => {
    render(<WalletPanel wallet={baseWallet} transactions={[]} txLoading={false} onConnect={vi.fn()} onDisconnect={vi.fn()} onRefresh={vi.fn()} />)
    const trigger = screen.getByLabelText('Wallet menu')
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Wallet details' })

    await vi.waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    await vi.waitFor(() => expect(trigger).toHaveFocus())
  })

  it('closes when pointer interaction occurs outside the dialog', () => {
    render(<WalletPanel wallet={baseWallet} transactions={[]} txLoading={false} onConnect={vi.fn()} onDisconnect={vi.fn()} onRefresh={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Wallet menu'))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows connection error from wallet.error', () => {
    const wallet = { ...baseWallet, error: 'Freighter not found' }
    render(<WalletPanel wallet={wallet} transactions={[]} txLoading={false} onConnect={vi.fn()} onDisconnect={vi.fn()} onRefresh={vi.fn()} />)
    // Need to open panel to see error
    fireEvent.click(screen.getByLabelText('Wallet menu'))
    expect(screen.getByText('Freighter not found')).toBeInTheDocument()
  })
})
