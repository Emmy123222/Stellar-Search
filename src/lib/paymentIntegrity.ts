import crypto from 'crypto'

export interface PaymentReceiptExpectation {
  network: string
  asset: string
  amount: string
}

export interface DecodedPaymentReceipt {
  ok: true
  txHash: string
  payload: Record<string, unknown>
}

export interface InvalidPaymentReceipt {
  ok: false
  reason: string
}

/**
 * Default validity window for consumed payment payloads in milliseconds.
 * Aligned with x402 maxTimeoutSeconds (300 seconds = 5 minutes).
 */
export const DEFAULT_PAYMENT_VALIDITY_WINDOW_MS = 300 * 1000

export function isValidStellarTxHash(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Fa-f0-9]{64}$/.test(value.trim())
}

export function decodePaymentReceipt(
  receipt: unknown,
  expected?: PaymentReceiptExpectation
): DecodedPaymentReceipt | InvalidPaymentReceipt {
  if (receipt == null) {
    return { ok: false, reason: 'receipt is empty' }
  }

  let payload: Record<string, unknown> | null = null

  if (typeof receipt === 'string') {
    const raw = receipt.trim()
    if (!raw) return { ok: false, reason: 'receipt is empty' }

    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') payload = parsed as Record<string, unknown>
    } catch {
      try {
        const decoded = Buffer.from(raw, 'base64').toString('utf8')
        const parsed = JSON.parse(decoded)
        if (parsed && typeof parsed === 'object') payload = parsed as Record<string, unknown>
      } catch {
        // not JSON or base64-encoded JSON; invalid receipt
      }
    }
  } else if (typeof receipt === 'object') {
    payload = receipt as Record<string, unknown>
  }

  if (!payload) {
    return { ok: false, reason: 'receipt is not JSON or base64 JSON' }
  }

  if (payload.schema !== 'x402.payment.receipt') {
    return { ok: false, reason: 'receipt schema mismatch' }
  }

  const network = typeof payload.network === 'string' ? payload.network : ''
  if (expected && network !== expected.network) {
    return { ok: false, reason: 'receipt network mismatch' }
  }

  const asset = typeof payload.asset === 'string' ? payload.asset : ''
  if (expected && asset !== expected.asset) {
    return { ok: false, reason: 'receipt asset mismatch' }
  }

  const amount = String(payload.amount ?? '')
  if (expected && amount !== String(expected.amount)) {
    return { ok: false, reason: 'receipt amount mismatch' }
  }

  const txHash =
    typeof payload.transactionHash === 'string'
      ? payload.transactionHash
      : typeof payload.txHash === 'string'
        ? payload.txHash
        : ''

  if (!isValidStellarTxHash(txHash)) {
    return { ok: false, reason: 'receipt tx hash is not a 64-hex transaction hash' }
  }

  return { ok: true, txHash: txHash.trim(), payload }
}

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
