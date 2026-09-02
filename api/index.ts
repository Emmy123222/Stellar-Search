import type { VercelRequest, VercelResponse } from '@vercel/node'

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.json({
    name: 'StellarSearch',
    version: '1.0.0',
    description: 'Pay-per-query web search for AI agents via x402 on Stellar',
    endpoints: {
      'GET /api/search?q=<query>': '0.001 USDC via x402',
      'GET /api/images?q=<query>': '0.001 USDC via x402 — image results',
      'GET /api/news?q=<query>': '0.001 USDC via x402 — news articles',
      'POST /api/search/batch': '0.001 USDC per query (max 10), JSONL streaming',
      'POST /api/jobs': '0.001 USDC via x402 — async job, returns 202',
      'GET /api/jobs/:id': 'Job status + verified payment state',
      'GET /api/jobs': 'List recent jobs (capped at 50)',
      'GET /api/pricing': 'Free — pricing info, scheme, and valid endpoints',
      'POST /api/ai/chat': 'Groq AI — free',
      'GET /api/health': 'Live server stats',
    },
  })
}