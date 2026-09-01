import type { VercelRequest, VercelResponse } from '@vercel/node'
import { 
  USDC_CONTRACT_MAINNET,
  USDC_CONTRACT_TESTNET,
} from '../src/lib/constants'
import { consumePaymentPayload } from '../src/lib/paymentIntegrity'
import { validateAndNormalizeUrl } from '../src/lib/urlSanitizer'

// ─── Config ───────────────────────────────────────────────────────────────
let config
try {
  config = readServerConfig()
} catch (error) {
  console.error(formatConfigurationError(error))
  throw error
}
const RECEIVING_ADDRESS = config.receivingAddress
const NETWORK           = config.stellarNetwork
const SERPER_API_KEY    = config.serperApiKey
const AMOUNT_STROOPS    = config.amountStroops
const AMOUNT_USDC       = config.amountUsdc
const USDC_CONTRACT     = NETWORK === 'stellar:mainnet' ? USDC_CONTRACT_MAINNET : USDC_CONTRACT_TESTNET

export default async function handler(req: VercelRequest, res: VercelResponse) {

  // ─── CORS ─────────────────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', [
    'Content-Type',
    'Authorization',
    'X-Payment',
    'payment-signature',
    'x-payment',
    'X-PAYMENT',
  ].join(', '))
  res.setHeader('Access-Control-Expose-Headers', [
    'PAYMENT-REQUIRED',
    'X-Payment-Response',
  ].join(', '))

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') {
    const errorBody: ApiErrorResponse = { error: 'Method not allowed' }
    return res.status(405).json(errorBody)
  }

  const { q, count = '5', freshness } = req.query as Record<string, string>

  if (!q?.trim()) {
    const errorBody: ApiErrorResponse = { error: 'Missing required parameter: q' }
    return res.status(400).json(errorBody)
  }

  // ─── Payment check ────────────────────────────────────────────────────────
  const paymentHeader =
    req.headers['payment-signature'] ||
    req.headers['x-payment']         ||
    req.headers['X-PAYMENT']

  if (!paymentHeader) {
    // Return x402 v2 payment requirements
    // The key fix: asset must be a Soroban C... contract address, NOT "USDC:ISSUER"
    const paymentRequired = {
      x402Version: 2,
      error:       'Payment required',
      resource: {
        url:         `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['host']}${req.url}`,
        description: 'StellarSearch: pay-per-query web search — 0.001 USDC on Stellar',
        mimeType:    'application/json',
      },
      accepts: [
        {
          scheme:            'exact',
          network:           NETWORK,            // "stellar:testnet"
          amount:            AMOUNT_STROOPS,     // "10000" (stroops, not dollars)
          asset:             USDC_CONTRACT,      // "CBIELTK6..." (Soroban contract)
          payTo:             RECEIVING_ADDRESS,  // your G... address
          maxTimeoutSeconds: 300,
          extra: { areFeesSponsored: true },
        },
      ],
    }

    res.setHeader(
      'PAYMENT-REQUIRED',
      Buffer.from(JSON.stringify(paymentRequired)).toString('base64')
    )
    const errorBody: ApiErrorResponse = { error: 'Payment required' }
    return res.status(402).json(errorBody)
  }

  // ─── Payment Replay Protection ───────────────────────────────────────────
  const consumption = consumePaymentPayload(paymentHeader)
  if (!consumption.ok) {
    const errorBody: ApiErrorResponse = { error: consumption.error }
    return res.status(402).json(errorBody)
  }

  // ─── Payment present — proceed with search ────────────────────────────────
  console.log('✅ Payment header received')

  let txHash: string | null = null
  try {
    const decoded = Buffer.from(paymentHeader as string, 'base64').toString('utf8')
    const parsed  = JSON.parse(decoded)
    txHash = parsed.transactionHash || parsed.txHash || null
  } catch {
    // payment header not base64 JSON — fine, tx hash just won't show
  }

  const t0 = Date.now()

  try {
    // ─── Serper.dev ──────────────────────────────────────────────────────────
    const requestBody: Record<string, unknown> = {
      q:   q.trim(),
      num: Math.min(parseInt(count) || 5, 20),
    }

    if (freshness) {
      const dateFilters: Record<string, string> = {
        pd: 'qdr:d',  // past day
        pw: 'qdr:w',  // past week
        pm: 'qdr:m',  // past month
      }
      if (dateFilters[freshness]) requestBody.tbs = dateFilters[freshness]
    }

    const serperRes = await fetch('https://google.serper.dev/search', {
      method:  'POST',
      headers: {
        'X-API-KEY':    SERPER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    if (!serperRes.ok) {
      const errText = await serperRes.text()
      console.error('[serper]', serperRes.status, errText)
      const errorBody: ApiErrorResponse = { error: `Serper.dev API error: ${serperRes.status}` }
      return res.status(502).json(errorBody)
    }

    const data      = await serperRes.json() as any
    const latencyMs = Date.now() - t0

    const results = (data.organic || []).map((r: any, i: number) => {
      const v = validateAndNormalizeUrl(r.link)
      return {
        id:             String(i + 1),
        title:          r.title   || 'No title',
        url:            v.isValid ? v.normalizedUrl! : (typeof r.link === 'string' ? r.link : ''),
        description:    r.snippet || '',
        source:         v.isValid ? v.source : (typeof r.link === 'string' ? r.link : 'blocked'),
        relevanceScore: Math.max(0.5, 1 - i * 0.06),
        publishedAt:    r.date || undefined,
        isBlocked:      !v.isValid,
        blockReason:    v.error,
      }
    })

    const safeCount = results.filter((r: any) => !r.isBlocked).length
    const blockedCount = results.length - safeCount
    const diagnostics = {
      total: results.length,
      safe: safeCount,
      blocked: blockedCount,
    }

    return res.json({
      query:      q.trim(),
      results,
      count:      results.length,
      diagnostics,
      network:    NETWORK,
      paidAmount: AMOUNT_USDC,
      currency:   'USDC',
      txHash,
      latencyMs,
    }

    return res.json(responseBody)

  } catch (err: any) {
    console.error('[search error]', err.message)
    const errorBody: ApiErrorResponse = { error: 'Search failed.' }
    return res.status(500).json(errorBody)
  }
}
