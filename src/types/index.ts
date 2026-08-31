export type { WalletState, StellarTransaction } from '../hooks/useFreighterWallet'
export type { SearchResult, SearchSession } from '../hooks/useSearch'

export interface ApiStat {
  totalQueries: number
  totalUsdcSettled: string
  avgLatencyMs: number
  uptime: string
}

/**
 * Versioned payment receipt schema for paid endpoints.
 * Provides a stable record of amount, asset, network, payer/payee, timestamp, and transaction reference.
 */
export interface PaymentReceipt {
  version: '1.0'
  amount: string
  asset: string
  network: string
  payer: string
  payee: string
  timestamp: string
  transactionHash: string
}
