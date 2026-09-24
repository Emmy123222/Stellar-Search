/**
 * Parsing and formatting helpers for the x402 payment-challenge deadline (#114).
 *
 * The server's `PAYMENT-REQUIRED` header carries `accepts[].maxTimeoutSeconds`:
 * the window in which the signed authorization must be presented. Before this
 * change the browser threw the number away, so a challenge that expired while
 * Freighter was prompting produced a generic failure with no countdown, no
 * explanation, and no way to get a fresh challenge.
 *
 * These helpers are pure so the countdown, the expiry gate, and the retry path
 * can be unit-tested without a wallet or a network.
 */

/**
 * Documented window used when a server omits `maxTimeoutSeconds`. Matches both
 * the Express/Vercel payment requirements and
 * `src/lib/paymentIntegrity.ts#DEFAULT_PAYMENT_VALIDITY_WINDOW_MS`.
 */
export const DEFAULT_CHALLENGE_TIMEOUT_SECONDS = 300

export interface ChallengeDeadline {
  /** When the client received the challenge. */
  issuedAt: number
  /** `issuedAt + maxTimeoutSeconds * 1000`. */
  expiresAt: number
  /** The window the server advertised (or the documented default). */
  maxTimeoutSeconds: number
}

interface PaymentRequiredLike {
  accepts?: Array<{ maxTimeoutSeconds?: unknown }> | unknown
}

/**
 * Reads the deadline from a decoded x402 `PaymentRequired` payload.
 *
 * Returns `null` when the payload carries no payment options at all — there is
 * nothing to sign, so there is no deadline to display. A missing, non-numeric,
 * or non-positive `maxTimeoutSeconds` falls back to
 * {@link DEFAULT_CHALLENGE_TIMEOUT_SECONDS} rather than disabling the countdown.
 */
export function readChallengeDeadline(
  paymentRequired: unknown,
  now: number = Date.now(),
): ChallengeDeadline | null {
  const accepts = (paymentRequired as PaymentRequiredLike | null | undefined)?.accepts
  if (!Array.isArray(accepts) || accepts.length === 0) return null

  const raw = (accepts[0] as { maxTimeoutSeconds?: unknown } | undefined)?.maxTimeoutSeconds
  const maxTimeoutSeconds =
    typeof raw === 'number' && Number.isFinite(raw) && raw > 0
      ? raw
      : DEFAULT_CHALLENGE_TIMEOUT_SECONDS

  return {
    issuedAt: now,
    expiresAt: now + maxTimeoutSeconds * 1000,
    maxTimeoutSeconds,
  }
}

/** Milliseconds left on the challenge, clamped at `0`. `null` when unknown. */
export function remainingMs(
  deadline: ChallengeDeadline | null | undefined,
  now: number = Date.now(),
): number | null {
  if (!deadline) return null
  return Math.max(0, deadline.expiresAt - now)
}

/** True once the challenge can no longer be presented. */
export function isChallengeExpired(
  deadline: ChallengeDeadline | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!deadline) return false
  return now >= deadline.expiresAt
}

/** Formats a remaining duration as `m:ss` (e.g. `4:59`). */
export function formatCountdown(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '--:--'
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** Message surfaced when a challenge expired before it could be signed. */
export const CHALLENGE_EXPIRED_MESSAGE =
  'The payment challenge expired before it could be signed. No payment was sent — retry to request a fresh challenge.'
