import type { VercelRequest, VercelResponse } from '@vercel/node'
import { AVAILABLE_MODELS, DEFAULT_MODEL } from '../../src/lib/aiModels'

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  return res.json({
    models: AVAILABLE_MODELS,
    default: DEFAULT_MODEL,
  })
}
