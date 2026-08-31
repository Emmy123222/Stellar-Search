import { describe, it, expect, vi } from 'vitest'
import {
  AI_TEXT_MAX_LENGTH,
  AI_INSTRUCTION_MAX_LENGTH,
  AI_COMBINED_MAX_LENGTH,
} from '../src/lib/constants'

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
})

describe('MCP ai_summarize — input length validation (#169)', () => {
  it('schema declares per-field and combined character limits', async () => {
    const listHandler = mockSetRequestHandler.mock.calls[0][1] as Function
    const result: any = await listHandler()
    const aiTool = result.tools.find((t: any) => t.name === 'ai_summarize')
    expect(aiTool).toBeDefined()
    // Description should mention limits
    expect(aiTool.description).toBeDefined()
    // inputSchema text property mentions the text limit
    const textDesc = aiTool.inputSchema.properties.text.description
    expect(textDesc).toContain(String(AI_TEXT_MAX_LENGTH))
    expect(textDesc).toContain(String(AI_COMBINED_MAX_LENGTH))
    // inputSchema instruction property mentions the instruction limit
    const instrDesc = aiTool.inputSchema.properties.instruction.description
    expect(instrDesc).toContain(String(AI_INSTRUCTION_MAX_LENGTH))
  })

  it('accepts text at exactly the max length (boundary)', async () => {
    const callToolHandler = getCallToolHandler()
    const exactText = 'a'.repeat(AI_TEXT_MAX_LENGTH)
    // instruction must be empty (or short enough that combined stays within limit)
    // since text alone is already at AI_TEXT_MAX_LENGTH (10000)
    const result: any = await callToolHandler({
      params: { name: 'ai_summarize', arguments: { text: exactText, instruction: '' } },
    })
    // Should NOT be an error — Groq mock returns successfully
    expect(result.isError).toBeFalsy()
    expect(result.content[0].text).toBe('summary')
  })

  it('rejects text exceeding max length (oversized)', async () => {
    const callToolHandler = getCallToolHandler()
    const oversizedText = 'a'.repeat(AI_TEXT_MAX_LENGTH + 1)
    const result: any = await callToolHandler({
      params: { name: 'ai_summarize', arguments: { text: oversizedText } },
    })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('text exceeds maximum length')
    expect(result.content[0].text).toContain(String(AI_TEXT_MAX_LENGTH))
  })

  it('rejects instruction exceeding max length (oversized)', async () => {
    const callToolHandler = getCallToolHandler()
    const oversizedInstr = 'x'.repeat(AI_INSTRUCTION_MAX_LENGTH + 1)
    const result: any = await callToolHandler({
      params: { name: 'ai_summarize', arguments: { text: 'hello', instruction: oversizedInstr } },
    })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('instruction exceeds maximum length')
    expect(result.content[0].text).toContain(String(AI_INSTRUCTION_MAX_LENGTH))
  })

  it('rejects combined text + instruction exceeding combined max (oversized)', async () => {
    const callToolHandler = getCallToolHandler()
    // text near limit + instruction near limit → combined exceeds
    const textLen = AI_TEXT_MAX_LENGTH - 100
    const instrLen = AI_COMBINED_MAX_LENGTH - textLen + 1
    const result: any = await callToolHandler({
      params: {
        name: 'ai_summarize',
        arguments: { text: 'a'.repeat(textLen), instruction: 'b'.repeat(instrLen) },
      },
    })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('combined text + instruction length exceeds')
    expect(result.content[0].text).toContain(String(AI_COMBINED_MAX_LENGTH))
  })

  it('accepts text + instruction at exactly the combined max (boundary)', async () => {
    const callToolHandler = getCallToolHandler()
    const textLen = AI_TEXT_MAX_LENGTH - 100
    const instrLen = AI_COMBINED_MAX_LENGTH - textLen
    const result: any = await callToolHandler({
      params: {
        name: 'ai_summarize',
        arguments: { text: 'a'.repeat(textLen), instruction: 'b'.repeat(instrLen) },
      },
    })
    // Should NOT be an error — exactly at the combined limit
    expect(result.isError).toBeFalsy()
    expect(result.content[0].text).toBe('summary')
  })
})
