import type { VercelRequest, VercelResponse } from '@vercel/node'
import { NETWORK, AMOUNT_USDC, AMOUNT_STROOPS, USDC_CONTRACT } from '../src/lib/constants'

const RECEIVING_ADDRESS = process.env.STELLAR_RECEIVING_ADDRESS || ''
const FACILITATOR_URL = process.env.FACILITATOR_URL || 'https://www.x402.org/facilitator'

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  res.json({
    version: '1.0.0',
    endpoints: [
      { method: 'GET',  path: '/api/search',        description: 'Web search' },
      { method: 'GET',  path: '/api/images',        description: 'Image search' },
      { method: 'GET',  path: '/api/news',          description: 'News search' },
      { method: 'POST', path: '/api/search/batch',  description: 'Batch search (up to 10 queries, JSONL streaming)' },
      { method: 'POST', path: '/api/jobs',          description: 'Async search job with webhook callback' },
    ],
    schemes: [{
      network:        NETWORK,
      scheme:         'exact',
      assetContract:  USDC_CONTRACT,
      amountStroops:  AMOUNT_STROOPS,
      amountUsdc:     AMOUNT_USDC,
      payTo:          RECEIVING_ADDRESS,
      maxTimeoutSeconds: 300,
    }],
    facilitatorUrl: FACILITATOR_URL,
    note: 'All paid endpoints require 0.001 USDC per query via x402 on Stellar. Batch requests scale linearly.',
  })
}
