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
