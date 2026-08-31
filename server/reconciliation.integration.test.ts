/**
 * server/reconciliation.integration.test.ts
 *
 * Verifies /search, /images, /news actually persist ReconciliationRecord
 * entries to the JSONL log as requests flow through the Express app —
 * settled+delivered, settled+failed-upstream, and unpaid-and-rejected.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import fs from 'fs'
import os from 'os'
import path from 'path'

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
  default: class {
    chat = { completions: { create: vi.fn() } }
  },
}))
vi.mock('./logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

process.env.STELLAR_RECEIVING_ADDRESS = 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3'
process.env.SERPER_API_KEY = 'test-serper-key'
process.env.GROQ_API_KEY = 'gsk_test'

function makeReceipt(txHash: string): string {
  return Buffer.from(JSON.stringify({ transactionHash: txHash })).toString('base64')
}

let app: any
let tmpDir: string
let logPath: string

beforeEach(async () => {
  vi.resetModules()

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconciliation-integration-'))
  logPath = path.join(tmpDir, 'reconciliation.jsonl')
  process.env.RECONCILIATION_LOG_PATH = logPath

  const { resetConsumedPayments } = await import('../src/lib/paymentIntegrity')
  resetConsumedPayments()

  const mod = await import('./index.js')
  app = mod.default

  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ organic: [{ title: 'Stellar', link: 'https://stellar.org', snippet: 'desc' }] }),
  } as any)
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.RECONCILIATION_LOG_PATH
  if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true })
})

function readLog(): any[] {
  if (!fs.existsSync(logPath)) return []
  return fs
    .readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l))
}

describe('reconciliation wiring — /search, /images, /news', () => {
  it('records a reconciled entry for a settled, delivered /search request', async () => {
    const res = await request(app).get('/search?q=stellar').set('x-payment', makeReceipt('tx_recon_ok'))
    expect(res.status).toBe(200)

    const records = readLog()
    expect(records).toHaveLength(1)
    expect(records[0].outcome).toBe('reconciled')
    expect(records[0].route).toBe('/search')
    expect(records[0].paymentSettled).toBe(true)
    expect(records[0].providerDelivered).toBe(true)
    expect(records[0].resultCount).toBe(1)
    expect(records[0].idempotencyKey).toMatch(/^tx:tx_recon_ok$/)
  })

  it('records settled_no_delivery when payment succeeds but Serper errors', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' } as any)
    const res = await request(app).get('/search?q=stellar').set('x-payment', makeReceipt('tx_recon_fail'))
    expect(res.status).toBe(502)

    const records = readLog()
    expect(records).toHaveLength(1)
    expect(records[0].outcome).toBe('settled_no_delivery')
    expect(records[0].providerDelivered).toBe(false)
  })

  it('does not record anything for an unpaid, rejected request (nothing to reconcile)', async () => {
    const res = await request(app).get('/search')
    expect(res.status).toBe(400)
    expect(readLog()).toHaveLength(0)
  })

  it('records reconciled entries for /images and /news too', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ images: [{ title: 'Img', imageUrl: 'https://i.example.com/1.jpg', link: 'https://example.com' }] }),
    } as any)
    await request(app).get('/images?q=stellar').set('x-payment', makeReceipt('tx_recon_img'))

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ news: [{ title: 'News', link: 'https://news.example.com', snippet: 'x' }] }),
    } as any)
    await request(app).get('/news?q=stellar').set('x-payment', makeReceipt('tx_recon_news'))

    const records = readLog()
    expect(records.map(r => r.route).sort()).toEqual(['/images', '/news'])
    expect(records.every(r => r.outcome === 'reconciled')).toBe(true)
  })

  it('never writes query content into the reconciliation log', async () => {
    await request(app).get('/search?q=super-secret-research-topic').set('x-payment', makeReceipt('tx_recon_privacy'))
    const raw = fs.readFileSync(logPath, 'utf8')
    expect(raw).not.toContain('super-secret-research-topic')
  })
})
