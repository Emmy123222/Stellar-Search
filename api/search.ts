import type { VercelRequest, VercelResponse } from '@vercel/node'
import { 
  STELLAR_NETWORK, 
  USDC_CONTRACT, 
  AMOUNT_STROOPS,
  AMOUNT_USDC
} from '../src/lib/constants'
import { consumePaymentPayload } from '../src/lib/paymentIntegrity'

// ─── Config ───────────────────────────────────────────────────────────────
const RECEIVING_ADDRESS = process.env.STELLAR_RECEIVING_ADDRESS!
const NETWORK           = STELLAR_NETWORK as 'stellar:testnet' | 'stellar:mainnet'
const SERPER_API_KEY    = process.env.SERPER_API_KEY!

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
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' })

  const { q, count = '5', freshness } = req.query as Record<string, string>

  if (!q?.trim()) return res.status(400).json({ error: 'Missing required parameter: q' })

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
    return res.status(402).json({ error: 'Payment required' })
  }

  // ─── Payment Replay Protection ───────────────────────────────────────────
  const consumption = consumePaymentPayload(paymentHeader)
  if (!consumption.ok) {
    return res.status(402).json({ error: consumption.error })
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
      return res.status(502).json({ error: `Serper.dev API error: ${serperRes.status}` })
    }

    const data      = await serperRes.json() as any
    const latencyMs = Date.now() - t0

    const results = (data.organic || []).map((r: any, i: number) => ({
      id:             String(i + 1),
      title:          r.title   || 'No title',
      url:            r.link,
      description:    r.snippet || '',
      source:         (() => {
        try { return new URL(r.link).hostname.replace('www.', '') }
        catch { return r.link }
      })(),
      relevanceScore: Math.max(0.5, 1 - i * 0.06),
      publishedAt:    r.date || undefined,
    }))

    return res.json({
      query:      q.trim(),
      results,
      count:      results.length,
      network:    NETWORK,
      paidAmount: AMOUNT_USDC,
      currency:   'USDC',
      txHash,
      latencyMs,
    })

  } catch (err: any) {
    console.error('[search error]', err.message)
    return res.status(500).json({ error: 'Search failed.' })
  }
}