export type { WalletState, StellarTransaction } from '../hooks/useFreighterWallet'
export type { SearchResult, SearchSession, SearchReceipt } from '../hooks/useSearch'

// The canonical `SearchResult` shape lives with the search hook (it is part of
// the session contract). Import it locally as well so the response types below
// can reference it — a pure `export type { X } from '...'` re-export does not
// bind `X` in this module's own scope.
import type { SearchResult } from '../hooks/useSearch'

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

// ─── Sitelinks ─────────────────────────────────────────────────────────────
/** Additional links Serper returns beneath an organic result. */
export interface Sitelink {
  title: string
  url: string
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
/**
 * JSON-safe projection of an internal `SearchCredit` (see src/lib/creditLedger.ts)
 * returned to a payer when a settled search fails upstream.
 */
export interface CreditReceipt {
  creditId: string
  /** The settled payment identifier this credit is linked to. */
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

// NOTE: `SearchReceipt` is defined by `src/hooks/useSearch.ts` and re-exported
// at the top of this file — it is deliberately not redeclared here, which would
// create a duplicate-export conflict for consumers of the barrel module.

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
// Shape shared by the Express `/jobs` route and the Vercel `/api/jobs`
// functions. Webhook + payment metadata are part of the persisted job so the
// status endpoint can report what was settled and where the result was sent.
export interface SearchJob {
  id: string
  query: string
  statusUrl: string
  status: JobStatus
  createdAt: string
  updatedAt?: string
  completedAt?: string
  /** Validated result count (1..20) used for the upstream search. */
  count?: number
  /** Validated `pd` | `pw` | `pm` freshness filter, if requested. */
  freshness?: string
  paymentId?: string
  txHash?: string | null
  /** True once the x402 payment for this job was verified. */
  verified?: boolean
  paidAmount?: string
  currency?: string
  network?: string
  idempotencyKey?: string
  attempts?: number
  webhookUrl?: string
  webhookSecret?: string
  results?: SearchResult[]
  /** Full search response once the job finishes successfully. */
  result?: SearchResponse
  error?: string
}

export type JobStatus = 'queued' | 'running' | 'processing' | 'completed' | 'failed'
