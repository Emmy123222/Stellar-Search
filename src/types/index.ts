export type { WalletState, StellarTransaction } from '../hooks/useFreighterWallet'
export type { SearchSession, SearchResult } from '../hooks/useSearch'
import type { SearchResult } from '../hooks/useSearch'

/**
 * Common metadata included in search responses across endpoints.
 */
export interface BaseSearchResponse {
  query: string
  count: number
  network: string
  paidAmount: string
  currency: string
  txHash?: string | null
  latencyMs: number
}

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
export enum SerperErrorCode {
  AUTH_FAILURE = 'SERPER_AUTH_FAILURE',
  QUOTA_EXCEEDED = 'SERPER_QUOTA_EXCEEDED',
  RATE_LIMITED = 'SERPER_RATE_LIMITED',
  PROVIDER_ERROR = 'SERPER_PROVIDER_ERROR',
  NETWORK_ERROR = 'SERPER_NETWORK_ERROR',
}

export interface ApiErrorResponse {
  error: string
  providerCode?: SerperErrorCode
  credit?: CreditReceipt
}

// Alias for compatibility
export type ErrorResponse = ApiErrorResponse

// ─── Credit Receipt ───────────────────────────────────────────────────────
export interface CreditReceipt {
  id?: string
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

// ─── Search Receipt ───────────────────────────────────────────────────────
export interface SearchReceipt {
  txHash: string
  query: string
  amount: string
  timestamp: string
  network: string
  asset?: string
  destination?: string
}

// ─── Receipt Verification Types ───────────────────────────────────────────
export type ReceiptVerificationStatus = 'confirmed' | 'mismatched' | 'unverified'

export interface ReceiptVerificationDetail {
  status: ReceiptVerificationStatus
  ledgerSequence?: number
  verifiedAt?: string
  network?: string
  txHash?: string
  asset?: string
  amount?: string
  destination?: string
  mismatches?: string[]
  error?: string
}

// ─── Additional UI & Sitelink Types ───────────────────────────────────────
export interface Sitelink {
  title: string
  link?: string
  url?: string
}

export interface SavedResearchItem {
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

// x402 payment flow step numbers (1: Request -> 6: Result)
export type PaymentStep = 1 | 2 | 3 | 4 | 5 | 6

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

// ─── Collections ────────────────────────────────────────────────────────────

/** Current schema version. Bump when the shape of CollectionsStore changes. */
export const COLLECTIONS_SCHEMA_VERSION = 1 as const

/** Maximum total saved results across all collections per device. */
export const COLLECTIONS_QUOTA_MAX = 500 as const

/** Maximum number of named collections per device. */
export const COLLECTIONS_MAX_COUNT = 50 as const

/** localStorage key used by useCollections. */
export const COLLECTIONS_STORAGE_KEY = 'stellarsearch_collections' as const

/**
 * A single paid search result saved into a collection.
 * Extends SearchResult with the originating query and payment metadata
 * so provenance is always available offline.
 */
export interface SavedResult {
  /** Stable unique id (copied from SearchResult.id). */
  id: string
  /** Collection this result belongs to. */
  collectionId: string
  /** ISO-8601 timestamp of when the result was saved. */
  savedAt: string
  /** The search query that produced this result. */
  query: string
  /** x402 transaction hash of the paid search that produced this result. */
  txHash: string | null
  /** Stellar network the payment was settled on. */
  network: string
  /** Snapshot of the result at save time. */
  result: SearchResult
}

/** A named, ordered collection of saved results. */
export interface Collection {
  /** UUID v4. */
  id: string
  /** User-chosen display name (1-100 chars). */
  name: string
  /** ISO-8601 creation timestamp. */
  createdAt: string
  /** ISO-8601 last-modified timestamp. */
  updatedAt: string
  /** Ordered list of saved result ids belonging to this collection. */
  resultIds: string[]
}

/**
 * Root object stored under COLLECTIONS_STORAGE_KEY.
 * Version-tagged so future schema changes can migrate forward.
 */
export interface CollectionsStore {
  /** Schema version — must equal COLLECTIONS_SCHEMA_VERSION to be trusted as-is. */
  version: typeof COLLECTIONS_SCHEMA_VERSION
  /** Map from collection id to Collection metadata. */
  collections: Record<string, Collection>
  /** Map from saved-result id to SavedResult. */
  results: Record<string, SavedResult>
}
