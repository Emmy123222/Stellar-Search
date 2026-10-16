import { describe, it, expect, vi } from 'vitest'
import { StellarSearchTool } from './langchain-search'
import { StellarSearchToolSpec } from './llama-index-search'

describe('LangChain and LlamaIndex integration examples (#agent-api)', () => {
  it('LangChain tool exposes cost and triggers approval callback', async () => {
    const approvalFn = vi.fn().mockResolvedValue(true)
    const tool = new StellarSearchTool({ dryRun: true, onApprovalRequested: approvalFn })

    expect(tool.name).toBe('stellar_web_search')
    const result = await tool._call({ query: 'Stellar blockchain', count: 3 })
    const parsed = JSON.parse(result)

    expect(approvalFn).toHaveBeenCalledWith(expect.objectContaining({ cost: '0.001', currency: 'USDC' }))
    expect(parsed.dryRun).toBe(true)
    expect(parsed.sdkLink).toContain('x402')
  })

  it('LlamaIndex tool spec exposes tool list and requires payment approval', async () => {
    const approvalFn = vi.fn().mockResolvedValue(false)
    const spec = new StellarSearchToolSpec({ dryRun: true, onApprovalRequested: approvalFn })

    const tools = spec.toToolList()
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('stellar_web_search')

    await expect(spec.search({ query: 'Soroban' })).rejects.toThrow('Payment approval denied')
    expect(approvalFn).toHaveBeenCalled()
  })
})
