import crypto from 'crypto'
import type { CreditReceipt } from '../types/index.js'

/**
 * Off-chain credit ledger for paid searches that fail *after* x402 settlement
 * (e.g. a Serper.dev outage once the payer's USDC has already moved). This is
 * an application-level IOU, not a Stellar transaction — it is intentionally
 * separate from on-chain refunds, which would require a second signed
 * transfer back to the payer and are out of scope here.
 *
 * Default validity window for redemption, in milliseconds (30 days).
 */
export const DEFAULT_CREDIT_VALIDITY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

export interface SearchCredit {
  creditId: string
  /** The settled payment identifier this credit is linked to (see paymentIntegrity.ts). */
  receiptId: string
  route: string
  query: string
  amount: string
  currency: string
  reason: string
  createdAt: number
  expiresAt: number
  redeemed: boolean
  redeemedAt: number | null
}

// Keyed by receiptId so issuing a credit for the same settled payment twice
// (e.g. a client retry after a timeout) is a no-op rather than a double credit.
const creditsByReceipt = new Map<string, SearchCredit>()
// Keyed by creditId for direct lookup/redemption.
const creditsById = new Map<string, SearchCredit>()

function deriveCreditId(receiptId: string): string {
  return `credit_${crypto.createHash('sha256').update(receiptId).digest('hex').slice(0, 32)}`
}

/**
 * Issues an auditable credit for a paid search that failed after settlement.
 * Idempotent: calling this more than once for the same receiptId returns the
 * original credit instead of minting a new one.
 */
export function issueSearchCredit(params: {
  receiptId: string
  route: string
  query: string
  amount: string
  reason: string
  currency?: string
  now?: number
  validityWindowMs?: number
}): SearchCredit {
  const {
    receiptId,
    route,
    query,
    amount,
    reason,
    currency = 'USDC',
    now = Date.now(),
    validityWindowMs = DEFAULT_CREDIT_VALIDITY_WINDOW_MS,
  } = params

  const existing = creditsByReceipt.get(receiptId)
  if (existing) return existing

  const credit: SearchCredit = {
    creditId: deriveCreditId(receiptId),
    receiptId,
    route,
    query,
    amount,
    currency,
    reason,
    createdAt: now,
    expiresAt: now + validityWindowMs,
    redeemed: false,
    redeemedAt: null,
  }

  creditsByReceipt.set(receiptId, credit)
  creditsById.set(credit.creditId, credit)
  return credit
}

export function getCredit(creditId: string): SearchCredit | null {
  return creditsById.get(creditId) || null
}

export function getCreditByReceipt(receiptId: string): SearchCredit | null {
  return creditsByReceipt.get(receiptId) || null
}

/**
 * Redeems a credit. Idempotent (a redeemed credit cannot be redeemed again)
 * and bounded (a credit past its expiresAt can no longer be redeemed).
 */
export function redeemCredit(
  creditId: string,
  now: number = Date.now(),
): { ok: true; credit: SearchCredit } | { ok: false; error: string } {
  const credit = creditsById.get(creditId)
  if (!credit) return { ok: false, error: 'Credit not found' }
  if (credit.redeemed) return { ok: false, error: 'Credit already redeemed' }
  if (credit.expiresAt <= now) return { ok: false, error: 'Credit expired' }

  credit.redeemed = true
  credit.redeemedAt = now
  return { ok: true, credit }
}

/** Converts an internal credit record into the JSON-safe shape returned by the API. */
export function serializeCredit(credit: SearchCredit): CreditReceipt {
  return {
    creditId: credit.creditId,
    receiptId: credit.receiptId,
    route: credit.route,
    query: credit.query,
    amount: credit.amount,
    currency: credit.currency,
    reason: credit.reason,
    issuedAt: new Date(credit.createdAt).toISOString(),
    expiresAt: new Date(credit.expiresAt).toISOString(),
    redeemed: credit.redeemed,
    redeemedAt: credit.redeemedAt ? new Date(credit.redeemedAt).toISOString() : null,
  }
}

/** Resets the ledger. Essential for clean test isolation. */
export function resetCredits(): void {
  creditsByReceipt.clear()
  creditsById.clear()
}

export function getCreditsCount(): number {
  return creditsById.size
}
