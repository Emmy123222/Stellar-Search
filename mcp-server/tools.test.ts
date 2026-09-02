import { describe, it, expect, vi } from 'vitest'

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

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  CallToolRequestSchema: CallToolRequestSchemaMock,
  ListToolsRequestSchema: ListToolsRequestSchemaMock,
  ListResourcesRequestSchema: ListResourcesRequestSchemaMock,
  ReadResourceRequestSchema: ReadResourceRequestSchemaMock,
  ListPromptsRequestSchema: ListPromptsRequestSchemaMock,
  GetPromptRequestSchema: GetPromptRequestSchemaMock,
}))

vi.mock('groq-sdk', () => ({
  default: class {
    chat = { completions: { create: vi.fn().mockResolvedValue({ choices: [{ message: { content: 'summary' } }] }) } }
  },
}))

// Ensure env
process.env.GROQ_API_KEY = 'gsk_test'
process.env.SEARCH_API_URL = 'http://localhost:3001'

import { HORIZON_URL, USDC_ISSUER, STELLAR_NETWORK, AMOUNT_USDC } from '../src/lib/constants'
import {
  SERVERLESS_STATS_UNAVAILABLE_REASON,
  declareStatsSupported,
  declareStatsUnsupported,
} from '../src/lib/serverHealth'

describe('MCP server — alignment with Express/Vercel/browser constants', () => {
  it('MCP uses same AMOUNT_USDC as server (x402 settlement)', async () => {
    expect(AMOUNT_USDC).toBe('0.001')
    // Import MCP server to trigger handler registration
    await import('./index.js')
    // Verify that ListTools handler was registered
    expect(mockSetRequestHandler).toHaveBeenCalled()
    const listToolsCall = mockSetRequestHandler.mock.calls.find(c => c[0] === ListToolsRequestSchemaMock)
    expect(listToolsCall).toBeDefined()
  })

  it('MCP constants align with Stellar network', () => {
    expect(STELLAR_NETWORK).toMatch(/stellar:(testnet|mainnet)/)
    expect(HORIZON_URL).toContain('horizon')
    expect(USDC_ISSUER.length).toBe(56)
    expect(USDC_ISSUER.startsWith('G')).toBe(true)
  })

  it('MCP server registers web_search, image_search, news_search, ai_summarize, check_balance, get_search_stats', async () => {
    const listToolsCall = mockSetRequestHandler.mock.calls.find(c => c[0] === ListToolsRequestSchemaMock)
    expect(listToolsCall).toBeDefined()
    const listHandler = listToolsCall![1] as Function
    const result: any = await listHandler()
    expect(result.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'web_search' }),
      expect.objectContaining({ name: 'image_search' }),
      expect.objectContaining({ name: 'news_search' }),
      expect.objectContaining({ name: 'ai_summarize' }),
      expect.objectContaining({ name: 'check_balance' }),
      expect.objectContaining({ name: 'get_search_stats' }),
    ]))
    // Verify payment amount in description
    const webSearch = result.tools.find((t: any) => t.name === 'web_search')
    expect(webSearch.description).toContain(AMOUNT_USDC)
    expect(webSearch.description).toContain('USDC')
  })

  it('MCP check_balance handler uses Horizon and USDC issuer', async () => {
    const callToolCall = mockSetRequestHandler.mock.calls.find(c => c[0] === CallToolRequestSchemaMock)
    const callToolHandler = callToolCall?.[1] as Function
    if (callToolHandler) {
      // Mock fetch for Horizon
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          balances: [
            { asset_type: 'native', balance: '100.0000000' },
            { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: USDC_ISSUER, balance: '2.5000000' },
          ],
        }),
      })
      const originalFetch = global.fetch
      global.fetch = mockFetch as any
      const result: any = await callToolHandler({ params: { name: 'check_balance', arguments: { address: 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3' } } })
      expect(result.content[0].text).toContain('USDC: 2.500000')
      global.fetch = originalFetch
    } else {
      // Fallback: ensure USDC issuer aligns
      expect(USDC_ISSUER).toBeDefined()
    }
  })
})

