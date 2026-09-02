/**
 * server/parameterMatrix.test.ts
 *
 * Shared parameter validation matrix (#188) across every paid Express
 * route (`/search`, `/images`, `/news`, `/search/batch`, `/jobs`).
 *
 * Proves the uniform contract:
 *   - `count` omitted → route default; single integer within `[min, max]`.
 *   - `count` out-of-bounds, non-integer, or repeated → rejected early (400).
 *   - `freshness` ∈ {pd, pw, pm}; anything else or repeated → rejected (400).
 *   - Invalid input NEVER invokes the downstream payment adapter
 *     (`consumePaymentPayload`) or the Serper adapter (`fetch`).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'

vi.mock('@x402/express', () => ({
  paymentMiddlewareFromConfig: () => (_req: any, _res: any, next: any) => next(),
}))
vi.mock('@x402/core/server', () => ({
  HTTPFacilitatorClient: class { constructor(_opts: any) {} },
}))
vi.mock('@x402/stellar/exact/server', () => ({
  ExactStellarScheme: class { constructor() {} },
}))
vi.mock('groq-sdk', () => ({
  default: class { chat = { completions: { create: vi.fn() } } },
}))
vi.mock('./logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
// Spy on the payment adapter so tests can prove it is never invoked for
// invalid input, while keeping real replay-protection behavior for valid ones.
vi.mock('../src/lib/paymentIntegrity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/paymentIntegrity')>()
  return { ...actual, consumePaymentPayload: vi.fn(actual.consumePaymentPayload) }
})

process.env.STELLAR_RECEIVING_ADDRESS = 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3'
process.env.SERPER_API_KEY = 'test-serper-key'
process.env.GROQ_API_KEY = 'gsk_test'

import { consumePaymentPayload } from '../src/lib/paymentIntegrity'
import { FRESHNESS_TBS } from '../src/lib/paramValidation'

let app: any
let txCounter = 0

function nextReceipt(): string {
  txCounter += 1
  return Buffer.from(JSON.stringify({ transactionHash: `tx_matrix_${txCounter}` })).toString('base64')
}

beforeEach(async () => {
  vi.resetModules()
  const { resetConsumedPayments } = await import('../src/lib/paymentIntegrity')
  resetConsumedPayments()
  ;(consumePaymentPayload as any).mockClear()
  const mod = await import('./index.js')
  app = mod.default
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ organic: [] }) } as any)
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── Shared matrix ───────────────────────────────────────────────────────────

interface MatrixCase {
  name: string
  method: 'GET' | 'POST'
  path: string
  /** GET query params, appended in order (supports repeated values). */
  params?: [string, string][]
  /** POST JSON body. */
  body?: Record<string, unknown>
  expect: 'ok' | 'reject'
  /** For `ok` cases: the `num` value Serper must receive. */
  expectedNum?: number
  /** For `ok` cases: the `tbs` date filter Serper must receive. */
  expectedTbs?: string
  /** For `reject` cases: error body must match. */
  expectedError?: RegExp
}

const GET_ROUTES: { path: string; defaultNum: number; maxNum: number }[] = [
  { path: '/search', defaultNum: 5, maxNum: 20 },
  { path: '/images', defaultNum: 10, maxNum: 10 },
  { path: '/news', defaultNum: 10, maxNum: 20 },
]

function getCases(): MatrixCase[] {
  const cases: MatrixCase[] = []
  for (const route of GET_ROUTES) {
    cases.push(
      // ── Defaults ──
      {
        name: `${route.path}: count omitted → default ${route.defaultNum}`,
        method: 'GET', path: route.path, expect: 'ok', expectedNum: route.defaultNum,
      },
      // ── Min / max bounds ──
      {
        name: `${route.path}: count=1 (min) accepted`,
        method: 'GET', path: route.path, params: [['count', '1']], expect: 'ok', expectedNum: 1,
      },
      {
        name: `${route.path}: count=${route.maxNum} (max) accepted`,
        method: 'GET', path: route.path, params: [['count', String(route.maxNum)]], expect: 'ok', expectedNum: route.maxNum,
      },
      {
        name: `${route.path}: count=0 rejected early`,
        method: 'GET', path: route.path, params: [['count', '0']], expect: 'reject', expectedError: /count/,
      },
      {
        name: `${route.path}: count=-1 rejected early`,
        method: 'GET', path: route.path, params: [['count', '-1']], expect: 'reject', expectedError: /count/,
      },
      {
        name: `${route.path}: count=${route.maxNum + 1} rejected early`,
        method: 'GET', path: route.path, params: [['count', String(route.maxNum + 1)]], expect: 'reject', expectedError: /count/,
      },
      {
        name: `${route.path}: count=999 rejected early`,
        method: 'GET', path: route.path, params: [['count', '999']], expect: 'reject', expectedError: /count/,
      },
      // ── Invalid integers ──
      {
        name: `${route.path}: count=abc rejected early`,
        method: 'GET', path: route.path, params: [['count', 'abc']], expect: 'reject', expectedError: /integer/,
      },
      {
        name: `${route.path}: count=1.5 rejected early`,
        method: 'GET', path: route.path, params: [['count', '1.5']], expect: 'reject', expectedError: /integer/,
      },
      {
        name: `${route.path}: count=1e3 rejected early`,
        method: 'GET', path: route.path, params: [['count', '1e3']], expect: 'reject', expectedError: /integer/,
      },
      {
        name: `${route.path}: count=--5 rejected early`,
        method: 'GET', path: route.path, params: [['count', '--5']], expect: 'reject', expectedError: /integer/,
      },
      // ── Repeated values ──
      {
        name: `${route.path}: count=1&count=2 (repeated) rejected early`,
        method: 'GET', path: route.path, params: [['count', '1'], ['count', '2']], expect: 'reject', expectedError: /single value/,
      },
    )
  }
  return cases
}

