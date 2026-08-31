/**
 * Pure reconciliation logic shared by every runtime (Express, Vercel, MCP).
 *
 * A ReconciliationRecord links a single paid request's idempotency key
 * (the payment identifier from src/lib/paymentIntegrity.ts) and settlement
 * receipt (tx hash) to whether a provider response was actually delivered,
 * so operators can spot two kinds of drift:
 *   - settled_no_delivery    — payment was consumed but no search response
 *                               was delivered (upstream error, validation
 *                               failure after the payment gate, etc.)
 *   - delivered_no_settlement — a response was returned without a captured
 *                               payment identifier (should never happen
 *                               given the x402 gate; catches regressions)
 *
 * Records intentionally never carry the search query text or any other
 * user-supplied content — only identifiers, booleans, counts, and
 * timestamps — so a reconciliation report is safe to store or forward
 * without exposing query content.
 */

export type ReconciliationRoute = '/search' | '/images' | '/news'

export type ReconciliationOutcome =
  | 'reconciled'
  | 'settled_no_delivery'
  | 'delivered_no_settlement'

export interface ReconciliationRecord {
  requestId: string
  /** Payment identifier from consumePaymentPayload(), or null if none was captured. */
  idempotencyKey: string | null
  route: ReconciliationRoute
  /** Settlement transaction hash, when available. */
  receiptTxHash: string | null
  paymentSettled: boolean
  providerDelivered: boolean
  resultCount: number
  outcome: ReconciliationOutcome
  createdAt: string
}

export interface ReconciliationReport {
  total: number
  reconciled: number
  settledNoDelivery: number
  deliveredNoSettlement: number
  /** Every non-`reconciled` record, for operator follow-up. */
  unmatched: ReconciliationRecord[]
}

export function classifyOutcome(paymentSettled: boolean, providerDelivered: boolean): ReconciliationOutcome {
  if (paymentSettled && providerDelivered) return 'reconciled'
  if (paymentSettled && !providerDelivered) return 'settled_no_delivery'
  return 'delivered_no_settlement'
}

export function buildReconciliationRecord(params: {
  requestId: string
  idempotencyKey: string | null
  route: ReconciliationRoute
  receiptTxHash: string | null
  providerDelivered: boolean
  resultCount: number
  now?: Date
}): ReconciliationRecord {
  const paymentSettled = params.idempotencyKey !== null
  const outcome = classifyOutcome(paymentSettled, params.providerDelivered)

  return {
    requestId: params.requestId,
    idempotencyKey: params.idempotencyKey,
    route: params.route,
    receiptTxHash: params.receiptTxHash,
    paymentSettled,
    providerDelivered: params.providerDelivered,
    resultCount: params.resultCount,
    outcome,
    createdAt: (params.now ?? new Date()).toISOString(),
  }
}

export function summarizeReconciliation(records: ReconciliationRecord[]): ReconciliationReport {
  const unmatched = records.filter(r => r.outcome !== 'reconciled')
  return {
    total: records.length,
    reconciled: records.length - unmatched.length,
    settledNoDelivery: records.filter(r => r.outcome === 'settled_no_delivery').length,
    deliveredNoSettlement: records.filter(r => r.outcome === 'delivered_no_settlement').length,
    unmatched,
  }
}
