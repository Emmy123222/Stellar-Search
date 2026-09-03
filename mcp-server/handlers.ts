import { AMOUNT_USDC, HORIZON_URL, STELLAR_EXPERT_URL, STELLAR_NETWORK, USDC_ISSUER } from '../src/lib/constants'

export interface ToolResult { content: [{ type: 'text'; text: string }]; isError?: boolean }
type Fetcher = typeof fetch

const errorResult = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true })

export async function webSearch(fetcher: Fetcher, serverUrl: string, query: string, count = 5, freshness?: string): Promise<ToolResult> {
  try {
    const params = new URLSearchParams({ q: query, count: String(count) })
    if (freshness) params.set('freshness', freshness)
    const response = await fetcher(`${serverUrl}/search?${params}`)
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `HTTP ${response.status}`)
    const data = await response.json()
    const formatted = data.results.map((r: { title: string; url: string; description: string }, i: number) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.description}`).join('\n\n')
    return { content: [{ type: 'text', text: [`🔍 Results for: "${query}"`, `💰 Paid: ${data.paidAmount} ${data.currency} on ${data.network}`, `⚡ Latency: ${data.latencyMs}ms`, `📊 ${data.count} results\n`, formatted].join('\n') }] }
  } catch (error) {
    return errorResult(`Search failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function aiSummarize(groq: { chat: { completions: { create: (args: unknown) => Promise<{ choices: Array<{ message?: { content?: string } }> }> } } }, text: string, instruction = 'summarise'): Promise<ToolResult> {
  try {
    const completion = await groq.chat.completions.create({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'system', content: 'You are a concise research assistant. Be brief and accurate.' }, { role: 'user', content: `Please ${instruction} the following:\n\n${text}` }], max_tokens: 512, temperature: 0.5 })
    return { content: [{ type: 'text', text: completion.choices[0]?.message?.content || 'No response.' }] }
  } catch (error) {
    return errorResult(`Groq error: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function checkBalance(fetcher: Fetcher, address: string): Promise<ToolResult> {
  try {
    const response = await fetcher(`${HORIZON_URL}/accounts/${address}`)
    if (response.status === 404) throw new Error(`Account not found on Stellar ${STELLAR_NETWORK.split(':')[1]}`)
    if (!response.ok) throw new Error(`Horizon returned ${response.status}`)
    const account = await response.json()
    let xlm = '0', usdc = '0'
    for (const balance of account.balances) {
      if (balance.asset_type === 'native') xlm = parseFloat(balance.balance).toFixed(4)
      if (balance.asset_type === 'credit_alphanum4' && balance.asset_code === 'USDC' && balance.asset_issuer === USDC_ISSUER) usdc = parseFloat(balance.balance).toFixed(6)
    }
    const queries = Math.floor(parseFloat(usdc) / parseFloat(AMOUNT_USDC))
    return { content: [{ type: 'text', text: [`💳 Stellar Account: ${address}`, `   USDC: ${usdc} (~${queries.toLocaleString()} searches remaining)`, `   XLM:  ${xlm}`, `   Network: ${STELLAR_NETWORK.split(':')[1]}`, `   Explorer: ${STELLAR_EXPERT_URL}/account/${address}`].join('\n') }] }
  } catch (error) {
    return errorResult(`Balance check failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}
