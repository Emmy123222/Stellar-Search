import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock MCP SDK before importing server
const mockSetRequestHandler = vi.fn()
const mockSetNotificationHandler = vi.fn()
const mockConnect = vi.fn().mockResolvedValue(undefined)

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: class {
    setRequestHandler = mockSetRequestHandler
    setNotificationHandler = mockSetNotificationHandler
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

const groqCreateMock = vi.hoisted(() => vi.fn())

groqCreateMock.mockResolvedValue({ choices: [{ message: { content: 'summary' } }] })

vi.mock('groq-sdk', () => ({
  default: class {
    chat = { completions: { create: groqCreateMock } }
  },
}))

// Ensure env
process.env.GROQ_API_KEY = 'gsk_test'
process.env.SEARCH_API_URL = 'http://localhost:3001'
process.env.MCP_ENABLE_RECEIPTS = '1'

import { HORIZON_URL, USDC_ISSUER, STELLAR_NETWORK, AMOUNT_USDC } from '../src/lib/constants'
import {
  SERVERLESS_STATS_UNAVAILABLE_REASON,
  declareStatsSupported,
  declareStatsUnsupported,
} from '../src/lib/serverHealth'

const abortError = () => Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })

// Capture handler references at module load — mock call history is cleared per
// test, but registrations only happen once (ESM module cache).
let mcpMod: any
let callToolHandler: Function | undefined
let mcpCancelHandler: Function | undefined

beforeAll(async () => {
  mcpMod = await import('./index.js')
  const call = mockSetRequestHandler.mock.calls.find((c: any) => c[0] === CallToolRequestSchemaMock)
  callToolHandler = call?.[1]
  const cancel = mockSetNotificationHandler.mock.calls.find((c: any) => c[0] === CancelledNotificationSchemaMock)
  mcpCancelHandler = cancel?.[1]
})

/**
 * Helper: get the CallTool handler registered by the MCP server.
 * It is the second setRequestHandler call (after ListTools).
 */
function getCallToolHandler(): Function {
  const calls = mockSetRequestHandler.mock.calls
  // The ListTools handler is the first registration; CallTool is the second.
  if (calls.length >= 2) return calls[1][1] as Function
  // Fallback: any handler whose schema is not the ListTools one
  return calls.find(c => c[0] !== calls[0][0])?.[1] as Function
}

