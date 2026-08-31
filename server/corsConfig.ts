/**
 * CORS configuration — dev uses wildcard; production uses ALLOWED_ORIGINS allowlist.
 */

import type { CorsOptions } from 'cors'

const CORS_ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'X-Payment',
  'payment-signature',
  'x-payment',
  'X-PAYMENT',
] as const

const CORS_EXPOSED_HEADERS = [
  'PAYMENT-REQUIRED',
  'X-Payment-Response',
] as const

const CORS_METHODS = ['GET', 'POST', 'OPTIONS'] as const

export function parseAllowedOrigins(raw?: string): string[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function isProductionEnv(): boolean {
  return process.env.NODE_ENV === 'production'
}

export function getCorsStartupMessage(): string {
  if (!isProductionEnv()) {
    return 'CORS: * (development)'
  }

  const allowed = parseAllowedOrigins(process.env.ALLOWED_ORIGINS)
  if (allowed.length === 0) {
    return 'CORS: allowlist empty — cross-origin browser requests blocked'
  }

  return `CORS: allowlist (${allowed.length} origin${allowed.length === 1 ? '' : 's'})`
}

export function buildCorsOptions(): CorsOptions {
  const base: CorsOptions = {
    allowedHeaders: [...CORS_ALLOWED_HEADERS],
    exposedHeaders: [...CORS_EXPOSED_HEADERS],
    methods: [...CORS_METHODS],
  }

  if (!isProductionEnv()) {
    return { ...base, origin: '*' }
  }

  const allowed = parseAllowedOrigins(process.env.ALLOWED_ORIGINS)

  if (allowed.length === 0) {
    console.warn(
      '[cors] ALLOWED_ORIGINS is empty in production — blocking cross-origin browser requests',
    )
  }

  return {
    ...base,
    origin(origin, callback) {
      if (!origin) {
        callback(null, true)
        return
      }

      callback(null, allowed.includes(origin))
    },
  }
}
export function applyServerlessCors(req: { headers: { origin?: string } }, res: { setHeader: (key: string, value: string) => void }) {
  res.setHeader('Access-Control-Allow-Methods', CORS_METHODS.join(', '))
  res.setHeader('Access-Control-Allow-Headers', CORS_ALLOWED_HEADERS.join(', '))
  res.setHeader('Access-Control-Expose-Headers', CORS_EXPOSED_HEADERS.join(', '))

  const origin = req.headers.origin

  if (!isProductionEnv()) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    return
  }

  const allowed = parseAllowedOrigins(process.env.ALLOWED_ORIGINS)

  if (!origin) {
    // No origin (e.g. MCP, server-to-server)
    return
  }

  if (allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
}
