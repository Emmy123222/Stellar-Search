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

export interface ApiErrorResponse {
  error: string
}

// Aliases for response types
export type WebSearchResponse = SearchResponse
export type ImageResponse = ImageSearchResponse
export type NewsResponse = NewsSearchResponse
export type ErrorResponse = ApiErrorResponse

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
