import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DashboardPage } from './DashboardPage'
import { settleSpend, reserveSpend, SPEND_CONFIG_KEY } from '../lib/spendingLimits'

function stubLocalStorage() {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
  })
  return store
}

function renderDashboard() {
  return render(
    <DashboardPage
      transactions={[]}
      txLoading={false}
      publicKey={null}
      usdcBalance="10.0"
      xlmBalance="100.0"
      onRefresh={vi.fn()}
    />
  )
}

describe('DashboardPage — spending limits (#313)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stubLocalStorage()
  })

  it('renders the spending limits card with safe defaults', () => {
    renderDashboard()
    expect(screen.getByText(/SPENDING LIMITS/i)).toBeInTheDocument()
    expect(screen.getByText('ENFORCED')).toBeInTheDocument()
    expect(screen.getByText(/0 \/ 0\.01 USDC/)).toBeInTheDocument()
    expect(screen.getByText(/0 \/ 0\.05 USDC/)).toBeInTheDocument()
    expect(screen.getByLabelText('Session spending cap in USDC')).toHaveValue(0.01)
    expect(screen.getByLabelText('Daily spending cap in USDC')).toHaveValue(0.05)
  })

  it('displays verified spend from the ledger', () => {
    settleSpend('0.001')
    settleSpend('0.001')
    renderDashboard()
    expect(screen.getByText(/0\.002 \/ 0\.01 USDC/)).toBeInTheDocument()
  })

  it('shows in-flight reservations', () => {
    // A search started in another tab reserves its cost.
    reserveSpend('0.001')
    renderDashboard()
    expect(screen.getByText(/1 in flight/)).toBeInTheDocument()
  })

  it('requires confirmation when raising a cap', async () => {
    renderDashboard()
    const dailyInput = screen.getByLabelText('Daily spending cap in USDC')
    fireEvent.change(dailyInput, { target: { value: '0.1' } })
    fireEvent.click(screen.getByText('SAVE CAPS'))

    // Confirmation panel appears, cap is NOT yet saved.
    expect(screen.getByText(/raises your daily cap from 0\.05 to 0\.1 USDC/i)).toBeInTheDocument()
    const stored = JSON.parse(localStorage.getItem(SPEND_CONFIG_KEY) || '{}')
    expect(stored.dailyCap ?? '0.05').toBe('0.05')

    fireEvent.click(screen.getByText('CONFIRM RAISE'))

    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(SPEND_CONFIG_KEY) || '{}')
      expect(saved.dailyCap).toBe('0.1')
    })
    expect(screen.queryByText(/CONFIRM RAISE/)).not.toBeInTheDocument()
  })

  it('saves a lowered cap without confirmation', async () => {
    localStorage.setItem(
      SPEND_CONFIG_KEY,
      JSON.stringify({ enabled: true, sessionCap: '0.01', dailyCap: '0.05' })
    )
    renderDashboard()
    const dailyInput = screen.getByLabelText('Daily spending cap in USDC')
    fireEvent.change(dailyInput, { target: { value: '0.02' } })
    fireEvent.click(screen.getByText('SAVE CAPS'))

    expect(screen.queryByText(/CONFIRM RAISE/)).not.toBeInTheDocument()
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(SPEND_CONFIG_KEY) || '{}')
      expect(saved.dailyCap).toBe('0.02')
    })
  })

  it('rejects invalid cap input', () => {
    renderDashboard()
    const sessionInput = screen.getByLabelText('Session spending cap in USDC')
    fireEvent.change(sessionInput, { target: { value: 'abc' } })
    fireEvent.click(screen.getByText('SAVE CAPS'))
    expect(screen.getByText(/Enter valid USDC amounts/)).toBeInTheDocument()
  })

  it('cancelling a raise keeps the previous caps', async () => {
    renderDashboard()
    const sessionInput = screen.getByLabelText('Session spending cap in USDC')
    fireEvent.change(sessionInput, { target: { value: '0.05' } })
    fireEvent.click(screen.getByText('SAVE CAPS'))
    fireEvent.click(screen.getByText('CANCEL'))

    expect(screen.queryByText(/CONFIRM RAISE/)).not.toBeInTheDocument()
    const stored = JSON.parse(localStorage.getItem(SPEND_CONFIG_KEY) || '{}')
    expect(stored.sessionCap ?? '0.01').toBe('0.01')
  })

  it('toggle reflects and disables the guard', () => {
    renderDashboard()
    fireEvent.click(screen.getByText('ENFORCED'))
    expect(screen.getByText('OFF')).toBeInTheDocument()
    expect(screen.getByLabelText('Session spending cap in USDC')).toBeDisabled()
  })
})
