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
  originalQuery?: string
  executedQuery?: string
  suggestedQuery?: string
  isCorrected?: boolean
  results: SearchResult[]
  txHash: string | null
  paidAmount: string | null
  status: 'idle' | 'searching' | 'done' | 'error' | 'complete'
  step?: PaymentStep
  error?: string
  suggestions?: string[]
  durationMs?: number
}

export type WalletAccountStatus = 'unfunded' | 'no_trustline' | 'zero_balance' | 'funded'

export interface WalletState {
  publicKey: string | null
  connected: boolean
  network: string
  xlmBalance: string
  usdcBalance: string
  /** True once the account has a USDC trustline (a balance line exists for
   *  it), independent of whether that balance is currently 0. Distinct
   *  from `usdcBalance === '0'`, which is also true for an account with a
   *  trustline but nothing funded into it yet (#342). */
  hasUsdcTrustline: boolean
  loading: boolean
  error: string | null
  accountExists: boolean
  accountStatus: WalletAccountStatus
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
  originalQuery?: string
  executedQuery?: string
  suggestedQuery?: string
  isCorrected?: boolean
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

export interface ApiErrorResponse {
  error: string
}

// Aliases for response types
export type WebSearchResponse = SearchResponse
export type ImageResponse = ImageSearchResponse
export type NewsResponse = NewsSearchResponse
export type ErrorResponse = ApiErrorResponse

// ─── JSON Lines batch streaming (issue #325) ─────────────────────────────────

export const BATCH_JSONL_VERSION = 1 as const
export const MAX_BATCH_SIZE = 10
export const MAX_BATCH_TOTAL_USDC = '0.01'

export type BatchItemStatus = 'pending' | 'settled' | 'success' | 'error' | 'skipped'

export interface BatchSearchRequest {
  queries: string[]
  count?: number
  freshness?: 'pd' | 'pw' | 'pm'
  idempotencyKey?: string
}

export type BatchJsonlEventType = 'quote' | 'settlement' | 'result' | 'error' | 'done'

export interface BatchJsonlQuoteEvent {
  v: typeof BATCH_JSONL_VERSION
  type: 'quote'
  requestId: string
  totalQueries: number
  pricePerQuery: string
  totalAmount: string
  currency: string
  network: string
  payTo: string
  idempotencyKey?: string
}

export interface BatchJsonlSettlementEvent {
  v: typeof BATCH_JSONL_VERSION
  type: 'settlement'
  requestId: string
  paymentId: string | null
  txHash: string | null
  verified: boolean
  settledAt: string
}

export interface BatchJsonlResultEvent {
  v: typeof BATCH_JSONL_VERSION
  type: 'result'
  requestId: string
  index: number
  query: string
  originalQuery?: string
  executedQuery?: string
  suggestedQuery?: string
  isCorrected?: boolean
  results: SearchResult[]
  count: number
  latencyMs: number
  paidAmount: string
  currency: string
  network: string
  txHash: string | null
}

export interface BatchJsonlErrorEvent {
  v: typeof BATCH_JSONL_VERSION
  type: 'error'
  requestId: string
  index: number
  query: string
  error: string
  code: string
}

export interface BatchJsonlDoneEvent {
  v: typeof BATCH_JSONL_VERSION
  type: 'done'
  requestId: string
  succeeded: number
  failed: number
  totalUsdcSpent: string
  aggregateLatencyMs: number
  completedAt: string
}

export type BatchJsonlEvent =
  | BatchJsonlQuoteEvent
  | BatchJsonlSettlementEvent
  | BatchJsonlResultEvent
  | BatchJsonlErrorEvent
  | BatchJsonlDoneEvent

// ─── Asynchronous paid search jobs with webhooks (issue #324) ─────────────────

export type JobStatus = 'pending' | 'settling' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface SearchJobRequest {
  query: string
  count?: number
  freshness?: 'pd' | 'pw' | 'pm'
  webhookUrl?: string
  webhookSecret?: string
  idempotencyKey?: string
}

export interface SearchJob {
  id: string
  query: string
  count: number
  freshness?: string
  status: JobStatus
  createdAt: string
  updatedAt: string
  paymentId: string | null
  txHash: string | null
  verified: boolean
  paidAmount: string
  currency: string
  network: string
  result?: SearchResponse
  error?: string
  webhookUrl?: string
  webhookSecret?: string
  idempotencyKey?: string
  attempts: number
  statusUrl: string
}

export interface SearchJobStatusResponse {
  job: SearchJob
  paymentVerified: boolean
  statusUrl: string
}

export interface WebhookDeliveryState {
  jobId: string
  url: string
  attempt: number
  nextRetryAt?: string
  lastError?: string
  deliveredAt?: string
  signature?: string
}

// ─── MCP resources & receipts (issue #326) ───────────────────────────────────

export interface StoredReceipt {
  id: string
  query: string
  txHash: string | null
  amount: string
  currency: string
  network: string
  timestamp: string
  latencyMs: number
  count: number
}

export interface CapabilityDoc {
  name: string
  version: string
  network: string
  pricePerQuery: string
  currency: string
  contract: string
  endpoints: Record<string, string>
  mcpTools: string[]
  mcpResources: string[]
  mcpPrompts: string[]
}

// ─── Saved research: notes & tags (issue #305) ───────────────────────────────
//
// A user-curated bookmark of a search result, kept alongside (not instead
// of) the ephemeral in-session `SearchResult` list. Persisted locally under
// `stellarsearch_saved_research`, mirroring the existing `SearchReceipt`
// localStorage pattern used by the Dashboard's audit log.

export interface SavedResearchItem {
  /** Stable id for this saved item — derived from the source result's id + query so re-saving the same result from the same query is idempotent. */
  id: string
  query: string
  title: string
  url: string
  description: string
  source: string
  savedAt: string
  notes: string
  tags: string[]
}
export type SearchMode = 'web' | 'images' | 'news'