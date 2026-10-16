/**
 * Structured content schemas and TypeScript interfaces for StellarSearch MCP tools.
 * Exposes typed structures for web_search, image_search, news_search, check_balance,
 * and get_search_stats tools alongside human-readable Markdown text blocks.
 */

import type { SearchResult, ImageResult, NewsResult } from '../src/types/index.js'

export interface PaymentMetadata {
  paidAmount: string
  currency: string
  network: string
  txHash: string | null
}

export interface WebSearchStructuredContent {
  query: string
  count: number
  results: SearchResult[]
  payment: PaymentMetadata
  paidAmount: string
  currency: string
  network: string
  txHash: string | null
  latencyMs: number
  suggestions: string[]
}

export interface ImageSearchStructuredContent {
  query: string
  count: number
  results: ImageResult[]
  payment: PaymentMetadata
  paidAmount: string
  currency: string
  network: string
  txHash: string | null
  latencyMs: number
}

export interface NewsSearchStructuredContent {
  query: string
  count: number
  results: NewsResult[]
  payment: PaymentMetadata
  paidAmount: string
  currency: string
  network: string
  txHash: string | null
  latencyMs: number
}

export interface BalanceStructuredContent {
  address: string
  usdcBalance: string
  xlmBalance: string
  searchesRemaining: number
  network: string
  issuer: string
  explorerUrl: string
  timestamp: string
}

export interface SearchStatsStructuredContent {
  status: string
  network: string
  pricePerQuery: string
  protocol: string
  facilitator: string
  totalQueries: number
  totalUsdcSettled: string
  avgLatencyMs: number
  uptime: string
  serperApiConfigured: boolean
  groqApiConfigured: boolean
  receivingAddressConfigured?: boolean
}

// ─── JSON Schemas for Tool outputSchema ─────────────────────────────────────

export const webSearchOutputSchema = {
  type: 'object' as const,
  properties: {
    query: { type: 'string', description: 'Search query executed' },
    count: { type: 'number', description: 'Total number of organic results returned' },
    results: {
      type: 'array',
      description: 'Structured array of web search results',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          url: { type: 'string' },
          description: { type: 'string' },
          source: { type: 'string' },
          relevanceScore: { type: 'number' },
          publishedAt: { type: 'string' },
        },
        required: ['title', 'url', 'description'],
      },
    },
    payment: {
      type: 'object',
      description: 'x402 payment and Stellar settlement metadata',
      properties: {
        paidAmount: { type: 'string', description: 'Amount paid in USDC' },
        currency: { type: 'string', description: 'Settlement currency (USDC)' },
        network: { type: 'string', description: 'Stellar network used for payment' },
        txHash: { type: ['string', 'null'], description: 'On-chain Stellar transaction hash' },
      },
      required: ['paidAmount', 'currency', 'network'],
    },
    paidAmount: { type: 'string', description: 'Amount paid in USDC' },
    currency: { type: 'string', description: 'Settlement currency' },
    network: { type: 'string', description: 'Stellar network identifier' },
    txHash: { type: ['string', 'null'], description: 'Stellar transaction hash' },
    latencyMs: { type: 'number', description: 'Execution and upstream latency in milliseconds' },
    suggestions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Related follow-up search queries',
    },
  },
  required: ['query', 'count', 'results', 'payment', 'paidAmount', 'currency', 'network', 'latencyMs'],
}

export const imageSearchOutputSchema = {
  type: 'object' as const,
  properties: {
    query: { type: 'string', description: 'Image search query executed' },
    count: { type: 'number', description: 'Total number of image results returned' },
    results: {
      type: 'array',
      description: 'Structured array of image results',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          imageUrl: { type: 'string' },
          thumbnailUrl: { type: 'string' },
          sourceUrl: { type: 'string' },
          source: { type: 'string' },
          width: { type: 'number' },
          height: { type: 'number' },
        },
        required: ['title', 'imageUrl', 'sourceUrl'],
      },
    },
    payment: {
      type: 'object',
      description: 'x402 payment and Stellar settlement metadata',
      properties: {
        paidAmount: { type: 'string', description: 'Amount paid in USDC' },
        currency: { type: 'string', description: 'Settlement currency (USDC)' },
        network: { type: 'string', description: 'Stellar network used for payment' },
        txHash: { type: ['string', 'null'], description: 'On-chain Stellar transaction hash' },
      },
      required: ['paidAmount', 'currency', 'network'],
    },
    paidAmount: { type: 'string', description: 'Amount paid in USDC' },
    currency: { type: 'string', description: 'Settlement currency' },
    network: { type: 'string', description: 'Stellar network identifier' },
    txHash: { type: ['string', 'null'], description: 'Stellar transaction hash' },
    latencyMs: { type: 'number', description: 'Execution latency in milliseconds' },
  },
  required: ['query', 'count', 'results', 'payment', 'paidAmount', 'currency', 'network', 'latencyMs'],
}

