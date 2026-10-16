/**
 * @stellar-search/client — Core Types
 */

// ─── Answer Box & Knowledge Graph ─────────────────────────────────────────

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

// ─── Result Items ──────────────────────────────────────────────────────────

export interface SearchResult {
  id: string
  title: string
  url: string
  description: string
  source: string
  relevanceScore: number
  publishedAt?: string
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

// ─── Responses ─────────────────────────────────────────────────────────────

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
  filters?: {
    includeDomains?: string[]
    excludeDomains?: string[]
  }
}

export type WebSearchResponse = SearchResponse

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

export type ImageResponse = ImageSearchResponse

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

export type NewsResponse = NewsSearchResponse

export interface ApiErrorResponse {
  error: string
  providerCode?: string
  credit?: {
    id: string
    creditId?: string
    amount: string
    reason: string
  }
}

export type ErrorResponse = ApiErrorResponse

// ─── Receipts & On-Chain Verification ──────────────────────────────────────

export interface SearchReceipt {
  txHash: string
  query: string
  amount: string
  timestamp: string
  network: string
  asset?: string
  destination?: string
}

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

export interface VerifyOptions {
  horizonUrl?: string
  expectedNetwork?: string
  expectedDestination?: string
  expectedAsset?: string
  expectedAmount?: string | number
  fetchFn?: typeof fetch
}

// ─── Discovery & Health ───────────────────────────────────────────────────

export interface X402PaymentOption {
  scheme: 'exact'
  network: string
  asset: string
  amount: string
  price: string
  currency: 'USDC'
  payTo: string | null
}

export interface X402ResourceTemplate {
  id: string
  resource: string
  method: 'GET'
  description: string
  accepts: X402PaymentOption[]
}

export interface X402DiscoveryMetadata {
  version: 1
  protocol: 'x402'
  resourceTemplates: X402ResourceTemplate[]
  networks: string[]
  assets: string[]
  schemes: string[]
  priceDiscoveryUrl: string
}

export interface ServerHealthResponse {
  status: 'ok' | 'degraded' | 'unhealthy' | string
  network: string
  pricePerQuery: string
  protocol: string
  facilitator?: string
  totalQueries?: number
  totalUsdcSettled?: string
  avgLatencyMs?: number
  uptime?: string
  checks?: Record<string, { status: string; latencyMs?: number; error?: string }>
  readiness?: {
    cached: boolean
    cacheAgeMs: number
    timestamp: string
  }
  serperApiConfigured?: boolean
  groqApiConfigured?: boolean
  receivingAddressConfigured?: boolean
}

// ─── x402 Protocol Types ───────────────────────────────────────────────────

export interface PaymentAcceptOption {
  scheme: string
  network: string
  amount: string
  asset: string
  payTo: string
  maxTimeoutSeconds?: number
  extra?: Record<string, unknown>
}

export interface PaymentChallenge {
  x402Version?: number | string
  error?: string
  resource?: {
    url?: string
    description?: string
    mimeType?: string
  }
  accepts: PaymentAcceptOption[]
  rawHeader?: string
}

export interface SignedPaymentHeader {
  headerName: string
  headerValue: string
  secondaryHeaders?: Record<string, string>
}

export interface SignerContext {
  url: string
  method: string
  network: string
  challenge: PaymentChallenge
}

export interface ClientSigner {
  sign(challenge: PaymentChallenge, context: SignerContext): Promise<SignedPaymentHeader>
  getAddress?(): Promise<string>
}

// ─── SDK Options & Request Parameters ──────────────────────────────────────

export type Freshness = 'pd' | 'pw' | 'pm'

export interface BaseSearchOptions {
  count?: number
  timeoutMs?: number
  signal?: AbortSignal
  headers?: Record<string, string>
  paymentHeader?: string
  signer?: ClientSigner
}

export interface SearchOptions extends BaseSearchOptions {
  freshness?: Freshness
  includeDomains?: string[]
  excludeDomains?: string[]
  suggestions?: boolean
}

export interface ImageSearchOptions extends BaseSearchOptions {}

export interface NewsSearchOptions extends BaseSearchOptions {
  freshness?: Freshness
}

export interface StellarSearchClientOptions {
  baseUrl?: string
  signer?: ClientSigner
  network?: string
  horizonUrl?: string
  fetchFn?: typeof fetch
  onPaymentRequired?: (challenge: PaymentChallenge) => boolean | Promise<boolean>
  timeoutMs?: number
  headers?: Record<string, string>
}
