import { describe, it, expect, vi } from 'vitest'
import { StellarSearchClient } from '../src/client'
import {
  ValidationError,
  PaymentRequiredError,
  PaymentApprovalRejectedError,
  PaymentFailedError,
} from '../src/errors'
import type { ClientSigner, PaymentChallenge } from '../src/types'

describe('@stellar-search/client — StellarSearchClient', () => {
  const MOCK_CHALLENGE: PaymentChallenge = {
    x402Version: 2,
    accepts: [
      {
        scheme: 'exact',
        network: 'stellar:testnet',
        amount: '10000',
        asset: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
        payTo: 'GBBD47IF6LWK7P7MDEVOSCWR7DPWUV3NY3DTQEVFL4NAT4AQHAZLLFLA',
      },
    ],
  }

  const SAMPLE_SEARCH_RESPONSE = {
    query: 'stellar blockchain',
    results: [
      {
        id: '1',
        title: 'Stellar Docs',
        url: 'https://developers.stellar.org',
        description: 'Developer resources for Stellar',
        source: 'developers.stellar.org',
        relevanceScore: 0.98,
      },
    ],
    count: 1,
    network: 'stellar:testnet',
    paidAmount: '0.001',
    currency: 'USDC',
    txHash: 'sampleTxHash123',
    latencyMs: 85,
  }

  describe('parameter validation', () => {
    const client = new StellarSearchClient()

    it('throws ValidationError if query is empty or whitespace', async () => {
      await expect(client.search('')).rejects.toThrow(ValidationError)
      await expect(client.search('   ')).rejects.toThrow(/Search query cannot be empty/)
      await expect(client.searchImages('')).rejects.toThrow(ValidationError)
      await expect(client.searchNews('')).rejects.toThrow(ValidationError)
    })

    it('throws ValidationError if query exceeds 256 characters', async () => {
      const longQuery = 'a'.repeat(257)
      await expect(client.search(longQuery)).rejects.toThrow(/exceeds maximum length of 256/)
    })
  })

  describe('search — web search', () => {
    it('returns search results immediately when server returns 200 OK (unpaid/direct)', async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: new Headers(),
        json: async () => SAMPLE_SEARCH_RESPONSE,
      })

      const client = new StellarSearchClient({ fetchFn })
      const res = await client.search('stellar blockchain')

      expect(fetchFn).toHaveBeenCalledWith(
        expect.stringContaining('/search?q=stellar+blockchain&count=5'),
        expect.any(Object)
      )
      expect(res.results).toHaveLength(1)
      expect(res.query).toBe('stellar blockchain')
    })

    it('forwards optional parameters: freshness, includeDomains, excludeDomains, suggestions', async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: new Headers(),
        json: async () => SAMPLE_SEARCH_RESPONSE,
      })

      const client = new StellarSearchClient({ fetchFn })
      await client.search('stellar', {
        count: 10,
        freshness: 'pw',
        includeDomains: ['stellar.org', 'github.com'],
        excludeDomains: ['spam.com'],
        suggestions: true,
      })

      const calledUrl = fetchFn.mock.calls[0][0]
      expect(calledUrl).toContain('count=10')
      expect(calledUrl).toContain('freshness=pw')
      expect(calledUrl).toContain('includeDomains=stellar.org%2Cgithub.com')
      expect(calledUrl).toContain('excludeDomains=spam.com')
      expect(calledUrl).toContain('suggestions=1')
    })

    it('throws PaymentRequiredError when 402 is returned and no signer is configured', async () => {
      const b64Challenge = Buffer.from(JSON.stringify(MOCK_CHALLENGE)).toString('base64')
      const fetchFn = vi.fn().mockResolvedValue({
        status: 402,
        ok: false,
        headers: new Headers({ 'PAYMENT-REQUIRED': b64Challenge }),
        json: async () => ({ error: 'Payment required' }),
      })

      const client = new StellarSearchClient({ fetchFn })
      const promise = client.search('stellar')

      await expect(promise).rejects.toThrow(PaymentRequiredError)
      await expect(promise).rejects.toThrow(/Payment required/)
    })

    it('throws PaymentApprovalRejectedError when onPaymentRequired rejects', async () => {
      const b64Challenge = Buffer.from(JSON.stringify(MOCK_CHALLENGE)).toString('base64')
      const fetchFn = vi.fn().mockResolvedValue({
        status: 402,
        ok: false,
        headers: new Headers({ 'PAYMENT-REQUIRED': b64Challenge }),
        json: async () => ({ error: 'Payment required' }),
      })

      const onPaymentRequired = vi.fn().mockResolvedValue(false)
      const mockSigner: ClientSigner = {
        sign: vi.fn(),
      }

      const client = new StellarSearchClient({
        fetchFn,
        signer: mockSigner,
        onPaymentRequired,
      })

      await expect(client.search('stellar')).rejects.toThrow(PaymentApprovalRejectedError)
      expect(onPaymentRequired).toHaveBeenCalled()
      expect(mockSigner.sign).not.toHaveBeenCalled()
    })

    it('handles 402 challenge, signs with signer, retries request, and returns settled response', async () => {
      const b64Challenge = Buffer.from(JSON.stringify(MOCK_CHALLENGE)).toString('base64')
      const mockSettlementTx = 'tx_settled_1234567890abcdef'

      const fetchFn = vi.fn()
        // First call: 402 challenge
        .mockResolvedValueOnce({
          status: 402,
          ok: false,
          headers: new Headers({ 'payment-required': b64Challenge }),
          json: async () => ({ error: 'Payment required' }),
        })
        // Second call: 200 OK retry with settlement header
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          headers: new Headers({ 'x-payment-response': mockSettlementTx }),
          json: async () => ({ ...SAMPLE_SEARCH_RESPONSE, txHash: mockSettlementTx }),
        })

      const mockSigner: ClientSigner = {
        sign: vi.fn().mockResolvedValue({
          headerName: 'PAYMENT-SIGNATURE',
          headerValue: 'mockSignedPaymentHeader==',
          secondaryHeaders: { 'x-payment': 'mockSignedPaymentHeader==' },
        }),
      }

      const onPaymentRequired = vi.fn().mockResolvedValue(true)
      const client = new StellarSearchClient({
        fetchFn,
        signer: mockSigner,
        onPaymentRequired,
      })

      const res = await client.search('stellar blockchain')
      expect(fetchFn).toHaveBeenCalledTimes(2)
      expect(mockSigner.sign).toHaveBeenCalled()
      expect(onPaymentRequired).toHaveBeenCalled()

      // Verify retry had payment headers
      const retryOptions = fetchFn.mock.calls[1][1]
      expect(retryOptions.headers['PAYMENT-SIGNATURE']).toBe('mockSignedPaymentHeader==')
      expect(retryOptions.headers['x-payment']).toBe('mockSignedPaymentHeader==')

      expect(res.txHash).toBe(mockSettlementTx)
      expect(res.results).toHaveLength(1)
    })

    it('throws PaymentFailedError if retry request returns non-200', async () => {
      const b64Challenge = Buffer.from(JSON.stringify(MOCK_CHALLENGE)).toString('base64')
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({
          status: 402,
          ok: false,
          headers: new Headers({ 'payment-required': b64Challenge }),
          json: async () => ({ error: 'Payment required' }),
        })
        .mockResolvedValueOnce({
          status: 402,
          ok: false,
          headers: new Headers(),
          json: async () => ({ error: 'Insufficient balance on ledger' }),
        })

      const mockSigner: ClientSigner = {
        sign: vi.fn().mockResolvedValue({
          headerName: 'PAYMENT-SIGNATURE',
          headerValue: 'badSig',
        }),
      }

      const client = new StellarSearchClient({ fetchFn, signer: mockSigner })
      await expect(client.search('stellar')).rejects.toThrow(PaymentFailedError)
    })
  })

  describe('searchImages', () => {
    it('calls /images and clamps count to max 10', async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: new Headers(),
        json: async () => ({
          query: 'stellar logo',
          results: [{ id: '1', title: 'Logo', imageUrl: 'https://example.com/logo.png', thumbnailUrl: 'thumb.png', sourceUrl: 'stellar.org', source: 'stellar' }],
          count: 1,
          network: 'stellar:testnet',
          paidAmount: '0.001',
          currency: 'USDC',
          latencyMs: 50,
        }),
      })

      const client = new StellarSearchClient({ fetchFn })
      const res = await client.searchImages('stellar logo', { count: 50 }) // requested 50, must clamp to 10

      expect(fetchFn.mock.calls[0][0]).toContain('/images?q=stellar+logo&count=10')
      expect(res.results[0].imageUrl).toBe('https://example.com/logo.png')
    })
  })

  describe('searchNews', () => {
    it('calls /news with query and freshness', async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: new Headers(),
        json: async () => ({
          query: 'stellar',
          results: [{ id: '1', title: 'News', url: 'https://example.com/news', snippet: 'Announcement', source: 'news' }],
          count: 1,
          network: 'stellar:testnet',
          paidAmount: '0.001',
          currency: 'USDC',
          latencyMs: 60,
        }),
      })

      const client = new StellarSearchClient({ fetchFn })
      const res = await client.searchNews('stellar', { count: 8, freshness: 'pm' })

      expect(fetchFn.mock.calls[0][0]).toContain('/news?q=stellar&count=8&freshness=pm')
      expect(res.results).toHaveLength(1)
    })
  })

  describe('health check', () => {
    it('queries /health and returns structured server health response', async () => {
      const mockHealth = {
        status: 'ok',
        network: 'stellar:testnet',
        pricePerQuery: '0.001 USDC',
        protocol: 'x402',
        totalQueries: 142,
        totalUsdcSettled: '0.1420',
      }
      const fetchFn = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => mockHealth,
      })

      const client = new StellarSearchClient({ fetchFn })
      const res = await client.health()
      expect(res.status).toBe('ok')
      expect(res.pricePerQuery).toBe('0.001 USDC')
      expect(fetchFn.mock.calls[0][0]).toContain('/health')
    })
  })

  describe('discovery', () => {
    it('queries /.well-known/x402 and returns discovery metadata', async () => {
      const mockDiscovery = {
        version: 1,
        protocol: 'x402',
        resourceTemplates: [{ id: 'search', resource: '/search?q={q}', method: 'GET', description: 'Search', accepts: [] }],
        networks: ['stellar:testnet'],
        assets: ['CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA'],
        schemes: ['exact'],
        priceDiscoveryUrl: 'http://localhost:3001/.well-known/x402',
      }
      const fetchFn = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => mockDiscovery,
      })

      const client = new StellarSearchClient({ fetchFn })
      const res = await client.discovery()
      expect(res.protocol).toBe('x402')
      expect(res.resourceTemplates).toHaveLength(1)
      expect(fetchFn.mock.calls[0][0]).toContain('/.well-known/x402')
    })
  })

  describe('quote', () => {
    it('requests challenge for search endpoint without initiating payment', async () => {
      const b64Challenge = Buffer.from(JSON.stringify(MOCK_CHALLENGE)).toString('base64')
      const fetchFn = vi.fn().mockResolvedValue({
        status: 402,
        ok: false,
        headers: new Headers({ 'PAYMENT-REQUIRED': b64Challenge }),
        json: async () => ({ error: 'Payment required' }),
      })

      const client = new StellarSearchClient({ fetchFn })
      const quote = await client.quote('search', 'stellar smart contracts', { count: 3 })

      expect(fetchFn).toHaveBeenCalledTimes(1)
      expect(quote.accepts).toHaveLength(1)
      expect(quote.accepts[0].amount).toBe('10000')
    })
  })

  describe('URL normalization and path resolution', () => {
    it('handles baseUrl ending with /api properly without double prefixing', async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: new Headers(),
        json: async () => SAMPLE_SEARCH_RESPONSE,
      })

      const client = new StellarSearchClient({ baseUrl: 'https://search.vercel.app/api/', fetchFn })
      await client.search('test')

      expect(fetchFn.mock.calls[0][0]).toBe('https://search.vercel.app/api/search?q=test&count=5')
    })
  })
})
