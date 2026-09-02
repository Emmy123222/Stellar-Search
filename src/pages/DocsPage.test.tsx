/**
 * src/pages/DocsPage.test.tsx
 *
 * Covers the public documentation of the paid image and news HTTP endpoints.
 *
 * The DocsPage is the in-app half of the API reference, so it must stay in
 * step with the server contract: the `count` bounds and `freshness` enum it
 * advertises are asserted against `src/lib/paramValidation.ts` (the same module
 * the routes validate with), and the x402 challenge it shows is asserted
 * against the constants the middleware pays out to. A drift in either place
 * fails here rather than misleading an integrator.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { DocsPage } from './DocsPage'
import { IMAGES_COUNT, NEWS_COUNT, SEARCH_COUNT, FRESHNESS_VALUES } from '../lib/paramValidation'
import { AMOUNT_USDC, AMOUNT_STROOPS, USDC_CONTRACT, STELLAR_NETWORK } from '../lib/constants'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}))
vi.mock('../i18n', () => ({ loadNamespace: vi.fn() }))
/** Animation props are dropped so React does not warn about unknown DOM attrs. */
const MOTION_ONLY_PROPS = ['initial', 'animate', 'transition', 'exit', 'whileHover', 'whileTap']

vi.mock('framer-motion', () => ({
  motion: new Proxy({} as Record<string, unknown>, {
    get: (_target, tag: string) =>
      ({ children, ...props }: any) => {
        const rest = Object.fromEntries(Object.entries(props).filter(([k]) => !MOTION_ONLY_PROPS.includes(k)))
        return <div data-motion={tag} {...rest}>{children}</div>
      },
  }),
}))

/** Returns the endpoint card whose heading code block is `path`. */
function endpointCard(path: string): HTMLElement {
  const code = screen.getByText(path, { selector: 'code' })
  const card = code.closest('[data-motion="div"]')
  if (!card) throw new Error(`No endpoint card found for ${path}`)
  return card as HTMLElement
}

