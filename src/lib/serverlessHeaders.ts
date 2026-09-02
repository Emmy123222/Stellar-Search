import type { VercelResponse } from '@vercel/node'

/** Apply safe defaults to every Vercel API response without changing API payloads. */
export function applyServerlessHeaders(res: VercelResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
}
