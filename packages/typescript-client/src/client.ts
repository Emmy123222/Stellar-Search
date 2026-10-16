import type {
  SearchOptions,
  SearchResponse,
  ImageSearchOptions,
  ImageSearchResponse,
  NewsSearchOptions,
  NewsSearchResponse,
  ServerHealthResponse,
  X402DiscoveryMetadata,
  PaymentChallenge,
  SearchReceipt,
  ReceiptVerificationDetail,
  VerifyOptions,
  StellarSearchClientOptions,
  ClientSigner,
  BaseSearchOptions,
} from './types'
import {
  StellarSearchError,
  ValidationError,
  PaymentRequiredError,
  PaymentApprovalRejectedError,
  PaymentFailedError,
} from './errors'
import { parsePaymentChallenge, extractSettlementResponse } from './x402'
import { verifyReceiptAgainstHorizon, verifyReceiptsAgainstHorizon } from './verification'

export class StellarSearchClient {
  public readonly baseUrl: string
  public readonly network: string
  public readonly signer?: ClientSigner
  public readonly horizonUrl?: string
  private readonly fetchFn: typeof fetch
  private readonly onPaymentRequired?: (challenge: PaymentChallenge) => boolean | Promise<boolean>
  private readonly defaultTimeoutMs: number
  private readonly defaultHeaders: Record<string, string>

  constructor(options: StellarSearchClientOptions = {}) {
    let base = options.baseUrl || 'http://localhost:3001'
    if (base.endsWith('/')) {
      base = base.slice(0, -1)
    }
    this.baseUrl = base
    this.network = options.network || 'stellar:testnet'
    this.signer = options.signer
    this.horizonUrl = options.horizonUrl
    this.fetchFn =
      options.fetchFn ||
      (typeof window !== 'undefined' ? window.fetch.bind(window) : globalThis.fetch)
    this.onPaymentRequired = options.onPaymentRequired
    this.defaultTimeoutMs = options.timeoutMs ?? 30000
    this.defaultHeaders = options.headers ?? {}
  }

  /**
   * Helper to normalize route path whether baseUrl targets Express or Vercel.
   */
  private resolveUrl(path: string): string {
    const cleanPath = path.startsWith('/') ? path : `/${path}`
    if (this.baseUrl.endsWith('/api') && cleanPath.startsWith('/api/')) {
      return `${this.baseUrl}${cleanPath.slice(4)}`
    }
    return `${this.baseUrl}${cleanPath}`
  }

  private validateSearchQuery(query: string): string {
    if (typeof query !== 'string' || !query.trim()) {
      throw new ValidationError('Search query cannot be empty')
    }
    const clean = query.trim()
    if (clean.length > 256) {
      throw new ValidationError(`Search query exceeds maximum length of 256 characters (got ${clean.length})`)
    }
    return clean
  }

