import type { VercelRequest, VercelResponse } from '@vercel/node'
import { jobStore } from '../jobs'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', ['Content-Type', 'Authorization'].join(', '))

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const id = (req.query as any).id as string
  if (!id) return res.status(400).json({ error: 'Missing job id' })

  // Also check server's jobStore via import fallback: try local map; if not found attempt to read from shared store
  const job = jobStore.get(id)
  if (!job) return res.status(404).json({ error: 'Job not found' })

  return res.json({ job, paymentVerified: job.verified, statusUrl: job.statusUrl })
}