export const newsSearchOutputSchema = {
  type: 'object' as const,
  properties: {
    query: { type: 'string', description: 'News search query executed' },
    count: { type: 'number', description: 'Total number of news articles returned' },
    results: {
      type: 'array',
      description: 'Structured array of news articles',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          url: { type: 'string' },
          snippet: { type: 'string' },
          source: { type: 'string' },
          publishedAt: { type: 'string' },
          imageUrl: { type: 'string' },
        },
        required: ['title', 'url', 'snippet', 'source'],
      },
    },
    payment: {
      type: 'object',
      description: 'x402 payment and Stellar settlement metadata',
      properties: {
        paidAmount: { type: 'string', description: 'Amount paid in USDC' },
        currency: { type: 'string', description: 'Settlement currency (USDC)' },
        network: { type: 'string', description: 'Stellar network used for payment' },
        txHash: { type: ['string', 'null'], description: 'On-chain Stellar transaction hash' },
      },
      required: ['paidAmount', 'currency', 'network'],
    },
    paidAmount: { type: 'string', description: 'Amount paid in USDC' },
    currency: { type: 'string', description: 'Settlement currency' },
    network: { type: 'string', description: 'Stellar network identifier' },
    txHash: { type: ['string', 'null'], description: 'Stellar transaction hash' },
    latencyMs: { type: 'number', description: 'Execution latency in milliseconds' },
  },
  required: ['query', 'count', 'results', 'payment', 'paidAmount', 'currency', 'network', 'latencyMs'],
}

export const checkBalanceOutputSchema = {
  type: 'object' as const,
  properties: {
    address: { type: 'string', description: 'Stellar public key checked' },
    usdcBalance: { type: 'string', description: 'Live USDC balance from Horizon' },
    xlmBalance: { type: 'string', description: 'Live XLM balance from Horizon' },
    searchesRemaining: { type: 'number', description: 'Estimated remaining searches given USDC balance' },
    network: { type: 'string', description: 'Stellar network name' },
    issuer: { type: 'string', description: 'USDC asset issuer address' },
    explorerUrl: { type: 'string', description: 'StellarExpert account URL' },
    timestamp: { type: 'string', description: 'ISO 8601 timestamp of balance query' },
  },
  required: ['address', 'usdcBalance', 'xlmBalance', 'searchesRemaining', 'network', 'issuer', 'explorerUrl', 'timestamp'],
}

export const getSearchStatsOutputSchema = {
  type: 'object' as const,
  properties: {
    status: { type: 'string', description: 'Server operational status' },
    network: { type: 'string', description: 'Configured Stellar network' },
    pricePerQuery: { type: 'string', description: 'Standard query price in USDC' },
    protocol: { type: 'string', description: 'Payment protocol identifier (x402)' },
    facilitator: { type: 'string', description: 'x402 facilitator endpoint' },
    totalQueries: { type: 'number', description: 'Total queries served since start' },
    totalUsdcSettled: { type: 'string', description: 'Total USDC settled on-chain' },
    avgLatencyMs: { type: 'number', description: 'Average query latency in milliseconds' },
    uptime: { type: 'string', description: 'Server uptime duration string' },
    serperApiConfigured: { type: 'boolean', description: 'Serper API availability flag' },
    groqApiConfigured: { type: 'boolean', description: 'Groq API availability flag' },
    receivingAddressConfigured: { type: 'boolean', description: 'Receiving address configuration flag' },
  },
  required: ['status', 'network', 'pricePerQuery', 'protocol', 'facilitator', 'totalQueries', 'totalUsdcSettled', 'avgLatencyMs', 'uptime', 'serperApiConfigured', 'groqApiConfigured'],
}
