/**
 * server/x402PaymentFlow.integration.test.ts
 *
 * Integration tests for the full server x402 payment flow (#26).
 *
 * Uses supertest against the Express app with real @x402/express middleware.
 * Stubs Serper.dev and the x402 facilitator.
 *
 * Scenarios:
 *   1. no header     → 402 Payment Required with x402 PAYMENT-REQUIRED requirements
 *   2. valid header   → 200 OK with search results from Serper
 *   3. invalid header → 402/403 rejected before search execution
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'

// Mock groq-sdk to prevent browser-environment checks in jsdom
vi.mock('groq-sdk', () => ({
  default: class {
    chat = { completions: { create: vi.fn() } }
  },
}))

process.env.STELLAR_RECEIVING_ADDRESS = 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3'
process.env.SERPER_API_KEY = 'test-serper-key'
process.env.GROQ_API_KEY = 'gsk_test'
process.env.FACILITATOR_URL = 'https://www.x402.org/facilitator'

const SERPER_RESULTS = {
  organic: [
    {
      title: 'Stellar — Open Network for Money',
      link: 'https://stellar.org',
      snippet: 'Stellar is an open network that allows money to be moved and stored.',
    },
  ],
}

describe('full server x402 payment flow integration (#26)', () => {
  let app: any

  beforeEach(async () => {
    vi.resetModules()

    const { resetConsumedPayments } = await import('../src/lib/paymentIntegrity')
    resetConsumedPayments()

    global.fetch = vi.fn().mockImplementation(async (url: string, opts?: any) => {
      // 1. Facilitator discovery: /supported
      if (url.includes('/supported')) {
        return new Response(
          JSON.stringify({
            kinds: [
              {
                x402Version: 2,
                scheme: 'exact',
                network: 'stellar:testnet',
                extra: { areFeesSponsored: true },
              },
            ],
            extensions: [],
            signers: {},
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }

      // 2. Facilitator verification: /verify
      if (url.includes('/verify')) {
        const body = opts?.body ? JSON.parse(opts.body) : {}
        if (body.paymentPayload?.payload?.signedAuthEntry === 'valid_auth_signature') {
          return new Response(
            JSON.stringify({
              isValid: true,
              payer: 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        }
        return new Response(
          JSON.stringify({
            isValid: false,
            invalidReason: 'signature_invalid',
            invalidMessage: 'Invalid payment signature authorization',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }

      // 3. Facilitator settlement: /settle
      if (url.includes('/settle')) {
        return new Response(
          JSON.stringify({
            success: true,
            transaction: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
            network: 'stellar:testnet',
            amount: '10000',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }

      // 4. Upstream Search Engine: Serper.dev
      if (url.includes('serper.dev')) {
        return new Response(JSON.stringify(SERPER_RESULTS), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
    })

    const mod = await import('./index.js')
    app = mod.default
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('no header → 402', async () => {
    const res = await request(app).get('/search?q=stellar')
    expect(res.status).toBe(402)
    const header = res.headers['payment-required'] || res.headers['PAYMENT-REQUIRED']
    expect(header).toBeDefined()

    const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf8'))
    expect(decoded.x402Version).toBe(2)
    expect(decoded.accepts).toBeDefined()
    expect(decoded.accepts[0].scheme).toBe('exact')
    expect(decoded.accepts[0].network).toBe('stellar:testnet')
  })

  it('valid header → 200 with results', async () => {
    // Challenge step: retrieve server payment requirements
    const initialRes = await request(app).get('/search?q=stellar')
    expect(initialRes.status).toBe(402)
    const reqHeader =
      initialRes.headers['payment-required'] || initialRes.headers['PAYMENT-REQUIRED']
    const decodedReq = JSON.parse(Buffer.from(reqHeader, 'base64').toString('utf8'))
    const acceptedRequirement = decodedReq.accepts[0]

    // Construct valid x402 v2 payment payload matching accepted requirement
    const validPayload = {
      x402Version: 2,
      accepted: acceptedRequirement,
      payload: {
        signedAuthEntry: 'valid_auth_signature',
        signerAddress: 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3',
        transactionHash: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
      },
    }
    const paymentHeader = Buffer.from(JSON.stringify(validPayload)).toString('base64')

    const res = await request(app).get('/search?q=stellar').set('PAYMENT-SIGNATURE', paymentHeader)

    expect(res.status).toBe(200)
    expect(res.body.results).toBeDefined()
    expect(res.body.results.length).toBeGreaterThan(0)
    expect(res.body.results[0].title).toBe('Stellar — Open Network for Money')
    expect(res.body.network).toBe('stellar:testnet')
  })

  it('invalid header → 402/403', async () => {
    // Challenge step: retrieve server payment requirements
    const initialRes = await request(app).get('/search?q=stellar')
    expect(initialRes.status).toBe(402)
    const reqHeader =
      initialRes.headers['payment-required'] || initialRes.headers['PAYMENT-REQUIRED']
    const decodedReq = JSON.parse(Buffer.from(reqHeader, 'base64').toString('utf8'))
    const acceptedRequirement = decodedReq.accepts[0]

    // Construct invalid x402 payment payload
    const invalidPayload = {
      x402Version: 2,
      accepted: acceptedRequirement,
      payload: {
        signedAuthEntry: 'invalid_bad_sig',
        signerAddress: 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3',
      },
    }
    const paymentHeader = Buffer.from(JSON.stringify(invalidPayload)).toString('base64')

    const res = await request(app).get('/search?q=stellar').set('PAYMENT-SIGNATURE', paymentHeader)

    expect([402, 403]).toContain(res.status)
  })
})
