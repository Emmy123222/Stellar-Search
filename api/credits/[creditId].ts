import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getCredit, redeemCredit, serializeCredit } from '../../src/lib/creditLedger.js'
import type { ApiErrorResponse } from '../../src/types/index.js'

/**
 * Mirrors server/index.ts's `GET /credits/:creditId` and
 * `POST /credits/:creditId/redeem` on the Vercel runtime. Free — reading or
 * redeeming a credit is not itself a paid action.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const creditId = req.query.creditId as string

  if (req.method === 'GET') {
    const credit = getCredit(creditId)
    if (!credit) {
      const errorBody: ApiErrorResponse = { error: 'Credit not found' }
      return res.status(404).json(errorBody)
    }
    return res.json(serializeCredit(credit))
  }

  if (req.method === 'POST') {
    const result = redeemCredit(creditId)
    if (!result.ok) {
      const errorBody: ApiErrorResponse = { error: result.error }
      const status = result.error === 'Credit not found' ? 404 : 409
      return res.status(status).json(errorBody)
    }
    return res.json(serializeCredit(result.credit))
  }

  const errorBody: ApiErrorResponse = { error: 'Method not allowed' }
  return res.status(405).json(errorBody)
}