  private createTimeoutSignal(timeoutMs: number, userSignal?: AbortSignal): AbortSignal {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort(new Error(`Request timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    if (userSignal) {
      userSignal.addEventListener('abort', () => {
        clearTimeout(timer)
        controller.abort(userSignal.reason)
      })
    }

    controller.signal.addEventListener('abort', () => clearTimeout(timer))
    return controller.signal
  }

  private async executeRequest<T>(
    endpointPath: string,
    params: URLSearchParams,
    options: BaseSearchOptions = {}
  ): Promise<T> {
    const fullUrl = `${this.resolveUrl(endpointPath)}?${params.toString()}`
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs
    const signal = this.createTimeoutSignal(timeoutMs, options.signal)

    const requestHeaders: Record<string, string> = {
      Accept: 'application/json',
      ...this.defaultHeaders,
      ...(options.headers || {}),
    }

    if (options.paymentHeader) {
      requestHeaders['PAYMENT-SIGNATURE'] = options.paymentHeader
      requestHeaders['x-payment'] = options.paymentHeader
    }

    // Step 1: Send initial request
    let res: Response
    try {
      res = await this.fetchFn(fullUrl, {
        method: 'GET',
        headers: requestHeaders,
        signal,
      })
    } catch (err: any) {
      throw new StellarSearchError(`Network request failed: ${err?.message || String(err)}`, {
        cause: err,
      })
    }

    // Step 2: Handle non-402 responses
    if (res.status === 200) {
      const data: any = await res.json()
      const settlement = extractSettlementResponse(res.headers)
      if (settlement.txHash && !data.txHash) {
        data.txHash = settlement.txHash
      }
      return data as T
    }

    if (res.status !== 402) {
      const errorBody: any = await res.json().catch(() => ({}))
      const message = errorBody?.error || `Request failed with status ${res.status} ${res.statusText}`
      if (res.status === 400) {
        throw new ValidationError(message)
      }
      throw new StellarSearchError(message, { statusCode: res.status, details: errorBody })
    }

    // Step 3: Parse 402 Payment Challenge
    let body: any
    try {
      body = await res.json()
    } catch {
      body = null
    }

    const challenge = parsePaymentChallenge(res.headers, body)
    if (!challenge || challenge.accepts.length === 0) {
      throw new PaymentRequiredError(
        'Server returned 402 Payment Required but no valid x402 challenge was found',
        challenge || { accepts: [] }
      )
    }

    // Step 4: Check explicit user approval hook if provided
    if (this.onPaymentRequired) {
      const approved = await this.onPaymentRequired(challenge)
      if (!approved) {
        throw new PaymentApprovalRejectedError(
          'Payment approval rejected by onPaymentRequired hook',
          challenge
        )
      }
    }

    // Step 5: Check signer availability
    const signer = options.signer || this.signer
    if (!signer) {
      throw new PaymentRequiredError(
        `Payment required (${challenge.accepts[0].amount} stroops / ${challenge.accepts[0].asset || 'USDC'}). Provide a signer to settle automatically.`,
        challenge
      )
    }

    // Step 6: Generate signed payment credentials
    let signed: { headerName: string; headerValue: string; secondaryHeaders?: Record<string, string> }
    try {
      signed = await signer.sign(challenge, {
        url: fullUrl,
        method: 'GET',
        network: challenge.accepts[0]?.network || this.network,
        challenge,
      })
    } catch (err: any) {
      if (err instanceof StellarSearchError) throw err
      throw new StellarSearchError(`Signer failed to sign payment challenge: ${err?.message || String(err)}`, {
        statusCode: 402,
        cause: err,
      })
    }

    // Step 7: Retry request with payment headers
    const retryHeaders: Record<string, string> = {
      ...requestHeaders,
      [signed.headerName]: signed.headerValue,
      ...(signed.secondaryHeaders || {}),
    }

    let retryRes: Response
    try {
      retryRes = await this.fetchFn(fullUrl, {
        method: 'GET',
        headers: retryHeaders,
        signal,
      })
    } catch (err: any) {
      throw new StellarSearchError(`Payment retry request failed: ${err?.message || String(err)}`, {
        cause: err,
      })
    }

    if (!retryRes.ok) {
      const retryBody: any = await retryRes.json().catch(() => ({}))
      const errMsg = retryBody?.error || `Payment retry rejected (${retryRes.status} ${retryRes.statusText})`
      throw new PaymentFailedError(errMsg, {
        statusCode: retryRes.status,
        serverError: retryBody?.error,
        details: retryBody,
      })
    }

    const resultData: any = await retryRes.json()
    const retrySettlement = extractSettlementResponse(retryRes.headers)
    if (retrySettlement.txHash && !resultData.txHash) {
      resultData.txHash = retrySettlement.txHash
    }

    return resultData as T
  }

  /**
   * Performs a paid web search query. Automatically handles 402 payment flow.
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const cleanQ = this.validateSearchQuery(query)
    const count = Math.min(Math.max(options.count ?? 5, 1), 20)

    const params = new URLSearchParams({
      q: cleanQ,
      count: String(count),
    })

    if (options.freshness) {
      params.set('freshness', options.freshness)
    }
    if (options.includeDomains && options.includeDomains.length > 0) {
      params.set('includeDomains', options.includeDomains.join(','))
    }
    if (options.excludeDomains && options.excludeDomains.length > 0) {
      params.set('excludeDomains', options.excludeDomains.join(','))
    }
    if (options.suggestions) {
      params.set('suggestions', '1')
    }

    return this.executeRequest<SearchResponse>('/search', params, options)
  }

  /**
   * Performs a paid image search query. Automatically handles 402 payment flow.
   */
  async searchImages(query: string, options: ImageSearchOptions = {}): Promise<ImageSearchResponse> {
    const cleanQ = this.validateSearchQuery(query)
    const count = Math.min(Math.max(options.count ?? 10, 1), 10)

    const params = new URLSearchParams({
      q: cleanQ,
      count: String(count),
    })

    return this.executeRequest<ImageSearchResponse>('/images', params, options)
  }

  /**
   * Performs a paid news search query. Automatically handles 402 payment flow.
   */
  async searchNews(query: string, options: NewsSearchOptions = {}): Promise<NewsSearchResponse> {
    const cleanQ = this.validateSearchQuery(query)
    const count = Math.min(Math.max(options.count ?? 10, 1), 20)

    const params = new URLSearchParams({
      q: cleanQ,
      count: String(count),
    })

    if (options.freshness) {
      params.set('freshness', options.freshness)
    }

    return this.executeRequest<NewsSearchResponse>('/news', params, options)
  }

  /**
   * Requests a price and payment challenge quote without settling payment.
   */
  async quote(
    endpoint: 'search' | 'images' | 'news',
    query: string,
    options: BaseSearchOptions = {}
  ): Promise<PaymentChallenge> {
    const cleanQ = this.validateSearchQuery(query)
    const params = new URLSearchParams({
      q: cleanQ,
      count: String(options.count ?? 5),
    })

    const fullUrl = `${this.resolveUrl(`/${endpoint}`)}?${params.toString()}`
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs
    const signal = this.createTimeoutSignal(timeoutMs, options.signal)

    const res = await this.fetchFn(fullUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...this.defaultHeaders,
        ...(options.headers || {}),
      },
      signal,
    })

    if (res.status === 402) {
      const body = await res.json().catch(() => ({}))
      const challenge = parsePaymentChallenge(res.headers, body)
      if (challenge) return challenge
      return {
        x402Version: 2,
        error: 'Payment required',
        accepts: [],
      }
    }

    if (res.ok) {
      return {
        x402Version: 2,
        error: 'No payment required',
        accepts: [],
      }
    }

    const err = await res.json().catch(() => ({}))
    throw new StellarSearchError(err?.error || `Quote request failed with status ${res.status}`, {
      statusCode: res.status,
      details: err,
    })
  }

  /**
   * Checks the health and readiness of the StellarSearch server.
   */
  async health(options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<ServerHealthResponse> {
    const fullUrl = this.resolveUrl('/health')
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs
    const signal = this.createTimeoutSignal(timeoutMs, options.signal)

    const res = await this.fetchFn(fullUrl, {
      method: 'GET',
      headers: { Accept: 'application/json', ...this.defaultHeaders },
      signal,
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new StellarSearchError(`Health check failed (${res.status} ${res.statusText})`, {
        statusCode: res.status,
        details: err,
      })
    }

    return (await res.json()) as ServerHealthResponse
  }

  /**
   * Fetches x402 resource and price discovery metadata from /.well-known/x402.
   */
  async discovery(options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<X402DiscoveryMetadata> {
    const fullUrl = this.resolveUrl('/.well-known/x402')
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs
    const signal = this.createTimeoutSignal(timeoutMs, options.signal)

    const res = await this.fetchFn(fullUrl, {
      method: 'GET',
      headers: { Accept: 'application/json', ...this.defaultHeaders },
      signal,
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new StellarSearchError(`Discovery failed (${res.status} ${res.statusText})`, {
        statusCode: res.status,
        details: err,
      })
    }

    return (await res.json()) as X402DiscoveryMetadata
  }

  /**
   * Verifies an on-chain search receipt against Stellar Horizon.
   */
  async verifyReceipt(
    receipt: SearchReceipt,
    options: VerifyOptions = {}
  ): Promise<ReceiptVerificationDetail> {
    return verifyReceiptAgainstHorizon(receipt, {
      horizonUrl: this.horizonUrl,
      expectedNetwork: this.network,
      fetchFn: this.fetchFn,
      ...options,
    })
  }

  /**
   * Batch-verifies multiple on-chain search receipts against Stellar Horizon.
   */
  async verifyReceipts(
    receipts: SearchReceipt[],
    options: VerifyOptions = {}
  ): Promise<Map<string, ReceiptVerificationDetail>> {
    return verifyReceiptsAgainstHorizon(receipts, {
      horizonUrl: this.horizonUrl,
      expectedNetwork: this.network,
      fetchFn: this.fetchFn,
      ...options,
    })
  }
}
