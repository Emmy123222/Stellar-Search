import type { PaymentChallenge, PaymentAcceptOption } from './types'

/**
 * Safely redacts private keys or secret material so secrets never appear
 * in logs, error traces, or formatted strings.
 */
export function redactSecret(value?: string): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return '<empty>'
  if (raw.length <= 4) return '*'.repeat(raw.length)
  const head = raw.slice(0, 2)
  const tail = raw.slice(-2)
  const maskLength = Math.max(4, Math.min(12, raw.length - 4))
  return `${head}${'*'.repeat(maskLength)}${tail}`
}

function getHeaderCaseInsensitive(
  headers: Headers | Record<string, string | string[] | undefined> | undefined,
  name: string
): string | undefined {
  if (!headers) return undefined
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name) ?? undefined
  }
  const target = name.toLowerCase()
  const record = headers as Record<string, string | string[] | undefined>
  for (const key of Object.keys(record)) {
    if (key.toLowerCase() === target) {
      const val = record[key]
      return Array.isArray(val) ? val[0] : val
    }
  }
  return undefined
}

/**
 * Parses an x402 payment challenge from response headers or response body.
 * Supports both base64-encoded `PAYMENT-REQUIRED` headers and JSON payloads.
 */
export function parsePaymentChallenge(
  headers?: Headers | Record<string, string | string[] | undefined>,
  body?: unknown
): PaymentChallenge | null {
  const rawHeader = getHeaderCaseInsensitive(headers, 'payment-required')
  let parsedJson: any = null

  if (rawHeader) {
    // Attempt 1: Try base64 decoding
    try {
      const decoded = typeof atob === 'function'
        ? atob(rawHeader)
        : Buffer.from(rawHeader, 'base64').toString('utf8')
      parsedJson = JSON.parse(decoded)
    } catch {
      // Attempt 2: Try direct JSON parse in case it was sent as plain JSON string
      try {
        parsedJson = JSON.parse(rawHeader)
      } catch {
        parsedJson = null
      }
    }
  }

  // Attempt 3: Fall back to body if header wasn't decodable
  if (!parsedJson && body && typeof body === 'object') {
    parsedJson = body
  }

  if (!parsedJson || typeof parsedJson !== 'object') {
    return null
  }

  const accepts: PaymentAcceptOption[] = []
  if (Array.isArray(parsedJson.accepts)) {
    for (const opt of parsedJson.accepts) {
      if (opt && typeof opt === 'object') {
        accepts.push({
          scheme: String(opt.scheme || 'exact'),
          network: String(opt.network || 'stellar:testnet'),
          amount: String(opt.amount || '10000'),
          asset: String(opt.asset || ''),
          payTo: String(opt.payTo || ''),
          maxTimeoutSeconds: typeof opt.maxTimeoutSeconds === 'number' ? opt.maxTimeoutSeconds : undefined,
          extra: opt.extra && typeof opt.extra === 'object' ? opt.extra : undefined,
        })
      }
    }
  }

  return {
    x402Version: parsedJson.x402Version,
    error: parsedJson.error || 'Payment required',
    resource: parsedJson.resource,
    accepts,
    rawHeader: rawHeader || undefined,
  }
}

/**
 * Encodes a signed payment signature or payload into standardized HTTP headers.
 */
export function encodePaymentHeaders(
  payload: string | Record<string, unknown>
): Record<string, string> {
  let headerValue: string
  if (typeof payload === 'string') {
    headerValue = payload.trim()
  } else {
    const jsonStr = JSON.stringify(payload)
    headerValue = typeof btoa === 'function'
      ? btoa(jsonStr)
      : Buffer.from(jsonStr).toString('base64')
  }

  return {
    'PAYMENT-SIGNATURE': headerValue,
    'x-payment': headerValue,
  }
}

/**
 * Extracts the facilitator settlement receipt / transaction hash from response headers.
 */
export function extractSettlementResponse(
  headers?: Headers | Record<string, string | string[] | undefined>
): { txHash: string | null; raw: string | null } {
  const raw = getHeaderCaseInsensitive(headers, 'x-payment-response')
  if (!raw) {
    return { txHash: null, raw: null }
  }

  // If raw is already a 64-character hex transaction hash
  if (/^[0-9a-fA-F]{64}$/.test(raw.trim())) {
    return { txHash: raw.trim(), raw }
  }

  // Attempt to decode base64 or JSON envelope
  try {
    const text = typeof atob === 'function'
      ? atob(raw)
      : Buffer.from(raw, 'base64').toString('utf8')
    const parsed = JSON.parse(text)
    const txHash = parsed.transactionHash || parsed.txHash || null
    return { txHash, raw }
  } catch {
    try {
      const parsed = JSON.parse(raw)
      const txHash = parsed.transactionHash || parsed.txHash || null
      return { txHash, raw }
    } catch {
      return { txHash: null, raw }
    }
  }
}
