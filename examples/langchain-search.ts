/**
 * examples/langchain-search.ts
 * 
 * LangChain-compatible integration example for StellarSearch x402 paid search tool.
 * Exposes cost and side effects before execution and links to maintained SDK APIs.
 * 
 * See: https://developers.stellar.org/docs/build/agentic-payments/x402
 */

export interface StellarSearchLangChainConfig {
  serverUrl?: string
  apiKey?: string
  dryRun?: boolean
  onApprovalRequested?: (quote: { cost: string; currency: string; resource: string }) => Promise<boolean>
}

export class StellarSearchTool {
  name = 'stellar_web_search'
  description = 'Per-query paid web search on Stellar via x402 protocol (Cost: 0.001 USDC).'

  serverUrl: string
  dryRun: boolean
  onApprovalRequested: NonNullable<StellarSearchLangChainConfig['onApprovalRequested']>

  constructor(config: StellarSearchLangChainConfig = {}) {
    this.serverUrl = config.serverUrl || process.env.SEARCH_API_URL || 'http://localhost:3001'
    this.dryRun = config.dryRun ?? true
    this.onApprovalRequested = config.onApprovalRequested || (async () => true)
  }

  async _call(arg: { query: string; count?: number }): Promise<string> {
    const cost = '0.001'
    const currency = 'USDC'
    const resource = `/search?q=${encodeURIComponent(arg.query)}&count=${arg.count ?? 5}`

    const approved = await this.onApprovalRequested({ cost, currency, resource })
    if (!approved) {
      throw new Error('Payment approval denied by user or policy')
    }

    if (this.dryRun) {
      return JSON.stringify({
        dryRun: true,
        cost,
        currency,
        endpoint: `${this.serverUrl}${resource}`,
        sdkLink: 'https://developers.stellar.org/docs/build/agentic-payments/x402',
      })
    }

    const res = await fetch(`${this.serverUrl}${resource}`)
    if (res.status === 402) {
      const paymentRequiredHeader = res.headers.get('payment-required') || res.headers.get('PAYMENT-REQUIRED')
      return JSON.stringify({
        error: 'Payment required',
        paymentRequired: paymentRequiredHeader,
        sdkLink: 'https://developers.stellar.org/docs/build/agentic-payments/x402',
      })
    }

    if (!res.ok) {
      throw new Error(`Search failed with status ${res.status}`)
    }

    const data = await res.json()
    return JSON.stringify(data)
  }
}
