import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyServerlessHeaders } from '../src/lib/serverlessHeaders'

export default function handler(req: VercelRequest, res: VercelResponse) {
  applyServerlessHeaders(res)
  res.json({
    name: 'StellarSearch',
    version: '1.0.0',
    description: 'Pay-per-query web search for AI agents via x402 on Stellar',
    capabilities: {
      streaming: true,
      images: true,
      news: true,
      paymentHeaders: ['payment-signature', 'x-payment', 'X-PAYMENT', 'x-payment-response', 'authorization'],
      runtime: 'vercel'
    },
    endpoints: {
      'GET /api/search?q=<query>': '0.001 USDC via x402',
      'GET /api/images?q=<query>': '0.001 USDC via x402',
      'GET /api/news?q=<query>': '0.001 USDC via x402',
      'POST /api/ai/chat': 'Groq AI — free',
      'GET /api/health': 'Live server stats',
      'GET /.well-known/x402': 'Machine-readable x402 resource and pricing discovery metadata',
    },
  })
}
