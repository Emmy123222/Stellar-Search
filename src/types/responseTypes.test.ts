import { describe, it, expect } from 'vitest'
import type {
  SearchResponse,
  ImageSearchResponse,
  NewsSearchResponse,
  SearchReceipt,
  ApiErrorResponse,
  WebSearchResponse,
  ImageResponse,
  NewsResponse,
  ErrorResponse,
  SearchResult,
  ImageResult,
  NewsResult,
} from './index'

describe('Standardized API Response Schemas (src/types/index.ts)', () => {
  it('validates SearchResponse contract shape and alias compatibility', () => {
    const mockResult: SearchResult = {
      id: '1',
      title: 'Stellar Documentation',
      url: 'https://developers.stellar.org',
      description: 'Official developer documentation for Stellar',
      source: 'developers.stellar.org',
      relevanceScore: 0.95,
      publishedAt: '2026-01-01',
    }

    const mockResponse: SearchResponse = {
      query: 'Stellar docs',
      originalQuery: 'Stelar docs',
      executedQuery: 'Stellar docs',
      suggestedQuery: 'Stellar docs',
      isCorrected: true,
      results: [mockResult],
      count: 1,
      network: 'stellar:testnet',
      paidAmount: '0.001',
      currency: 'USDC',
      txHash: 'abc123hash',
      latencyMs: 120,
      suggestions: ['Stellar SDK', 'Soroban smart contracts', 'Stellar CLI'],
    }

    // Verify alias equivalence
    const webResponse: WebSearchResponse = mockResponse

    expect(webResponse.query).toBe('Stellar docs')
    expect(webResponse.originalQuery).toBe('Stelar docs')
    expect(webResponse.executedQuery).toBe('Stellar docs')
    expect(webResponse.suggestedQuery).toBe('Stellar docs')
    expect(webResponse.isCorrected).toBe(true)
    expect(webResponse.results).toHaveLength(1)
    expect(webResponse.results[0].title).toBe('Stellar Documentation')
    expect(webResponse.paidAmount).toBe('0.001')
    expect(webResponse.currency).toBe('USDC')
    expect(webResponse.suggestions).toEqual(['Stellar SDK', 'Soroban smart contracts', 'Stellar CLI'])
  })

  it('validates ImageSearchResponse contract shape and alias compatibility', () => {
    const mockImage: ImageResult = {
      id: '1',
      title: 'Stellar Logo',
      imageUrl: 'https://example.com/logo.png',
      thumbnailUrl: 'https://example.com/thumb.png',
      sourceUrl: 'https://stellar.org',
      source: 'stellar.org',
      width: 800,
      height: 600,
    }

    const mockImageResponse: ImageSearchResponse = {
      query: 'Stellar logo',
      results: [mockImage],
      count: 1,
      network: 'stellar:testnet',
      paidAmount: '0.001',
      currency: 'USDC',
      txHash: 'def456hash',
      latencyMs: 95,
    }

    const aliasResponse: ImageResponse = mockImageResponse

    expect(aliasResponse.query).toBe('Stellar logo')
    expect(aliasResponse.results[0].imageUrl).toBe('https://example.com/logo.png')
    expect(aliasResponse.results[0].width).toBe(800)
    expect(aliasResponse.paidAmount).toBe('0.001')
  })

  it('validates NewsSearchResponse contract shape and alias compatibility', () => {
    const mockNews: NewsResult = {
      id: '1',
      title: 'Stellar Ecosystem Upgrade',
      url: 'https://news.stellar.org/upgrade',
      snippet: 'Stellar announces major protocol upgrade for 2026',
      source: 'news.stellar.org',
      publishedAt: '2026-03-30',
      imageUrl: 'https://news.stellar.org/img.jpg',
    }

    const mockNewsResponse: NewsSearchResponse = {
      query: 'Stellar news',
      results: [mockNews],
      count: 1,
      network: 'stellar:testnet',
      paidAmount: '0.001',
      currency: 'USDC',
      txHash: 'ghi789hash',
      latencyMs: 140,
    }

    const aliasResponse: NewsResponse = mockNewsResponse

    expect(aliasResponse.query).toBe('Stellar news')
    expect(aliasResponse.results[0].snippet).toContain('major protocol upgrade')
    expect(aliasResponse.results[0].publishedAt).toBe('2026-03-30')
  })

  it('validates SearchReceipt contract shape', () => {
    const mockReceipt: SearchReceipt = {
      txHash: 'tx_999_hash',
      query: 'Soroban smart contracts',
      amount: '0.001',
      timestamp: '2026-03-30T12:00:00.000Z',
      network: 'stellar:testnet',
    }

    expect(mockReceipt.txHash).toBe('tx_999_hash')
    expect(mockReceipt.amount).toBe('0.001')
    expect(mockReceipt.network).toBe('stellar:testnet')
  })

  it('validates ApiErrorResponse contract shape and alias compatibility', () => {
    const errorRes: ApiErrorResponse = {
      error: 'Payment required',
    }

    const errorAlias: ErrorResponse = errorRes

    expect(errorAlias.error).toBe('Payment required')
  })
})