function freshnessCases(): MatrixCase[] {
  const cases: MatrixCase[] = []
  for (const route of GET_ROUTES.filter((r) => r.path !== '/images')) {
    for (const [value, tbs] of Object.entries(FRESHNESS_TBS)) {
      cases.push({
        name: `${route.path}: freshness=${value} → tbs=${tbs}`,
        method: 'GET', path: route.path, params: [['freshness', value]], expect: 'ok', expectedTbs: tbs,
      })
    }
    cases.push(
      {
        name: `${route.path}: freshness=day rejected early`,
        method: 'GET', path: route.path, params: [['freshness', 'day']], expect: 'reject', expectedError: /freshness/,
      },
      {
        name: `${route.path}: freshness=P (case-sensitive) rejected early`,
        method: 'GET', path: route.path, params: [['freshness', 'P']], expect: 'reject', expectedError: /freshness/,
      },
      {
        name: `${route.path}: freshness=1 rejected early`,
        method: 'GET', path: route.path, params: [['freshness', '1']], expect: 'reject', expectedError: /freshness/,
      },
      {
        name: `${route.path}: freshness=pd&freshness=pw (repeated) rejected early`,
        method: 'GET', path: route.path, params: [['freshness', 'pd'], ['freshness', 'pw']], expect: 'reject', expectedError: /single value/,
      },
    )
  }
  return cases
}

const POST_CASES: MatrixCase[] = [
  // ── /search/batch ──
  {
    name: '/search/batch: count omitted → default 5',
    method: 'POST', path: '/search/batch', body: { queries: ['stellar'] }, expect: 'ok', expectedNum: 5,
  },
  {
    name: '/search/batch: count=3 accepted',
    method: 'POST', path: '/search/batch', body: { queries: ['stellar'], count: 3 }, expect: 'ok', expectedNum: 3,
  },
  {
    name: '/search/batch: count=0 rejected early',
    method: 'POST', path: '/search/batch', body: { queries: ['stellar'], count: 0 }, expect: 'reject', expectedError: /count/,
  },
  {
    name: '/search/batch: count=-5 rejected early',
    method: 'POST', path: '/search/batch', body: { queries: ['stellar'], count: -5 }, expect: 'reject', expectedError: /count/,
  },
  {
    name: '/search/batch: count=21 rejected early',
    method: 'POST', path: '/search/batch', body: { queries: ['stellar'], count: 21 }, expect: 'reject', expectedError: /count/,
  },
  {
    name: '/search/batch: count=abc rejected early',
    method: 'POST', path: '/search/batch', body: { queries: ['stellar'], count: 'abc' }, expect: 'reject', expectedError: /integer/,
  },
  {
    name: '/search/batch: count array (repeated) rejected early',
    method: 'POST', path: '/search/batch', body: { queries: ['stellar'], count: [1, 2] }, expect: 'reject', expectedError: /single value/,
  },
  {
    name: '/search/batch: freshness=pw accepted',
    method: 'POST', path: '/search/batch', body: { queries: ['stellar'], freshness: 'pw' }, expect: 'ok', expectedTbs: 'qdr:w',
  },
  {
    name: '/search/batch: freshness=week rejected early',
    method: 'POST', path: '/search/batch', body: { queries: ['stellar'], freshness: 'week' }, expect: 'reject', expectedError: /freshness/,
  },
  // ── /jobs ──
  {
    name: '/jobs: count omitted → default 5',
    method: 'POST', path: '/jobs', body: { query: 'stellar' }, expect: 'ok', expectedNum: 5,
  },
  {
    name: '/jobs: count=3 accepted',
    method: 'POST', path: '/jobs', body: { query: 'stellar', count: 3 }, expect: 'ok', expectedNum: 3,
  },
  {
    name: '/jobs: count=0 rejected early',
    method: 'POST', path: '/jobs', body: { query: 'stellar', count: 0 }, expect: 'reject', expectedError: /count/,
  },
  {
    name: '/jobs: count=100 rejected early',
    method: 'POST', path: '/jobs', body: { query: 'stellar', count: 100 }, expect: 'reject', expectedError: /count/,
  },
  {
    name: '/jobs: count=1.5 rejected early',
    method: 'POST', path: '/jobs', body: { query: 'stellar', count: 1.5 }, expect: 'reject', expectedError: /integer/,
  },
  {
    name: '/jobs: freshness=pm accepted',
    method: 'POST', path: '/jobs', body: { query: 'stellar', freshness: 'pm' }, expect: 'ok', expectedTbs: 'qdr:m',
  },
  {
    name: '/jobs: freshness=month rejected early',
    method: 'POST', path: '/jobs', body: { query: 'stellar', freshness: 'month' }, expect: 'reject', expectedError: /freshness/,
  },
]