describe('DocsPage — paid endpoint documentation', () => {
  beforeEach(() => {
    render(<DocsPage />)
  })

  it('documents all three paid endpoints', () => {
    expect(screen.getByRole('heading', { name: /paid endpoints/i })).toBeInTheDocument()
    for (const path of ['/search', '/images', '/news']) {
      expect(endpointCard(path)).toBeTruthy()
    }
  })

  it('shows the per-request price for each endpoint', () => {
    for (const path of ['/search', '/images', '/news']) {
      expect(within(endpointCard(path)).getByText(`${AMOUNT_USDC} USDC`)).toBeInTheDocument()
    }
  })

  // ── Parameters and limits ──────────────────────────────────────────────────

  it('documents the count bounds that the server actually enforces', () => {
    const cases: [string, typeof SEARCH_COUNT][] = [
      ['/search', SEARCH_COUNT],
      ['/images', IMAGES_COUNT],
      ['/news', NEWS_COUNT],
    ]
    for (const [path, bounds] of cases) {
      const card = endpointCard(path)
      expect(within(card).getByText('count')).toBeInTheDocument()
      // e.g. "1–10 (default 10)" — the exact bounds from paramValidation.ts.
      expect(within(card).getByText(`${bounds.min}–${bounds.max} (default ${bounds.default})`)).toBeInTheDocument()
    }
  })

  it('documents the freshness enum for /search and /news', () => {
    const expected = FRESHNESS_VALUES.join(' · ')
    for (const path of ['/search', '/news']) {
      expect(within(endpointCard(path)).getByText(expected)).toBeInTheDocument()
    }
  })

  it('states that /images does not support freshness', () => {
    expect(within(endpointCard('/images')).getByText('not supported')).toBeInTheDocument()
  })

  it('explains that invalid parameters return 400 before any payment challenge', () => {
    const blurb = screen.getByText(/validated/i, { selector: 'p' })
    expect(blurb.textContent).toMatch(/before/i)
    expect(blurb.textContent).toContain('400')
    expect(blurb.textContent).toMatch(/never a 402/i)
  })

  // ── Result fields ──────────────────────────────────────────────────────────

  it('lists the ImageResult fields returned by /images', () => {
    const fields = within(endpointCard('/images')).getByText(/imageUrl/)
    for (const field of ['id', 'title', 'imageUrl', 'thumbnailUrl', 'sourceUrl', 'source', 'width', 'height']) {
      expect(fields.textContent).toContain(field)
    }
  })

  it('lists the NewsResult fields returned by /news', () => {
    const fields = within(endpointCard('/news')).getByText(/snippet/)
    for (const field of ['id', 'title', 'url', 'snippet', 'source', 'publishedAt', 'imageUrl']) {
      expect(fields.textContent).toContain(field)
    }
  })

  // ── curl examples ──────────────────────────────────────────────────────────

  it('gives a curl example per endpoint that URL-encodes the query safely', () => {
    for (const path of ['/search', '/images', '/news']) {
      const example = within(endpointCard(path)).getByText(/^curl/, { selector: 'code' })
      // `--data-urlencode` with `--get` is what keeps a spaced query correct.
      expect(example.textContent).toContain('--get')
      expect(example.textContent).toContain("--data-urlencode 'q=stellar lumens'")
      expect(example.textContent).toContain(`http://localhost:3001${path}`)
    }
  })

  it('uses the current x402 v2 payment header in every curl example', () => {
    for (const path of ['/search', '/images', '/news']) {
      const example = within(endpointCard(path)).getByText(/^curl/, { selector: 'code' })
      expect(example.textContent).toContain('PAYMENT-SIGNATURE:')
      // The retired v1-only spelling must not reappear in the examples.
      expect(example.textContent).not.toContain('X-Payment:')
    }
  })

  it('passes freshness only on the endpoint that supports it', () => {
    const news = within(endpointCard('/news')).getByText(/^curl/, { selector: 'code' })
    expect(news.textContent).toContain("--data-urlencode 'freshness=pw'")

    const images = within(endpointCard('/images')).getByText(/^curl/, { selector: 'code' })
    expect(images.textContent).not.toContain('freshness')
  })

  // ── Runtime boundaries ─────────────────────────────────────────────────────

  it('records which runtimes serve each endpoint, including the Vercel gap', () => {
    expect(within(endpointCard('/search')).getByText(/Express · Vercel · MCP web_search/)).toBeInTheDocument()
    expect(within(endpointCard('/images')).getByText(/no Vercel route/)).toBeInTheDocument()
    expect(within(endpointCard('/news')).getByText(/no Vercel route/)).toBeInTheDocument()
  })

  // ── 402 challenge ──────────────────────────────────────────────────────────

  it('documents the 402 challenge and the headers that carry it', () => {
    const heading = screen.getByRole('heading', { name: /the 402 challenge/i })
    const block = heading.parentElement as HTMLElement

    expect(block.textContent).toMatch(/402/)
    expect(block.textContent).toMatch(/empty JSON body/i)
    expect(block.textContent).toContain('PAYMENT-REQUIRED')
    expect(block.textContent).toContain('Access-Control-Expose-Headers')
    expect(block.textContent).toContain('PAYMENT-SIGNATURE')
    expect(block.textContent).toContain('X-PAYMENT-RESPONSE')
    expect(block.textContent).toContain('txHash')
  })

  it('shows a challenge payload matching the configured settlement constants', () => {
    const heading = screen.getByRole('heading', { name: /the 402 challenge/i })
    const payload = within(heading.parentElement as HTMLElement).getByText(/x402Version/)

    expect(payload.textContent).toContain('"x402Version": 2')
    expect(payload.textContent).toContain('"scheme": "exact"')
    expect(payload.textContent).toContain(`"network": "${STELLAR_NETWORK}"`)
    expect(payload.textContent).toContain(`"amount": "${AMOUNT_STROOPS}"`)
    // Soroban contract address, never the "USDC:ISSUER" form.
    expect(payload.textContent).toContain(`"asset": "${USDC_CONTRACT}"`)
    expect(payload.textContent).not.toContain('USDC:')
  })

  it('warns that payment payloads are single-use', () => {
    expect(screen.getByText(/Payment payload already consumed/)).toBeInTheDocument()
  })
})

describe('DocsPage — x402 payment flow steps', () => {
  beforeEach(() => {
    render(<DocsPage />)
  })

  it('names the header the 402 challenge actually travels on', () => {
    const step = screen.getByRole('heading', { name: /server returns http 402/i }).closest('[data-motion="div"]')
    expect(step?.textContent).toContain('PAYMENT-REQUIRED')
    // The middleware emits PAYMENT-REQUIRED, not the X-Payment-Required spelling.
    expect(step?.textContent).not.toContain('X-Payment-Required')
  })

  it('names PAYMENT-SIGNATURE as the v2 retry header and keeps X-PAYMENT as v1 compat', () => {
    const step = screen.getByRole('heading', { name: /sign soroban auth entry/i }).closest('[data-motion="div"]')
    expect(step?.textContent).toContain('PAYMENT-SIGNATURE')
    expect(step?.textContent).toMatch(/X-PAYMENT is accepted for v1/i)
  })
})
