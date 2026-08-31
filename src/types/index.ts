/**
 * Wallet state definition for Freighter integration.
 */
export interface WalletState {
  publicKey: string | null
  connected: boolean
  network: string
  xlmBalance: string
  usdcBalance: string
  loading: boolean
  error: string | null
}

/**
 * Individual transaction item from Horizon history.
 */
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

/**
 * Common metadata included in search responses across endpoints.
 */
export interface BaseSearchResponse {
  query: string
  count: number
  network: string
  paidAmount: string
  currency: string
  txHash: string | null
  latencyMs: number
}

/**
 * Individual organic web search result item.
 */
export interface SearchResult {
  id: string
  title: string
  url: string
  description: string
  source: string
  relevanceScore: number
  publishedAt?: string
}

/**
 * Payload returned by web search endpoints (Express GET /search and Vercel GET /api/search).
 */
export interface SearchResponse extends BaseSearchResponse {
  results: SearchResult[]
  suggestions?: string[]
}

/**
 * Individual image search result item.
 */
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

/**
 * Payload returned by image search endpoints (Express GET /images).
 */
export interface ImageSearchResponse extends BaseSearchResponse {
  results: ImageResult[]
}

/**
 * Individual news search result item.
 */
export interface NewsResult {
  id: string
  title: string
  url: string
  snippet: string
  source: string
  publishedAt?: string
  imageUrl?: string
}

/**
 * Payload returned by news search endpoints (Express GET /news).
 */
export interface NewsSearchResponse extends BaseSearchResponse {
  results: NewsResult[]
}

/**
 * Settlement payment receipt stored locally or returned in UI history.
 */
export interface SearchReceipt {
  txHash: string
  query: string
  amount: string
  timestamp: string
  network: string
}

/**
 * Standard error response structure across Express and Vercel handlers.
 */
export interface ApiErrorResponse {
  error: string
}

export type WebSearchResponse = SearchResponse
export type ImageResponse = ImageSearchResponse
export type NewsResponse = NewsSearchResponse
export type ErrorResponse = ApiErrorResponse

// x402 payment flow step numbers (1: Request -> 6: Result)
export type PaymentStep = 1 | 2 | 3 | 4 | 5 | 6

/**
 * UI search session state tracking status, results, and payment steps.
 */
export interface SearchSession {
  query: string
  results: SearchResult[]
  txHash: string | null
  paidAmount: string | null
  status: 'idle' | 'searching' | 'complete' | 'error'
  step?: PaymentStep
  error?: string
  durationMs?: number
  suggestions: string[]
}

export interface ApiStat {
  totalQueries: number
  totalUsdcSettled: string
  avgLatencyMs: number
  uptime: string
}
