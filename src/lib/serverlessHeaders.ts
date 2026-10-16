import type { VercelResponse, VercelRequest } from '@vercel/node'
import { appendVaryHeader, attachServerlessCompression } from './compression.js'

/** Apply safe defaults and compression negotiation to every Vercel API response without changing API payloads. */
export function applyServerlessHeaders(res: VercelResponse, req?: VercelRequest): void {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  appendVaryHeader(res, 'Accept-Encoding')

  if (req) {
    attachServerlessCompression(req, res)
  }
}
