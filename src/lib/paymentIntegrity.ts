import crypto from 'crypto'

/**
 * Default validity window for consumed payment payloads in milliseconds.
 * Aligned with x402 maxTimeoutSeconds (300 seconds = 5 minutes).
 */
export const DEFAULT_PAYMENT_VALIDITY_WINDOW_MS = 300 * 1000

export interface ConsumedPayment {
  consumedAt: number
  expiresAt: number
}

// In-memory store for consumed payment identifiers and their expiration timestamps
const consumedPayments = new Map<string, ConsumedPayment>()

/**
 * Periodically purge expired payment entries to prevent memory leaks.
 */
export function cleanupExpiredPayments(now: number = Date.now()): void {
  for (const [id, record] of consumedPayments.entries()) {
    if (record.expiresAt <= now) {
      consumedPayments.delete(id)
    }
  }
}

/**
 * Resets the consumed payment store. Essential for clean test isolation.
 */
export function resetConsumedPayments(): void {
  consumedPayments.clear()
}

/**
 * Returns the current size of the consumed payments cache (useful for diagnostic tests).
 */
export function getConsumedPaymentsCount(): number {
  return consumedPayments.size
}

/**
 * Extracts a unique, deterministic payment identifier from a payment header string or object.
 *
 * Checks if the header contains structured JSON with a transaction hash/id/signature.
 * If no explicit ID field is found, computes a SHA-256 hash of the normalized header string.
 */
export function extractPaymentIdentifier(header: unknown): string | null {
  if (!header || (typeof header !== 'string' && typeof header !== 'object')) {
    return null
  }

  const rawString = typeof header === 'string' ? header.trim() : JSON.stringify(header)
  if (!rawString) return null

  // 1. Try parsing JSON (or base64-decoded JSON)
  let obj: any = null
  if (typeof header === 'object') {
    obj = header
  } else {
    try {
      obj = JSON.parse(rawString)
    } catch {
      try {
        const decoded = Buffer.from(rawString, 'base64').toString('utf8')
        obj = JSON.parse(decoded)
      } catch {
        // Raw non-JSON string
      }
    }
  }

  if (obj && typeof obj === 'object') {
    const explicitId =
      obj.transactionHash ||
      obj.txHash ||
      obj.transaction_hash ||
      obj.signature ||
      obj.id ||
      obj.nonce ||
      obj.paymentId
    if (typeof explicitId === 'string' && explicitId.trim()) {
      return `tx:${explicitId.trim()}`
    }
  }

  // 2. Fallback: SHA-256 hash of the raw header string
  const hash = crypto.createHash('sha256').update(rawString).digest('hex')
  return `hash:${hash}`
}

/**
 * Attempts to consume a payment identifier for its validity window.
 * Returns { ok: true, paymentId } if the payment payload was successfully consumed (first time).
 * Returns { ok: false, error, paymentId } if the payment payload has already been consumed within its validity window.
 */
export function consumePaymentPayload(
  header: unknown,
  validityWindowMs: number = DEFAULT_PAYMENT_VALIDITY_WINDOW_MS,
  now: number = Date.now()
): { ok: true; paymentId: string } | { ok: false; error: string; paymentId: string | null } {
  cleanupExpiredPayments(now)

  const paymentId = extractPaymentIdentifier(header)
  if (!paymentId) {
    return { ok: false, error: 'Invalid or missing payment header', paymentId: null }
  }

  const existing = consumedPayments.get(paymentId)
  if (existing && existing.expiresAt > now) {
    return { ok: false, error: 'Payment payload already consumed', paymentId }
  }

  // Atomically mark as consumed
  consumedPayments.set(paymentId, {
    consumedAt: now,
    expiresAt: now + validityWindowMs,
  })

  return { ok: true, paymentId }
}

/**
 * Returns whether a payment identifier is currently marked as consumed within its validity window.
 */
export function isPaymentConsumed(header: unknown, now: number = Date.now()): boolean {
  cleanupExpiredPayments(now)
  const paymentId = extractPaymentIdentifier(header)
  if (!paymentId) return false
  const existing = consumedPayments.get(paymentId)
  return !!(existing && existing.expiresAt > now)
}
