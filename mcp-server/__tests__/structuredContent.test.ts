import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

// Mock MCP SDK before importing server
const mockSetRequestHandler = vi.fn()
const mockConnect = vi.fn().mockResolvedValue(undefined)

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: class {
    setRequestHandler = mockSetRequestHandler
    connect = mockConnect
  },
}))

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class {},
}))

const CallToolRequestSchemaMock = { name: 'CallToolRequestSchema' }
const ListToolsRequestSchemaMock = { name: 'ListToolsRequestSchema' }
const ListResourcesRequestSchemaMock = { name: 'ListResourcesRequestSchema' }
const ReadResourceRequestSchemaMock = { name: 'ReadResourceRequestSchema' }
const ListPromptsRequestSchemaMock = { name: 'ListPromptsRequestSchema' }
const GetPromptRequestSchemaMock = { name: 'GetPromptRequestSchema' }
const CancelledNotificationSchemaMock = { name: 'CancelledNotificationSchema' }

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  CallToolRequestSchema: CallToolRequestSchemaMock,
  ListToolsRequestSchema: ListToolsRequestSchemaMock,
  ListResourcesRequestSchema: ListResourcesRequestSchemaMock,
  ReadResourceRequestSchema: ReadResourceRequestSchemaMock,
  ListPromptsRequestSchema: ListPromptsRequestSchemaMock,
  GetPromptRequestSchema: GetPromptRequestSchemaMock,
  CancelledNotificationSchema: CancelledNotificationSchemaMock,
}))

const mockGroqCreate = vi.fn().mockResolvedValue({
  choices: [{ message: { content: 'Summarized text' } }],
})

vi.mock('groq-sdk', () => ({
  default: class {
    chat = { completions: { create: mockGroqCreate } }
  },
}))

process.env.GROQ_API_KEY = 'gsk_test'
process.env.SEARCH_API_URL = 'http://localhost:3001'

import { USDC_ISSUER, STELLAR_NETWORK, AMOUNT_USDC } from '../../src/lib/constants.js'
import {
  webSearchOutputSchema,
  imageSearchOutputSchema,
  newsSearchOutputSchema,
  checkBalanceOutputSchema,
  getSearchStatsOutputSchema,
} from '../schemas.js'

