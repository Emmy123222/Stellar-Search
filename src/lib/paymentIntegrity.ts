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
 * If no explicit ID field is found, computes a deterministic hash of the normalized header string.
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
      obj = tryDecodeBase64Json(rawString)
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

  // 2. Fallback: deterministic hash of the raw header string
  const hash = stableHash(rawString)
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

  return { paymentId } as { ok: true; paymentId }
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

/**
 * Input values required to perform a payment preflight check.
 * This is intentionally a plain data object so hooks can assemble it from wallet/network state.
 */
export interface PaymentPreflightInput {
  /** Active Stellar public key (from Freighter) or null if none selected. */
  account: string | null
  /** The network the wallet is currently connected to. */
  network: string
  /** The network the x402 payment requires (e.g. 'testnet' or 'public'). */
  expectedNetwork: string
  /** Whether the active account has a USDC trustline. */
  usdcTrustline: boolean
  /** Spendable USDC balance available for the payment. */
  spendableBalance: number
  /** Amount required for the payment. */
  requiredAmount: number
  /** Whether the signing wallet (Freighter) is available and unlocked. */
  signerAvailable: boolean
}

export type PreflightFailureReason =
  | 'NO_ACCOUNT'
  | 'WRONG_NETWORK'
  | 'NO_TRUSTLINE'
  | 'INSUFFICIENT_BALANCE'
  | 'NO_SIGNER'

export type PaymentPreflightResult =
  | { ok: true }
  | { ok: false; reason: PreflightFailureReason; recoveryAction: string }

/**
 * Checks whether all conditions are satisfied before creating a signed x402 payment payload.
 *
 * This is a bounded, side-effect-free preflight: it never creates or signs a payment,
 * and it returns a single targeted recovery action for the first unmet condition.
 *
 * @param input Preflight data assembled from the active wallet and network state.
 * @returns `{ ok: true }if all checks pass. Otherwise `{ ok: false, reason, recoveryAction }`.
 */
export function performPaymentPreflight(input: PaymentPreflightInput): PaymentPreflightResult {
  if (!input.signerAvailable) {
    return {
      ok: false,
      reason: 'NO_SIGNER',
      recoveryAction: 'Unlock Freighter and make sure it is available.',
    }
  }

  if (!input.account) {
    return {
      ok: false,
      reason: 'NO_ACCOUNT',
      recoveryAction: 'Open Freighter and select an active account.',
    }
  }

  if (input.network !== input.expectedNetwork) {
    return {
      ok: false,
      reason: 'WRONG_NETWORK',
      recoveryAction: `Switch your wallet network to ${input.expectedNetwork}.`,
    }
  }

  if (!input.usdcTrustline) {
    return {
      ok: false,
      reason: 'NO_TRUSTLINE',
      recoveryAction: 'Add a USDC trustline in Freighter before making this payment.',
    }
  }

  if (typeof input.spendableBalance !== 'number' || typeof input.requiredAmount !== 'number' || !Number.isFinite(input.spendableBalance) || !Number.isFinite(input.requiredAmount) || input.requiredAmount < 0 || input.spendableBalance < input.requiredAmount) {
    return {
      ok: false,
      reason: 'INSUFFICIENT_BALANCE',
      recoveryAction: 'Fund your account with more USDC to cover the payment amount.',
    }
  }

  return { ok: true }
}

/**
 * Helper to decode a base64-encoded UTF-8 string and parse it as JSON.
 * Returns the parsed JSON object, or null if decoding/parsing fails.
 */
function tryDecodeBase64Json(raw: string): any {
  try {
    const binary = atob(raw)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    const decoded = new TextDecoder().decode(bytes)
    return JSON.parse(decoded)
  } catch {
    return null
  }
}

/**
 * Computes a stable, non-cryptographic hash of a string.
 * Used as a fallback when no explicit Payment ID is available.
 * This is browser-safe and does not rely on Node-specific apis.
 */
function stableHash(input: string): string {
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) + input.charCodeAt(i)
    hash |= 0 // Convert to 32bit integer
  }
  return hash.toString(36)
}