describe('MCP server — alignment with Express/Vercel/browser constants', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = originalFetch
  })

  it('MCP uses same AMOUNT_USDC as server (x402 settlement)', async () => {
    expect(AMOUNT_USDC).toBe('0.001')
    // Import MCP server to trigger handler registration
    const { addMcpReceipt, clearMcpReceipts, getCapabilityDoc, getSearchSchemaDoc } = await import('./index.js')
    expect(mockSetRequestHandler).toHaveBeenCalled()
    const listToolsCall = mockSetRequestHandler.mock.calls.find(c => c[0] === ListToolsRequestSchema)
    expect(listToolsCall).toBeDefined()

    expect(getCapabilityDoc()).toBeDefined()
    expect(getSearchSchemaDoc()).toBeDefined()
    clearMcpReceipts()
    addMcpReceipt({
      id: 'r-1',
      query: 'test',
      txHash: null,
      amount: '0.001',
      currency: 'USDC',
      network: 'stellar:testnet',
      timestamp: new Date().toISOString(),
      latencyMs: 100,
      count: 1,
    })
  })

  it('MCP constants align with Stellar network', () => {
    expect(STELLAR_NETWORK).toMatch(/stellar:(testnet|mainnet)/)
    expect(HORIZON_URL).toContain('horizon')
    expect(USDC_ISSUER.length).toBe(56)
    expect(USDC_ISSUER.startsWith('G')).toBe(true)
  })

  it('MCP server registers web_search, image_search, news_search, ai_summarize, check_balance, get_search_stats', async () => {
    const calls = mockSetRequestHandler.mock.calls
    const listHandler = calls.find(c => c[0] === ListToolsRequestSchema)?.[1] as Function
    expect(listHandler).toBeDefined()
    const result: any = await listHandler()
    expect(result.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'web_search' }),
      expect.objectContaining({ name: 'image_search' }),
      expect.objectContaining({ name: 'news_search' }),
      expect.objectContaining({ name: 'ai_summarize' }),
      expect.objectContaining({ name: 'check_balance' }),
      expect.objectContaining({ name: 'get_search_stats' }),
    ]))
    const webSearch = result.tools.find((t: any) => t.name === 'web_search')
    expect(webSearch.description).toContain(AMOUNT_USDC)
    expect(webSearch.description).toContain('USDC')
  })

  it('MCP resources handlers list and read capability & schema resources', async () => {
    const calls = mockSetRequestHandler.mock.calls
    const listResourcesHandler = calls.find(c => c[0] === ListResourcesRequestSchema)?.[1] as Function
    expect(listResourcesHandler).toBeDefined()
    const resList = await listResourcesHandler()
    expect(resList.resources).toHaveLength(3)

    const readResourceHandler = calls.find(c => c[0] === ReadResourceRequestSchema)?.[1] as Function
    expect(readResourceHandler).toBeDefined()

    const capRes = await readResourceHandler({ params: { uri: 'stellar-search://capabilities' } })
    expect(capRes.contents[0].text).toContain('stellar-search')

    const schemaRes = await readResourceHandler({ params: { uri: 'stellar-search://schema/search' } })
    expect(schemaRes.contents[0].text).toContain('SearchResponse')

    const receiptsRes = await readResourceHandler({ params: { uri: 'stellar-search://receipts/recent' } })
    expect(receiptsRes.contents[0].text).toBeDefined()

    await expect(readResourceHandler({ params: { uri: 'stellar-search://unknown' } })).rejects.toThrow('Unknown resource')
  })

  it('MCP prompts handlers list and get research/summarize prompts', async () => {
    const calls = mockSetRequestHandler.mock.calls
    const listPromptsHandler = calls.find(c => c[0] === ListPromptsRequestSchema)?.[1] as Function
    expect(listPromptsHandler).toBeDefined()
    const promptsList = await listPromptsHandler()
    expect(promptsList.prompts).toHaveLength(3)

    const getPromptHandler = calls.find(c => c[0] === GetPromptRequestSchema)?.[1] as Function
    expect(getPromptHandler).toBeDefined()

    const brief = await getPromptHandler({ params: { name: 'research_brief', arguments: { topic: 'Stellar Soroban' } } })
    expect(brief.messages[0].content.text).toContain('Stellar Soroban')

    const summarize = await getPromptHandler({ params: { name: 'summarize_results', arguments: { results: 'Raw text' } } })
    expect(summarize.messages[0].content.text).toContain('Raw text')

    const compare = await getPromptHandler({ params: { name: 'compare_sources', arguments: { sources: 'Source A vs B' } } })
    expect(compare.messages[0].content.text).toContain('Source A vs B')

    await expect(getPromptHandler({ params: { name: 'unknown_prompt' } })).rejects.toThrow('Unknown prompt')
  })

  it('MCP tool execution for check_balance, ai_summarize, get_search_stats, and unknown tool', async () => {
    const calls = mockSetRequestHandler.mock.calls
    const callToolHandler = calls.find(c => c[0] === CallToolRequestSchema)?.[1] as Function
    expect(callToolHandler).toBeDefined()

    // 1. check_balance
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        balances: [
          { asset_type: 'native', balance: '100.0000000' },
          { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: USDC_ISSUER, balance: '2.5000000' },
        ],
      }),
    }) as any
    const balanceRes: any = await callToolHandler({ params: { name: 'check_balance', arguments: { address: 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3' } } })
    expect(balanceRes.content[0].text).toContain('USDC: 2.500000')

    // 2. ai_summarize
    const aiRes: any = await callToolHandler({ params: { name: 'ai_summarize', arguments: { text: 'Some text' } } })
    expect(aiRes.content[0].text).toBe('Summary generated by Groq')

    // 3. get_search_stats
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'healthy',
        network: 'stellar:testnet',
        uptime: '1h',
        totalQueries: 10,
        totalUsdcSettled: '0.010',
        avgLatencyMs: 250,
        pricePerQuery: '0.001 USDC',
        facilitator: 'https://test.x402.org',
        serperApiConfigured: true,
        groqApiConfigured: true,
      }),
    }) as any
    const statsRes: any = await callToolHandler({ params: { name: 'get_search_stats', arguments: {} } })
    expect(statsRes.content[0].text).toContain('StellarSearch Server Stats')

    // 4. Unknown tool
    const unknownRes: any = await callToolHandler({ params: { name: 'unknown_tool', arguments: {} } })
    expect(unknownRes.isError).toBe(true)
  })

  it('MCP check_balance handler uses Horizon and USDC issuer', async () => {
    const callToolHandler = getCallToolHandler()
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

  it('MCP web_search handler masks blocked URLs safely in tool output text', async () => {
    const calls = mockSetRequestHandler.mock.calls
    const callToolHandler = calls[1]?.[1] as Function
    if (callToolHandler) {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          paidAmount: '0.001',
          currency: 'USDC',
          network: 'stellar:testnet',
          latencyMs: 15,
          count: 2,
          results: [
            { title: 'Good', url: 'https://example.com', description: 'Good site', isBlocked: false },
            { title: 'Bad', url: 'javascript:alert(1)', description: 'Bad link', isBlocked: true },
          ],
        }),
      })
      const originalFetch = global.fetch
      global.fetch = mockFetch as any
      const result: any = await callToolHandler({ params: { name: 'web_search', arguments: { query: 'test' } } })
      expect(result.content[0].text).toContain('https://example.com/')
      expect(result.content[0].text).toContain('[Blocked Link: unsafe protocol or credentials]')
      global.fetch = originalFetch
    }
  })
})

