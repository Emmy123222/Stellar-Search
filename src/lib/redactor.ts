/**
 * Shared redactor — recursive, case-insensitive, covers headers/keys/addresses/query fields.
 * Used by Express, Vercel, browser hooks, and MCP.
 */

export const REDACTED = '[REDACTED]'

// Lower-cased sensitive keys. Covers:
//  - authorization / payment headers
//  - provider keys / secrets
//  - wallet addresses / signing material
//  - search / query text and provider messages
const SENSITIVE_KEYS = new Set<string>([
  // headers / payment
  'authorization',
  'x-payment',
  'payment-signature',
  'payment_signature',
  'x-payment-response',
  'x_payment_response',
  'payment-required',
  'payment_required',
  'payement-required',
  'x-api-key',
  'x_api_key',
  'api-key',
  'apikey',
  'api_key',
  // provider keys
  'serper_api_key',
  'serperapikey',
  'groq_api_key',
  'groqapikey',
  'gsk',
  'secret',
  'secrets',
  'token',
  'bearer',
  'credential',
  'credentials',
  'password',
  'privatekey',
  'private_key',
  'secretkey',
  'secret_key',
  // wallet / address
  'address',
  'walletaddress',
  'wallet_address',
  'wallet',
  'receivingaddress',
  'receiving_address',
  'payto',
  'pay_to',
  'signeraddress',
  'signer_address',
  'publickey',
  'public_key',
  'account',
  'accountaddress',
  // query / content / provider messages
  'q',
  'query',
  'querytext',
  'query_text',
  'searchtext',
  'search_text',
  'search',
  'text',
  'content',
  'message',
  'messages',
  'prompt',
  'question',
  'snippet',
  'description',
  'signedauthentry',
  'signed_auth_entry',
  // generic
  'cookie',
  'set-cookie',
  'set_cookie',
])

// Value patterns that look sensitive even when key is generic (e.g., `headers: { Authorization: 'Bearer ...' }` already covered,
// but also `value: 'G...'` 56-char Stellar address or `gsk_...` Groq key)
const STELLAR_ADDR_RE = /^G[A-Z2-7]{55}$/
const GROQ_KEY_RE = /^gsk_[a-zA-Z0-9]{20,}$/
const BEARER_RE = /^Bearer\s+.+/i
const SERPER_KEY_RE = /^[a-f0-9]{32,64}$/i

function shouldRedactKey(key: string): boolean {
  const norm = key.toLowerCase().replace(/[-_]/g, '_').replace(/:/g, '')
  // direct match
  if (SENSITIVE_KEYS.has(key.toLowerCase())) return true
  if (SENSITIVE_KEYS.has(norm)) return true
  // suffix/prefix heuristics: e.g., "mySecretToken", "walletAddress", "Authorization"
  const lower = key.toLowerCase()
  for (const s of SENSITIVE_KEYS) {
    if (lower.includes(s)) return true
  }
  return false
}

function isSensitiveValue(value: string): boolean {
  const trimmed = value.trim()
  if (STELLAR_ADDR_RE.test(trimmed)) return true
  if (GROQ_KEY_RE.test(trimmed)) return true
  if (BEARER_RE.test(trimmed)) return true
  // Heuristic: long hex keys that appear without a known key name — still redact if >30 chars hex
  if (trimmed.length >= 32 && SERPER_KEY_RE.test(trimmed) && trimmed.length <= 64) {
    // Only redact if entropy looks like a key; avoid redacting normal text
    // We treat standalone hex strings >32 chars as potentially sensitive
    return true
  }
  return false
}

export function redact<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || value === undefined) return value

  if (typeof value === 'string') {
    return (isSensitiveValue(value) ? (REDACTED as unknown as T) : value)
  }

  if (typeof value !== 'object') return value

  // Avoid circular refs
  if (seen.has(value as object)) return REDACTED as unknown as T
  seen.add(value as object)

  if (Array.isArray(value)) {
    return (value as unknown[]).map((v) => redact(v, seen)) as unknown as T
  }

  // Buffer / Uint8Array / Date etc — don't recurse, redact if looks sensitive
  if (value instanceof Date || value instanceof RegExp) return value
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return REDACTED as unknown as T

  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (shouldRedactKey(k)) {
      out[k] = REDACTED
    } else if (typeof v === 'string' && isSensitiveValue(v)) {
      out[k] = REDACTED
    } else if (v !== null && typeof v === 'object') {
      out[k] = redact(v, seen)
    } else {
      out[k] = v
    }
  }
  return out as T
}

export function redactForLog(input: unknown): unknown {
  return redact(input)
}

export const __testing = { shouldRedactKey, isSensitiveValue, SENSITIVE_KEYS }
