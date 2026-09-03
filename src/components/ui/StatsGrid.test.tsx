/**
 * src/components/ui/StatsGrid.test.tsx
 *
 * Covers the statistics panel's handling of the shared health contract (#226).
 *
 * The bug this guards: a Vercel deployment omits the activity counters, the
 * grid coalesced the absent values to `0` / `'0.00'`, and the result was
 * "0 queries · $0.00 settled · 0ms" rendered beside a live green "SERVER
 * ONLINE" pulse. These tests pin the three distinct states — genuine zero,
 * unmeasured, and unreachable — and the affordances that separate them.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { StatsGrid } from './StatsGrid'
import {
  MEASURED_STAT_FIELDS,
  SERVERLESS_STATS_UNAVAILABLE_REASON,
  declareStatsSupported,
  declareStatsUnsupported,
} from '../../lib/serverHealth'

const fetchServerStats = vi.fn()

vi.mock('../../lib/stellar', () => ({ fetchServerStats: (...args: unknown[]) => fetchServerStats(...args) }))
vi.mock('../../hooks/usePageVisible', () => ({ usePageVisible: () => true }))
vi.mock('framer-motion', () => ({
  motion: new Proxy({} as Record<string, unknown>, {
    get: (_target, tag: string) =>
      ({ children, ...props }: any) => {
        const skip = ['initial', 'animate', 'transition', 'exit', 'whileHover', 'whileTap']
        const rest = Object.fromEntries(Object.entries(props).filter(([k]) => !skip.includes(k)))
        return <div data-motion={tag} {...rest}>{children}</div>
      },
  }),
}))

const CONFIG = {
  status: 'ok',
  network: 'stellar:testnet',
  pricePerQuery: '0.001 USDC',
  protocol: 'x402',
  facilitator: 'https://www.x402.org/facilitator',
  serperApiConfigured: true,
  groqApiConfigured: true,
  receivingAddressConfigured: true,
}

const EXPRESS_ACTIVE = {
  ...CONFIG,
  totalQueries: 1234,
  totalUsdcSettled: '1.2340',
  avgLatencyMs: 412,
  uptime: '7m',
  ...declareStatsSupported(),
}

/** A real Express server that has genuinely served nothing yet. */
const EXPRESS_FRESH = {
  ...CONFIG,
  totalQueries: 0,
  totalUsdcSettled: '0.0000',
  avgLatencyMs: 0,
  uptime: '3s',
  ...declareStatsSupported(),
}

const SERVERLESS = {
  ...CONFIG,
  timestamp: '2026-09-02T12:00:00.000Z',
  ...declareStatsUnsupported(SERVERLESS_STATS_UNAVAILABLE_REASON),
}

const value = (field: string) => screen.getByTestId(`stat-value-${field}`)