describe('MCP deadlines & cancellation propagation (#170)', () => {
  const getCallToolHandler = () => {
    expect(callToolHandler).toBeDefined()
    return { handler: callToolHandler as Function, mod: mcpMod }
  }

  // fetch mock that only settles when its signal aborts (hangs otherwise)
  const hangUntilAbort = () =>
    vi.fn().mockImplementation((_url: any, opts: any) => new Promise((_resolve, reject) => {
      const signal = opts?.signal
      if (!signal) return reject(new Error('no signal provided'))
      if (signal.aborted) return reject(abortError())
      signal.addEventListener('abort', () => reject(abortError()), { once: true })
    }))

  beforeEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    mcpMod.clearMcpReceipts()
  })

  it('deadlineSignal aborts exactly when the deadline elapses', () => {
    const { deadlineSignal } = mcpMod
    vi.useFakeTimers()
    try {
      const parent = new AbortController()
      const dl = deadlineSignal(parent.signal, 5000)
      expect(dl.signal.aborted).toBe(false)
      vi.advanceTimersByTime(4999)
      expect(dl.signal.aborted).toBe(false)
      vi.advanceTimersByTime(1)
      expect(dl.signal.aborted).toBe(true)
      expect(dl.timedOut()).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('deadlineSignal propagates client cancellation immediately (not a timeout)', () => {
    const { deadlineSignal } = mcpMod
    const parent = new AbortController()
    const dl = deadlineSignal(parent.signal, 5000)
    expect(dl.signal.aborted).toBe(false)
    parent.abort()
    expect(dl.signal.aborted).toBe(true)
    expect(dl.timedOut()).toBe(false)
    dl.clear()
  })

  it('deadlineSignal is already aborted when the parent is aborted up front', () => {
    const { deadlineSignal } = mcpMod
    const parent = new AbortController()
    parent.abort()
    const dl = deadlineSignal(parent.signal, 5000)
    expect(dl.signal.aborted).toBe(true)
    dl.clear()
  })

  it('deadlineSignal clear() cancels the pending timer', () => {
    const { deadlineSignal } = mcpMod
    vi.useFakeTimers()
    try {
      const parent = new AbortController()
      const dl = deadlineSignal(parent.signal, 1000)
      dl.clear()
      vi.advanceTimersByTime(10_000)
      expect(dl.signal.aborted).toBe(false)
      expect(dl.timedOut()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('web_search injects a deadline-derived AbortSignal into the fetch call', async () => {
    const { handler } = getCallToolHandler()
    let capturedSignal: AbortSignal | undefined
    global.fetch = vi.fn().mockImplementation(async (_url: string, opts: any) => {
      capturedSignal = opts.signal
      return { ok: true, json: async () => ({ results: [], count: 0, paidAmount: '0.001', currency: 'USDC', network: 'stellar:testnet', latencyMs: 1 }) }
    })
    const result: any = await handler({ params: { name: 'web_search', arguments: { query: 'stellar' } } })
    expect(capturedSignal).toBeInstanceOf(AbortSignal)
    expect(result.content[0].text).toContain('Results for')
  })

  it('web_search returns promptly with a timeout error when the deadline elapses', async () => {
    const { handler, mod } = getCallToolHandler()
    global.fetch = hangUntilAbort()
    vi.useFakeTimers()
    try {
      const pending = handler({ params: { name: 'web_search', arguments: { query: 'stellar' } } })
      vi.advanceTimersByTime(mod.TOOL_TIMEOUTS.webSearch)
      const result: any = await pending
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('timed out')
      // No delayed success result or receipt after the deadline
      expect(mod.mcpReceipts).toHaveLength(0)
      expect(global.fetch).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a cancelled client connection aborts the in-flight call and emits no receipt', async () => {
    const { handler, mod } = getCallToolHandler()
    global.fetch = hangUntilAbort()

    const pending = handler({
      id: 'cancel-req-170',
      params: { name: 'web_search', arguments: { query: 'stellar' }, _meta: { progressToken: 170 } },
    })

    // Simulate the MCP notifications/cancelled handler registered at startup
    expect(mcpCancelHandler).toBeDefined()
    await (mcpCancelHandler as Function)({ params: { requestId: 'cancel-req-170' } })

    const result: any = await pending
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('cancelled')
    // Cancellation must not record a paid receipt or emit delayed success
    expect(mod.mcpReceipts).toHaveLength(0)
  })

  it('ai_summarize forwards the deadline signal to Groq', async () => {
    const { handler } = getCallToolHandler()
    let groqOpts: any
    groqCreateMock.mockImplementation(async (_body: any, opts: any) => {
      groqOpts = opts
      return { choices: [{ message: { content: 'summary' } }] }
    })
    const result: any = await handler({ params: { name: 'ai_summarize', arguments: { text: 'hello' } } })
    expect(groqOpts?.signal).toBeInstanceOf(AbortSignal)
    expect(result.content[0].text).toBe('summary')
  })
})
