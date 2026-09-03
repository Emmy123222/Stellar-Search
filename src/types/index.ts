export type { WalletState, StellarTransaction } from '../hooks/useFreighterWallet'
export type { SearchResult, SearchSession, SearchReceipt } from '../hooks/useSearch'

// ─── Answer Box ────────────────────────────────────────────────────────────
/** Direct factual answer to a query (e.g., "what is X") */
export interface AnswerBoxSource {
  title: string
  link: string
  displayLink?: string
}

export interface AnswerBox {
  title: string
  answer: string
  source: AnswerBoxSource
}

// ─── Knowledge Graph ───────────────────────────────────────────────────────
/** Structured data about entities (people, places, things) */
export interface KnowledgeGraphAttribute {
  name: string
  value: string
}

export interface KnowledgeGraphLink {
  title: string
  link: string
}

export interface KnowledgeGraph {
  title: string
  type?: string
  description?: string
  attributes?: KnowledgeGraphAttribute[]
  imageUrl?: string
  website?: string
  links?: KnowledgeGraphLink[]
}

// ─── Search Response ───────────────────────────────────────────────────────
export interface SearchResponse {
  query: string
  originalQuery?: string
  executedQuery?: string
  suggestedQuery?: string
  isCorrected?: boolean
  results: SearchResult[]
  count: number
  answerBox?: AnswerBox
  knowledgeGraph?: KnowledgeGraph
  network: string
  paidAmount: string
  currency: string
  txHash?: string | null
  latencyMs: number
  suggestions?: string[]
}

// Alias for compatibility
export type WebSearchResponse = SearchResponse

// ─── Image Search Response ─────────────────────────────────────────────────
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

export interface ImageSearchResponse {
  query: string
  results: ImageResult[]
  count: number
  network: string
  paidAmount: string
  currency: string
  txHash?: string | null
  latencyMs: number
}

// Alias for compatibility
export type ImageResponse = ImageSearchResponse

// ─── News Search Response ──────────────────────────────────────────────────
export interface NewsResult {
  id: string
  title: string
  url: string
  snippet: string
  source: string
  publishedAt?: string
  imageUrl?: string
}

export interface NewsSearchResponse {
  query: string
  results: NewsResult[]
  count: number
  network: string
  paidAmount: string
  currency: string
  txHash?: string | null
  latencyMs: number
}

// Alias for compatibility
export type NewsResponse = NewsSearchResponse

// ─── API Error Response ────────────────────────────────────────────────────
export interface ApiErrorResponse {
  error: string
  credit?: CreditReceipt
}

// Alias for compatibility
export type ErrorResponse = ApiErrorResponse

// ─── Credit Receipt ───────────────────────────────────────────────────────
export interface CreditReceipt {
  id: string
  amount: string
  reason: string
}

// ─── Search Receipt ───────────────────────────────────────────────────────
export interface SearchReceipt {
  txHash: string
  query: string
  amount: string
  timestamp: string
  network: string
}

// ─── API Stats ─────────────────────────────────────────────────────────────
export interface ApiStat {
  totalQueries: number
  totalUsdcSettled: string
  avgLatencyMs: number
  uptime: string
}

// ─── Batch JSONL Event Types ───────────────────────────────────────────────
export interface BatchJsonlEvent {
  v: 1
  type: string
  requestId: string
}

export interface BatchJsonlQuoteEvent extends BatchJsonlEvent {
  type: 'quote'
  query: string
  totalQueries: number
  totalAmount: string
  currency: string
  network: string
}

export interface BatchJsonlSettlementEvent extends BatchJsonlEvent {
  type: 'settlement'
  paymentId: string
  txHash: string | null
  verified: boolean
  settledAt: string
}

export interface BatchJsonlResultEvent extends BatchJsonlEvent {
  type: 'result'
  index: number
  query: string
  originalQuery?: string
  executedQuery?: string
  suggestedQuery?: string
  isCorrected?: boolean
  results: SearchResult[]
  count: number
  answerBox?: AnswerBox
  knowledgeGraph?: KnowledgeGraph
  latencyMs: number
  paidAmount: string
  currency: string
  network: string
  txHash?: string | null
}

export interface BatchJsonlErrorEvent extends BatchJsonlEvent {
  type: 'error'
  index?: number
  query?: string
  error: string
  code: string
}

export interface BatchJsonlDoneEvent extends BatchJsonlEvent {
  type: 'done'
  succeeded: number
  failed: number
  totalUsdcSpent: string
  aggregateLatencyMs: number
  completedAt: string
}

// ─── Job Types ─────────────────────────────────────────────────────────────
export interface SearchJob {
  id: string
  query: string
  statusUrl: string
  status: JobStatus
  createdAt: string
  completedAt?: string
  paymentId?: string
  txHash?: string | null
  results?: SearchResult[]
  error?: string
}

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed'
