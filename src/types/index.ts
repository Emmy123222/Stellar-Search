export type PaymentStep = 1 | 2 | 3 | 4 | 5 | 6

export interface SearchResult {
  id: string
  title: string
  url: string
  description: string
  source: string
  relevanceScore: number
  publishedAt?: string
}

export interface SearchSession {
  query: string
  results: SearchResult[]
  txHash: string | null
  paidAmount: string | null
  status: 'idle' | 'searching' | 'done' | 'error' | 'complete'
  step?: PaymentStep
  error?: string
  suggestions?: string[]
  durationMs?: number
}

export interface WalletState {
  publicKey: string | null
  connected: boolean
  network: string
  xlmBalance: string
  usdcBalance: string
  loading: boolean
  error: string | null
}

export interface StellarTransaction {
  id: string
  hash: string
  type: string
  amount: string
  asset: string
  from: string
  to: string
  timestamp: string
  memo?: string
}

export interface SearchReceipt {
  txHash: string
  query: string
  amount: string
  timestamp: string
  network: string
}

export interface ApiStat {
  totalQueries: number
  totalUsdcSettled: string
  avgLatencyMs: number
  uptime: string
}

export interface ImageResult {
  id: string
  title: string
  imageUrl: string
  thumbnailUrl: string
  sourceUrl: string
  source: string
  width?: number
  height?: number
}

export interface NewsResult {
  id: string
  title: string
  url: string
  snippet: string
  source: string
  publishedAt?: string
  imageUrl?: string
}

export interface SearchResponse {
  query: string
  results: SearchResult[]
  count: number
  network: string
  paidAmount: string
  currency: string
  txHash: string | null
  latencyMs: number
  suggestions?: string[]
}

export interface ImageSearchResponse {
  query: string
  results: ImageResult[]
  count: number
  network: string
  paidAmount: string
  currency: string
  txHash: string | null
  latencyMs: number
}

export interface NewsSearchResponse {
  query: string
  results: NewsResult[]
  count: number
  network: string
  paidAmount: string
  currency: string
  txHash: string | null
  latencyMs: number
}

/**
 * Auditable, off-chain credit issued when a paid search fails after x402
 * settlement (e.g. a provider outage). Distinct from an on-chain refund —
 * see src/lib/creditLedger.ts and README.md → "Failed-Search Credits".
 */
export interface CreditReceipt {
  creditId: string
  receiptId: string
  route: string
  query: string
  amount: string
  currency: string
  reason: string
  issuedAt: string
  expiresAt: string
  redeemed: boolean
  redeemedAt: string | null
}

export interface ApiErrorResponse {
  error: string
  credit?: CreditReceipt
}

// Aliases for response types
export type WebSearchResponse = SearchResponse
export type ImageResponse = ImageSearchResponse
export type NewsResponse = NewsSearchResponse
export type ErrorResponse = ApiErrorResponse
