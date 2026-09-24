/**
 * Privacy transforms for operator log fields.
 *
 * These live in their own module (rather than inside `server/logger.ts`) so
 * request handlers can import them without pulling in the winston logger
 * instance. Test suites routinely mock the logger module with only a `default`
 * export; a handler that destructured named exports from that module would
 * throw from inside a `res.on('finish')` callback, where the failure cannot be
 * attributed to a request.
 *
 * `server/logger.ts` re-exports both helpers so the existing public API is
 * unchanged.
 */
import crypto from 'crypto'

/**
 * Query text is intentionally never logged — correlation happens through
 * request IDs and receipts — so this deliberately returns `undefined`.
 */
export function privacySafeQuery(value: unknown): undefined {
  void value
  return undefined
}

/**
 * Returns a stable, non-reversible correlation tag for a client IP so log
 * lines can be grouped without storing personal data.
 */
export function privacySafeIp(value: unknown): string {
  const raw = typeof value === 'string' ? value : ''
  return raw ? `ip:${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16)}` : 'ip:unknown'
}
