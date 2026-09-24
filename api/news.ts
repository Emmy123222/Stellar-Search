import type { VercelRequest, VercelResponse } from '@vercel/node'
import { 
  STELLAR_NETWORK, 
  USDC_CONTRACT, 
  AMOUNT_STROOPS,
  AMOUNT_USDC
} from '../src/lib/constants'
import { consumePaymentPayload } from '../src/lib/paymentIntegrity'
import { validateQuery } from '../src/lib/queryValidator'
import {
  validateCount,
  validateFreshness,
  NEWS_COUNT,
  FRESHNESS_TBS,
} from '../src/lib/paramValidation'

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

  const { q, count, freshness } = req.query as Record<string, unknown>

  // Parameter validation (#98) runs BEFORE the 402 challenge and the replay
  // check: a request the server would refuse anyway is never handed a payment
  // challenge, is never charged, and never reaches Serper.
  const queryValidation = validateQuery(q)
  if (!queryValidation.ok) return res.status(400).json({ error: queryValidation.error })
  const cleanQ = queryValidation.cleanQ

  const countValidation = validateCount(count, NEWS_COUNT)
  if (!countValidation.ok) return res.status(400).json({ error: countValidation.error })
  const freshnessValidation = validateFreshness(freshness)
  if (!freshnessValidation.ok) return res.status(400).json({ error: freshnessValidation.error })

  // ─── Payment check ────────────────────────────────────────────────────────
  const paymentHeader =
    req.headers['payment-signature'] ||
    req.headers['x-payment']         ||
    req.headers['X-PAYMENT']

  if (!paymentHeader) {
    // Return x402 v2 payment requirements
    const paymentRequired = {
      x402Version: 2,
      error:       'Payment required',
      resource: {
        url:         `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['host']}${req.url}`,
        description: `StellarSearch: pay-per-query news search — ${AMOUNT_USDC} USDC on Stellar`,
        mimeType:    'application/json',
      },
      accepts: [
        {
          scheme:            'exact',
          network:           NETWORK,            // "stellar:testnet"
          amount:            AMOUNT_STROOPS,     // "10000" (stroops = 0.001 USDC)
          asset:             USDC_CONTRACT,      // Soroban contract address
          payTo:             RECEIVING_ADDRESS,  // receiving G... address
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

  // ─── Payment present — proceed with news search ───────────────────────────
  console.log('✅ Payment header received')

  let txHash: string | null = null
  try {
    const decoded = Buffer.from(paymentHeader as string, 'base64').toString('utf8')
    const parsed  = JSON.parse(decoded)
    txHash = parsed.transactionHash || parsed.txHash || null
  } catch {
    // payment header not base64 JSON
  }

  const t0 = Date.now()

  try {
    const requestBody: Record<string, unknown> = {
      q:   cleanQ,
      num: countValidation.value,
    }

    if (freshnessValidation.value) {
      requestBody.tbs = FRESHNESS_TBS[freshnessValidation.value]
    }

    const serperRes = await fetch('https://google.serper.dev/news', {
      method:  'POST',
      headers: {
        'X-API-KEY':    SERPER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    if (!serperRes.ok) {
      const errText = await serperRes.text()
      console.error('[serper news]', serperRes.status, errText)
      return res.status(502).json({ error: `Serper.dev API error: ${serperRes.status}` })
    }

    const data      = await serperRes.json()
    const latencyMs = Date.now() - t0

    const results = (data.news || []).map((r: any, i: number) => ({
      id:          String(i + 1),
      title:       r.title || 'No title',
      url:         r.link,
      snippet:     r.snippet || '',
      source:      r.source || (() => {
        try { return new URL(r.link).hostname.replace('www.', '') }
        catch { return r.link }
      })(),
      publishedAt: r.date || undefined,
      imageUrl:    r.imageUrl || undefined,
    }))

    return res.json({
      query:      cleanQ,
      results,
      count:      results.length,
      network:    NETWORK,
      paidAmount: AMOUNT_USDC,
      currency:   'USDC',
      txHash,
      latencyMs,
    })

  } catch (err: any) {
    console.error('[news error]', err.message)
    return res.status(500).json({ error: 'News search failed.' })
  }
}