beforeEach(() => {
  fetchServerStats.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

// ─── Primary flow: a runtime that measures ───────────────────────────────────

describe('StatsGrid — Express deployment (statistics supported)', () => {
  it('renders live counters and marks the server online', async () => {
    fetchServerStats.mockResolvedValue(EXPRESS_ACTIVE)
    render(<StatsGrid />)

    await waitFor(() => expect(value('totalQueries')).toHaveTextContent('1,234'))
    expect(value('totalUsdcSettled')).toHaveTextContent('$1.2340')
    expect(value('avgLatencyMs')).toHaveTextContent('412ms')
    expect(value('uptime')).toHaveTextContent('7m')
    expect(screen.getByText(/SERVER ONLINE/)).toBeInTheDocument()
  })

  it('renders a genuine zero as 0, not as unavailable', async () => {
    // A freshly started server really has served no queries. That is a
    // measurement and must display as such.
    fetchServerStats.mockResolvedValue(EXPRESS_FRESH)
    render(<StatsGrid />)

    await waitFor(() => expect(value('totalQueries')).toHaveTextContent('0'))
    expect(value('totalUsdcSettled')).toHaveTextContent('$0.0000')
    expect(value('avgLatencyMs')).toHaveTextContent('0ms')
    expect(value('uptime')).toHaveTextContent('3s')

    for (const field of MEASURED_STAT_FIELDS) {
      expect(value(field)).toHaveAttribute('data-available', 'true')
      expect(value(field)).not.toHaveTextContent('n/a')
    }
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('shows the live pulse only for measured cards', async () => {
    fetchServerStats.mockResolvedValue(EXPRESS_ACTIVE)
    render(<StatsGrid />)

    await waitFor(() => expect(value('totalQueries')).toHaveTextContent('1,234'))
    for (const field of MEASURED_STAT_FIELDS) {
      expect(screen.getByTestId(`live-indicator-${field}`)).toBeInTheDocument()
    }
  })
})

// ─── The issue: a runtime that does not measure ──────────────────────────────

describe('StatsGrid — serverless deployment (statistics unsupported)', () => {
  it('renders n/a rather than zero for every unmeasured counter', async () => {
    fetchServerStats.mockResolvedValue(SERVERLESS)
    render(<StatsGrid />)

    await waitFor(() => expect(value('totalQueries')).toHaveTextContent('n/a'))
    for (const field of MEASURED_STAT_FIELDS) {
      expect(value(field)).toHaveTextContent('n/a')
      expect(value(field)).toHaveAttribute('data-available', 'false')
    }
    // The specific regression: none of these may read as a real measurement.
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
    expect(screen.queryByText('0ms')).not.toBeInTheDocument()
  })

  it('still reports the server as online, because it is', async () => {
    fetchServerStats.mockResolvedValue(SERVERLESS)
    render(<StatsGrid />)

    await waitFor(() => expect(screen.getByText(/SERVER ONLINE/)).toBeInTheDocument())
  })

  it('explains once, at the panel level, why the counters are missing', async () => {
    fetchServerStats.mockResolvedValue(SERVERLESS)
    render(<StatsGrid />)

    const note = await screen.findByRole('note')
    expect(note).toHaveTextContent(/Live counters are not available on this deployment/)
    expect(note).toHaveTextContent(/stateless and scale to zero/)
  })

  it('suppresses the live pulse and exposes the reason to assistive tech', async () => {
    fetchServerStats.mockResolvedValue(SERVERLESS)
    render(<StatsGrid />)

    await waitFor(() => expect(value('totalQueries')).toHaveTextContent('n/a'))
    for (const field of MEASURED_STAT_FIELDS) {
      // No pulse: it signals "live measurement".
      expect(screen.queryByTestId(`live-indicator-${field}`)).not.toBeInTheDocument()
      expect(value(field)).toHaveAttribute('title', SERVERLESS_STATS_UNAVAILABLE_REASON)
    }
    expect(screen.getAllByText(/is not reported by this deployment/)).toHaveLength(MEASURED_STAT_FIELDS.length)
  })
})

// ─── Failure and boundary paths ──────────────────────────────────────────────

describe('StatsGrid — failure and boundary paths', () => {
  it('shows n/a and an offline server when health cannot be reached', async () => {
    fetchServerStats.mockResolvedValue(null)
    render(<StatsGrid />)

    await waitFor(() => expect(screen.getByText(/SERVER OFFLINE/)).toBeInTheDocument())
    for (const field of MEASURED_STAT_FIELDS) {
      expect(value(field)).toHaveTextContent('n/a')
      expect(value(field)).toHaveAttribute('data-available', 'false')
    }
  })

  it('does not keep showing stale counters after the server goes away', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    fetchServerStats.mockResolvedValueOnce(EXPRESS_ACTIVE).mockResolvedValue(null)
    render(<StatsGrid pollingIntervalMs={1000} />)

    await waitFor(() => expect(value('totalQueries')).toHaveTextContent('1,234'))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    await waitFor(() => expect(screen.getByText(/SERVER OFFLINE/)).toBeInTheDocument())
    expect(value('totalQueries')).toHaveTextContent('n/a')
  })

  it('treats a pre-contract payload with no counters as unavailable, not zero', async () => {
    // A deployment that predates #226: no declaration and no values.
    fetchServerStats.mockResolvedValue({ ...CONFIG })
    render(<StatsGrid />)

    await waitFor(() => expect(value('totalQueries')).toHaveTextContent('n/a'))
    expect(await screen.findByRole('note')).toHaveTextContent(/did not declare/)
  })

  it('still reads counters from a pre-contract Express payload', async () => {
    fetchServerStats.mockResolvedValue({ ...CONFIG, totalQueries: 7, totalUsdcSettled: '0.0070', avgLatencyMs: 99, uptime: '1m' })
    render(<StatsGrid />)

    await waitFor(() => expect(value('totalQueries')).toHaveTextContent('7'))
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('renders a mixed payload per field', async () => {
    fetchServerStats.mockResolvedValue({
      ...EXPRESS_ACTIVE,
      unsupportedFields: ['avgLatencyMs'],
      statsUnavailableReason: 'Latency sampling is disabled on this deployment.',
    })
    render(<StatsGrid />)

    await waitFor(() => expect(value('totalQueries')).toHaveTextContent('1,234'))
    expect(value('avgLatencyMs')).toHaveTextContent('n/a')
    expect(value('avgLatencyMs')).toHaveAttribute('title', 'Latency sampling is disabled on this deployment.')
    // Some statistics are live, so no panel-wide disclaimer.
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })
})
