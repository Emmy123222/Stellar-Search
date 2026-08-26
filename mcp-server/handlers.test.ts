import { describe, expect, it, vi } from 'vitest'
import { aiSummarize, checkBalance, webSearch } from './handlers'

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('MCP tool handlers', () => {
  it('formats web_search results and forwards query options', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ paidAmount: '0.001', currency: 'USDC', network: 'stellar:testnet', latencyMs: 10, count: 1, results: [{ title: 'Docs', url: 'https://example.com', description: 'Useful' }] }))
    const result = await webSearch(fetcher, 'http://search', 'stellar sdk', 3, 'pd')
    expect(fetcher.mock.calls[0][0]).toContain('q=stellar+sdk')
    expect(fetcher.mock.calls[0][0]).toContain('count=3')
    expect(result.content[0].text).toContain('**Docs**')
  })

  it('returns a useful web_search error for failed responses', async () => {
    const result = await webSearch(vi.fn().mockResolvedValue(response({ error: 'payment required' }, 402)), 'http://search', 'stellar')
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('payment required')
  })

  it('returns the Groq summary and handles Groq errors', async () => {
    const groq = { chat: { completions: { create: vi.fn().mockResolvedValue({ choices: [{ message: { content: 'Summary' } }] }) } } }
    expect((await aiSummarize(groq, 'Long text')).content[0].text).toBe('Summary')
    groq.chat.completions.create.mockRejectedValueOnce(new Error('rate limit'))
    expect((await aiSummarize(groq, 'Long text')).content[0].text).toContain('rate limit')
  })

  it('formats balances and reports Horizon 404 errors', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ balances: [{ asset_type: 'native', balance: '12.3456789' }] }))
    expect((await checkBalance(fetcher, 'GABC')).content[0].text).toContain('12.3457')
    expect((await checkBalance(vi.fn().mockResolvedValue(response({}, 404)), 'Gmissing')).content[0].text).toContain('Account not found')
  })
})
