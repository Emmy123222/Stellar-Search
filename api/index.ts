import type { VercelRequest, VercelResponse } from '@vercel/node'
import { randomUUID } from 'crypto'

export default function handler(req: VercelRequest, res: VercelResponse) {
  const requestId = (req.headers['x-request-id'] as string) || randomUUID()
  
  res.setHeader('X-Request-ID', requestId)
  res.json({
    requestId,
    name: 'StellarSearch',
    version: '1.0.0',
    description: 'Pay-per-query web search for AI agents via x402 on Stellar',
    endpoints: {
      'GET /api/search?q=<query>': '0.001 USDC via x402',
      'POST /api/ai/chat': 'Groq AI — free',
      'GET /api/health': 'Live server stats',
    },
  })
}