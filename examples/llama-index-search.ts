/**
 * examples/llama-index-search.ts
 * 
 * LlamaIndex-compatible integration example for StellarSearch x402 paid search tool.
 * Exposes cost and side effects before execution and links to maintained SDK APIs.
 * 
 * See: https://developers.stellar.org/docs/build/agentic-payments/x402
 */

export interface LlamaIndexToolSpecOptions {
  serverUrl?: string
  dryRun?: boolean
  onApprovalRequested?: (quote: { cost: string; currency: string; resource: string }) => Promise<boolean>
}

export class StellarSearchToolSpec {
  serverUrl: string
  dryRun: boolean
  onApprovalRequested: NonNullable<LlamaIndexToolSpecOptions['onApprovalRequested']>

  constructor(options: LlamaIndexToolSpecOptions = {}) {
    this.serverUrl = options.serverUrl || process.env.SEARCH_API_URL || 'http://localhost:3001'
    this.dryRun = options.dryRun ?? true
    this.onApprovalRequested = options.onApprovalRequested || (async () => true)
  }

  async search({ query, count = 5 }: { query: string; count?: number }): Promise<string> {
    const cost = '0.001'
    const currency = 'USDC'
    const resource = `/search?q=${encodeURIComponent(query)}&count=${count}`

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

  toToolList() {
    return [
      {
        name: 'stellar_web_search',
        description: 'Per-query paid web search on Stellar via x402 protocol (Cost: 0.001 USDC).',
        fn: this.search.bind(this),
      },
    ]
  }
}
