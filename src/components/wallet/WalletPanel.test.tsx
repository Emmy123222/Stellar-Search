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

describe('WalletPanel — independent resource states', () => {
  it('shows connection error from wallet.error', () => {
    const wallet = { ...baseWallet, error: 'Freighter not found' }
    render(<WalletPanel wallet={wallet} transactions={[]} txLoading={false} onConnect={vi.fn()} onDisconnect={vi.fn()} onRefresh={vi.fn()} />)
    // Need to open panel to see error
    fireEvent.click(screen.getByLabelText('Wallet menu'))
    expect(screen.getByText('Freighter not found')).toBeInTheDocument()
  })
})
