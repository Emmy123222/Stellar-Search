import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  getX402DiscoveryMetadata,
  requestOrigin,
} from '../../src/lib/x402Discovery'

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  res.setHeader('Cache-Control', 'public, max-age=300')
  return res.status(200).json(getX402DiscoveryMetadata({ origin: requestOrigin(req) }))
}