describe('MCP server — structuredContent alongside human-readable text (#171)', () => {
  let listToolsHandler: () => Promise<{ tools: any[] }>
  let callToolHandler: (request: { params: { name: string; arguments?: any } }) => Promise<any>

  beforeAll(async () => {
    // Import mcp-server once to register handlers
    await import('../index.js')

    const calls = mockSetRequestHandler.mock.calls
    listToolsHandler = calls.find((c: any) => c[0] === ListToolsRequestSchemaMock)?.[1]
    callToolHandler = calls.find((c: any) => c[0] === CallToolRequestSchemaMock)?.[1]
  })

  beforeEach(() => {
    mockGroqCreate.mockClear()
  })

  describe('Tool Definitions and Output Schemas', () => {
    it('exposes documented outputSchema for web, image, news, balance, and stats tools', async () => {
      const { tools } = await listToolsHandler()

      const webSearch = tools.find((t) => t.name === 'web_search')
      expect(webSearch).toBeDefined()
      expect(webSearch.outputSchema).toEqual(webSearchOutputSchema)
      expect(webSearch.outputSchema.type).toBe('object')
      expect(webSearch.outputSchema.required).toEqual(
        expect.arrayContaining(['query', 'count', 'results', 'payment', 'latencyMs'])
      )

      const imageSearch = tools.find((t) => t.name === 'image_search')
      expect(imageSearch).toBeDefined()
      expect(imageSearch.outputSchema).toEqual(imageSearchOutputSchema)
      expect(imageSearch.outputSchema.type).toBe('object')
      expect(imageSearch.outputSchema.required).toEqual(
        expect.arrayContaining(['query', 'count', 'results', 'payment', 'latencyMs'])
      )

      const newsSearch = tools.find((t) => t.name === 'news_search')
      expect(newsSearch).toBeDefined()
      expect(newsSearch.outputSchema).toEqual(newsSearchOutputSchema)
      expect(newsSearch.outputSchema.type).toBe('object')
      expect(newsSearch.outputSchema.required).toEqual(
        expect.arrayContaining(['query', 'count', 'results', 'payment', 'latencyMs'])
      )

      const checkBalance = tools.find((t) => t.name === 'check_balance')
      expect(checkBalance).toBeDefined()
      expect(checkBalance.outputSchema).toEqual(checkBalanceOutputSchema)
      expect(checkBalance.outputSchema.type).toBe('object')
      expect(checkBalance.outputSchema.required).toEqual(
        expect.arrayContaining(['address', 'usdcBalance', 'xlmBalance', 'searchesRemaining', 'network', 'issuer', 'explorerUrl', 'timestamp'])
      )

      const getSearchStats = tools.find((t) => t.name === 'get_search_stats')
      expect(getSearchStats).toBeDefined()
      expect(getSearchStats.outputSchema).toEqual(getSearchStatsOutputSchema)
      expect(getSearchStats.outputSchema.type).toBe('object')
      expect(getSearchStats.outputSchema.required).toEqual(
        expect.arrayContaining(['status', 'network', 'pricePerQuery', 'protocol', 'facilitator', 'totalQueries', 'totalUsdcSettled', 'avgLatencyMs', 'uptime'])
      )
    })
  })

  describe('web_search tool execution', () => {
    it('returns both human-readable Markdown text and typed structuredContent', async () => {
      const mockWebResponse = {
        query: 'stellar x402 payment',
        count: 2,
        network: 'stellar:testnet',
        paidAmount: '0.001',
        currency: 'USDC',
        txHash: '0xabc123settlement',
        latencyMs: 142,
        suggestions: ['stellar soroban', 'stellar micropayments'],
        results: [
          {
            id: 'res-1',
            title: 'Stellar x402 Specification',
            url: 'https://stellar.org/x402',
            description: 'Official documentation for HTTP 402 payments on Stellar.',
            source: 'stellar.org',
            relevanceScore: 0.98,
          },
          {
            id: 'res-2',
            title: 'StellarSearch Demo',
            url: 'https://stellarsearch.org',
            description: 'Pay-per-query search engine built on Stellar and x402.',
            source: 'stellarsearch.org',
            relevanceScore: 0.91,
          },
        ],
      }

      const originalFetch = global.fetch
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockWebResponse,
      }) as any

      const result = await callToolHandler({
        params: {
          name: 'web_search',
          arguments: { query: 'stellar x402 payment', count: 2, freshness: 'pw' },
        },
      })

      global.fetch = originalFetch

      // Verify text content
      expect(result.content).toBeDefined()
      expect(result.content[0].type).toBe('text')
      expect(result.content[0].text).toContain('Results for: "stellar x402 payment"')
      expect(result.content[0].text).toContain('Paid: 0.001 USDC on stellar:testnet')
      expect(result.content[0].text).toContain('1. **Stellar x402 Specification**')
      expect(result.content[0].text).toContain('https://stellar.org/x402')

      // Verify structuredContent
      expect(result.structuredContent).toBeDefined()
      expect(result.structuredContent.query).toBe('stellar x402 payment')
      expect(result.structuredContent.count).toBe(2)
      expect(result.structuredContent.latencyMs).toBe(142)
      expect(result.structuredContent.suggestions).toEqual(['stellar soroban', 'stellar micropayments'])
      expect(result.structuredContent.results).toHaveLength(2)
      expect(result.structuredContent.results[0]).toEqual({
        id: 'res-1',
        title: 'Stellar x402 Specification',
        url: 'https://stellar.org/x402',
        description: 'Official documentation for HTTP 402 payments on Stellar.',
        source: 'stellar.org',
        relevanceScore: 0.98,
      })

      // Verify payment details
      expect(result.structuredContent.payment).toEqual({
        paidAmount: '0.001',
        currency: 'USDC',
        network: 'stellar:testnet',
        txHash: '0xabc123settlement',
      })
      expect(result.structuredContent.paidAmount).toBe('0.001')
      expect(result.structuredContent.currency).toBe('USDC')
      expect(result.structuredContent.network).toBe('stellar:testnet')
      expect(result.structuredContent.txHash).toBe('0xabc123settlement')
    })

    it('returns clean isError response on failure without throwing', async () => {
      const originalFetch = global.fetch
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 402,
        json: async () => ({ error: 'Insufficient funds for payment' }),
      }) as any

      const result = await callToolHandler({
        params: {
          name: 'web_search',
          arguments: { query: 'fail query' },
        },
      })

      global.fetch = originalFetch

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Search failed: Insufficient funds for payment')
    })
  })

  describe('image_search tool execution', () => {
    it('returns both human-readable Markdown text and typed structuredContent', async () => {
      const mockImageResponse = {
        query: 'stellar logo',
        count: 1,
        network: 'stellar:testnet',
        paidAmount: '0.001',
        currency: 'USDC',
        txHash: '0ximgtx123',
        latencyMs: 95,
        results: [
          {
            id: 'img-1',
            title: 'Stellar Lumens Logo Vector',
            imageUrl: 'https://example.com/stellar-logo.png',
            thumbnailUrl: 'https://example.com/stellar-logo-thumb.png',
            sourceUrl: 'https://stellar.org/brand',
            source: 'stellar.org',
            width: 800,
            height: 600,
          },
        ],
      }

      const originalFetch = global.fetch
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockImageResponse,
      }) as any

      const result = await callToolHandler({
        params: {
          name: 'image_search',
          arguments: { query: 'stellar logo', count: 1 },
        },
      })

      global.fetch = originalFetch

      // Verify text content
      expect(result.content[0].text).toContain('Image results for: "stellar logo"')
      expect(result.content[0].text).toContain('Paid: 0.001 USDC on stellar:testnet')
      expect(result.content[0].text).toContain('Image: https://example.com/stellar-logo.png')

      // Verify structuredContent
      expect(result.structuredContent).toBeDefined()
      expect(result.structuredContent.query).toBe('stellar logo')
      expect(result.structuredContent.count).toBe(1)
      expect(result.structuredContent.results[0].imageUrl).toBe('https://example.com/stellar-logo.png')
      expect(result.structuredContent.results[0].sourceUrl).toBe('https://stellar.org/brand')
      expect(result.structuredContent.payment).toEqual({
        paidAmount: '0.001',
        currency: 'USDC',
        network: 'stellar:testnet',
        txHash: '0ximgtx123',
      })
    })

    it('returns clean error response on image search failure', async () => {
      const originalFetch = global.fetch
      global.fetch = vi.fn().mockRejectedValue(new Error('Network timeout')) as any

      const result = await callToolHandler({
        params: {
          name: 'image_search',
          arguments: { query: 'timeout query' },
        },
      })

      global.fetch = originalFetch

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Image search failed: Network timeout')
    })
  })

  describe('news_search tool execution', () => {
    it('returns both human-readable Markdown text and typed structuredContent', async () => {
      const mockNewsResponse = {
        query: 'stellar protocol upgrade',
        count: 1,
        network: 'stellar:testnet',
        paidAmount: '0.001',
        currency: 'USDC',
        txHash: '0xnewstx456',
        latencyMs: 110,
        results: [
          {
            id: 'news-1',
            title: 'Protocol 21 Enabled on Mainnet',
            url: 'https://news.stellar.org/protocol-21',
            snippet: 'Stellar network validators have voted to upgrade to Protocol 21.',
            source: 'Stellar Blog',
            publishedAt: '2 days ago',
            imageUrl: 'https://news.stellar.org/p21.jpg',
          },
        ],
      }

      const originalFetch = global.fetch
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockNewsResponse,
      }) as any

      const result = await callToolHandler({
        params: {
          name: 'news_search',
          arguments: { query: 'stellar protocol upgrade', count: 1, freshness: 'pw' },
        },
      })

      global.fetch = originalFetch

      // Verify text content
      expect(result.content[0].text).toContain('News results for: "stellar protocol upgrade"')
      expect(result.content[0].text).toContain('Protocol 21 Enabled on Mainnet')
      expect(result.content[0].text).toContain('Stellar Blog · 2 days ago')

      // Verify structuredContent
      expect(result.structuredContent).toBeDefined()
      expect(result.structuredContent.query).toBe('stellar protocol upgrade')
      expect(result.structuredContent.count).toBe(1)
      expect(result.structuredContent.results[0].title).toBe('Protocol 21 Enabled on Mainnet')
      expect(result.structuredContent.results[0].snippet).toContain('validators have voted')
      expect(result.structuredContent.payment).toEqual({
        paidAmount: '0.001',
        currency: 'USDC',
        network: 'stellar:testnet',
        txHash: '0xnewstx456',
      })
    })

    it('returns clean error response on news search failure', async () => {
      const originalFetch = global.fetch
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Serper upstream unavailable' }),
      }) as any

      const result = await callToolHandler({
        params: {
          name: 'news_search',
          arguments: { query: 'err query' },
        },
      })

      global.fetch = originalFetch

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('News search failed: Serper upstream unavailable')
    })
  })

  describe('check_balance tool execution', () => {
    it('returns both human-readable balance text and typed structuredContent', async () => {
      const testAddr = 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3'
      const mockHorizonAccount = {
        balances: [
          { asset_type: 'native', balance: '120.5000000' },
          { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: USDC_ISSUER, balance: '3.7500000' },
        ],
      }

      const originalFetch = global.fetch
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockHorizonAccount,
      }) as any

      const result = await callToolHandler({
        params: {
          name: 'check_balance',
          arguments: { address: testAddr },
        },
      })

      global.fetch = originalFetch

      // Verify text content
      expect(result.content[0].text).toContain(`Stellar Account: ${testAddr}`)
      expect(result.content[0].text).toContain('USDC: 3.750000')
      expect(result.content[0].text).toContain('XLM:  120.5000')

      // Verify structuredContent
      expect(result.structuredContent).toBeDefined()
      expect(result.structuredContent.address).toBe(testAddr)
      expect(result.structuredContent.usdcBalance).toBe('3.750000')
      expect(result.structuredContent.xlmBalance).toBe('120.5000')
      expect(result.structuredContent.searchesRemaining).toBe(
        Math.floor(3.75 / parseFloat(AMOUNT_USDC))
      )
      expect(result.structuredContent.network).toBe(STELLAR_NETWORK.split(':')[1])
      expect(result.structuredContent.issuer).toBe(USDC_ISSUER)
      expect(result.structuredContent.explorerUrl).toContain(`/account/${testAddr}`)
      expect(result.structuredContent.timestamp).toBeDefined()
    })

    it('returns clean error when account is not found (404)', async () => {
      const originalFetch = global.fetch
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      }) as any

      const result = await callToolHandler({
        params: {
          name: 'check_balance',
          arguments: { address: 'GNOTFOUND' },
        },
      })

      global.fetch = originalFetch

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Account not found')
    })
  })

  describe('get_search_stats tool execution', () => {
    it('returns both human-readable stats text and typed structuredContent', async () => {
      const mockHealth = {
        status: 'ok',
        network: 'stellar:testnet',
        pricePerQuery: '0.001 USDC',
        protocol: 'x402',
        facilitator: 'https://www.x402.org/facilitator',
        totalQueries: 4200,
        totalUsdcSettled: '4.2000',
        avgLatencyMs: 88,
        uptime: '2d 4h',
        serperApiConfigured: true,
        groqApiConfigured: true,
        receivingAddressConfigured: true,
      }

      const originalFetch = global.fetch
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockHealth,
      }) as any

      const result = await callToolHandler({
        params: {
          name: 'get_search_stats',
          arguments: {},
        },
      })

      global.fetch = originalFetch

      // Verify text content
      expect(result.content[0].text).toContain('StellarSearch Server Stats')
      expect(result.content[0].text).toContain('Total Queries:    4,200')
      expect(result.content[0].text).toContain('USDC Settled:     4.2000 USDC')

      // Verify structuredContent
      expect(result.structuredContent).toBeDefined()
      expect(result.structuredContent.status).toBe('ok')
      expect(result.structuredContent.network).toBe('stellar:testnet')
      expect(result.structuredContent.pricePerQuery).toBe('0.001 USDC')
      expect(result.structuredContent.totalQueries).toBe(4200)
      expect(result.structuredContent.totalUsdcSettled).toBe('4.2000')
      expect(result.structuredContent.avgLatencyMs).toBe(88)
      expect(result.structuredContent.uptime).toBe('2d 4h')
      expect(result.structuredContent.serperApiConfigured).toBe(true)
      expect(result.structuredContent.groqApiConfigured).toBe(true)
    })

    it('returns clean error when health check fails', async () => {
      const originalFetch = global.fetch
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      }) as any

      const result = await callToolHandler({
        params: {
          name: 'get_search_stats',
          arguments: {},
        },
      })

      global.fetch = originalFetch

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Failed to fetch server stats: Server health check returned 503')
    })
  })
})