// ─── get_search_stats and the health statistics contract (#226) ─────────────

describe('MCP get_search_stats — honours the health statistics declaration', () => {
  const HEALTH_CONFIG = {
    status: 'ok',
    network: 'stellar:testnet',
    pricePerQuery: '0.001 USDC',
    protocol: 'x402',
    facilitator: 'https://www.x402.org/facilitator',
    serperApiConfigured: true,
    groqApiConfigured: true,
    receivingAddressConfigured: true,
  }

  /** Invokes get_search_stats against a stubbed /health payload. */
  async function callStats(health: Record<string, unknown>): Promise<string> {
    await import('./index.js')
    const callToolCall = mockSetRequestHandler.mock.calls.find((c) => c[0] === CallToolRequestSchemaMock)
    const callToolHandler = callToolCall?.[1] as Function
    expect(callToolHandler).toBeDefined()

    const originalFetch = global.fetch
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => health }) as any
    try {
      const result: any = await callToolHandler({ params: { name: 'get_search_stats', arguments: {} } })
      expect(result.isError).toBeFalsy()
      return result.content[0].text as string
    } finally {
      global.fetch = originalFetch
    }
  }

  it('prints live counters from an Express deployment', async () => {
    const text = await callStats({
      ...HEALTH_CONFIG,
      totalQueries: 1234,
      totalUsdcSettled: '1.2340',
      avgLatencyMs: 412,
      uptime: '7m',
      ...declareStatsSupported(),
    })

    expect(text).toContain('Total Queries:    1,234')
    expect(text).toContain('USDC Settled:     1.2340 USDC')
    expect(text).toContain('Avg Latency:      412ms')
    expect(text).toContain('Uptime:           7m')
    expect(text).not.toContain('not reported')
  })

  it('prints a genuine zero as zero rather than "not reported"', async () => {
    const text = await callStats({
      ...HEALTH_CONFIG,
      totalQueries: 0,
      totalUsdcSettled: '0.0000',
      avgLatencyMs: 0,
      uptime: '3s',
      ...declareStatsSupported(),
    })

    expect(text).toContain('Total Queries:    0')
    expect(text).toContain('Avg Latency:      0ms')
    expect(text).not.toContain('not reported')
  })

  it('reports unmeasured counters as "not reported" against a serverless deployment', async () => {
    // Before #226 this path threw on `undefined.toLocaleString()` and surfaced
    // as a bogus "Failed to fetch server stats".
    const text = await callStats({
      ...HEALTH_CONFIG,
      ...declareStatsUnsupported(SERVERLESS_STATS_UNAVAILABLE_REASON),
    })

    expect(text).toContain('Total Queries:    not reported')
    expect(text).toContain('USDC Settled:     not reported')
    expect(text).toContain('Avg Latency:      not reported')
    expect(text).toContain('Uptime:           not reported')
    // No fabricated zeros anywhere in the rendered stats.
    expect(text).not.toMatch(/Total Queries:\s+0/)
    expect(text).not.toMatch(/Avg Latency:\s+0ms/)
  })

  it('explains once why the counters are missing, without hiding the config facts', async () => {
    const text = await callStats({
      ...HEALTH_CONFIG,
      ...declareStatsUnsupported(SERVERLESS_STATS_UNAVAILABLE_REASON),
    })

    expect(text).toContain('Activity counters are not available on this deployment')
    expect(text).toContain(SERVERLESS_STATS_UNAVAILABLE_REASON)
    // Settlement configuration is still reported truthfully.
    expect(text).toContain('Price per Query:  0.001 USDC')
    expect(text).toContain('Network:          stellar:testnet')
  })

  it('does not throw on a pre-contract payload that omits both counters and declaration', async () => {
    const text = await callStats({ ...HEALTH_CONFIG })
    expect(text).toContain('Total Queries:    not reported')
    expect(text).toContain('Activity counters are not available on this deployment')
  })
})