// ─── Matrix execution ────────────────────────────────────────────────────────

describe('parameter validation matrix — paid endpoints (#188)', () => {
  const ALL_CASES: MatrixCase[] = [...getCases(), ...freshnessCases(), ...POST_CASES]

  for (const c of ALL_CASES) {
    it(c.name, async () => {
      let capturedBody: any = null
      global.fetch = vi.fn().mockImplementation(async (_url: string, opts: any) => {
        capturedBody = JSON.parse(opts.body)
        return { ok: true, json: async () => ({ organic: [] }) } as any
      })

      let http = request(app)
      let res: any

      if (c.method === 'GET') {
        const url = new URL(`http://localhost${c.path}`)
        url.searchParams.set('q', 'stellar')
        for (const [k, v] of c.params ?? []) url.searchParams.append(k, v)
        const req = http.get(url.pathname + url.search)
        // Valid GET requests carry a payment header (paid flow); reject cases
        // intentionally do NOT, so a 400 proves payment was never consulted.
        if (c.expect === 'ok') req.set('x-payment', nextReceipt())
        res = await req
      } else {
        const req = http.post(c.path).send(c.body)
        if (c.expect === 'ok') req.set('x-payment', nextReceipt())
        res = await req
      }

      if (c.expect === 'reject') {
        // Early rejection: 400 (not 402 — payment adapter never ran)
        expect(res.status).toBe(400)
        expect(res.body.error).toBeDefined()
        if (c.expectedError) expect(res.body.error).toMatch(c.expectedError)
        // Downstream adapters must NOT be invoked
        expect(consumePaymentPayload).not.toHaveBeenCalled()
        expect(global.fetch).not.toHaveBeenCalled()
        return
      }

      // Valid input proceeds past validation. If a payment header was sent,
      // the request must reach the handler (200 for GET/batch, 202 for jobs).
      expect([200, 202]).toContain(res.status)

      if (c.expectedNum !== undefined || c.expectedTbs !== undefined) {
        await vi.waitFor(() => expect(global.fetch).toHaveBeenCalled(), { timeout: 2000 })
        if (c.expectedNum !== undefined) expect(capturedBody.num).toBe(c.expectedNum)
        if (c.expectedTbs !== undefined) {
          expect(capturedBody.tbs).toBe(c.expectedTbs)
        } else {
          expect(capturedBody.tbs).toBeUndefined()
        }
      }
    })
  }
})

// ─── Explicit proofs beyond the matrix ───────────────────────────────────────

describe('parameter validation — early rejection proofs', () => {
  it('rejects invalid count even when a payment header IS present (validation precedes payment)', async () => {
    global.fetch = vi.fn()
    const res = await request(app)
      .get('/search?q=stellar&count=abc')
      .set('x-payment', nextReceipt())
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/integer/)
    expect(consumePaymentPayload).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rejects invalid freshness even when a payment header IS present', async () => {
    global.fetch = vi.fn()
    const res = await request(app)
      .get('/news?q=stellar&freshness=yesterday')
      .set('x-payment', nextReceipt())
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/freshness/)
    expect(consumePaymentPayload).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('POST /jobs rejects invalid count before creating any job', async () => {
    global.fetch = vi.fn()
    const { jobStore } = await import('./index.js')
    const before = jobStore.size
    const res = await request(app)
      .post('/jobs')
      .send({ query: 'stellar', count: 'nope' })
      .set('x-payment', nextReceipt())
    expect(res.status).toBe(400)
    expect(jobStore.size).toBe(before)
    expect(consumePaymentPayload).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('POST /search/batch rejects invalid freshness before any settlement event', async () => {
    global.fetch = vi.fn()
    const res = await request(app)
      .post('/search/batch')
      .send({ queries: ['stellar'], freshness: 'soon' })
      .set('x-payment', nextReceipt())
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/freshness/)
    expect(consumePaymentPayload).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('GET /images ignores freshness (route does not support it) but still validates count', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ images: [] }) } as any)
    const res = await request(app)
      .get('/images?q=stellar&freshness=pd&count=5')
      .set('x-payment', nextReceipt())
    expect(res.status).toBe(200)
    expect(global.fetch).toHaveBeenCalled()
  })
})
