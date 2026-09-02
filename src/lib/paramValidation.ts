/**
 * Shared parameter coercion/validation for paid endpoints (#188).
 *
 * Every paid route (`/search`, `/images`, `/news`, `/search/batch`, `/jobs`
 * on Express; `/api/search` on Vercel) validates `count` and `freshness`
 * through these helpers so behavior is uniform:
 *
 *   - `count` omitted → route default; must be a single integer within the
 *     route's `[min, max]` bounds; anything else (repeated params, floats,
 *     negatives, out-of-bounds, non-numeric) is rejected early.
 *   - `freshness` must be one of the supported enums (`pd` | `pw` | `pm`);
 *     omitted is fine; anything else is rejected early.
 *
 * Validation happens BEFORE payment verification and the Serper call, so
 * invalid input never reaches the payment or upstream adapters.
 */

export const FRESHNESS_VALUES = ['pd', 'pw', 'pm'] as const
export type Freshness = (typeof FRESHNESS_VALUES)[number]

/** Maps a freshness enum to the Serper `tbs` date filter. */
export const FRESHNESS_TBS: Record<Freshness, string> = {
  pd: 'qdr:d', // past day
  pw: 'qdr:w', // past week
  pm: 'qdr:m', // past month
}

export interface CountBounds {
  min: number
  max: number
  default: number
}

/** `GET /search` and batch/jobs default: up to 20 results. */
export const SEARCH_COUNT: CountBounds = { min: 1, max: 20, default: 5 }
/** `GET /images`: Serper image results are capped at 10. */
export const IMAGES_COUNT: CountBounds = { min: 1, max: 10, default: 10 }
/** `GET /news`: up to 20 results. */
export const NEWS_COUNT: CountBounds = { min: 1, max: 20, default: 10 }

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * Validates and coerces the `count` parameter against a route's bounds.
 * Missing/empty values fall back to the route default; repeated query
 * params (arrays), non-integers, and out-of-bounds values are rejected.
 */
export function validateCount(raw: unknown, bounds: CountBounds): ValidationResult<number> {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, value: bounds.default }
  }
  // Repeated params arrive as arrays, e.g. `?count=1&count=2`.
  if (Array.isArray(raw)) {
    return { ok: false, error: 'count must be a single value' }
  }
  const str = String(raw).trim()
  if (str === '') return { ok: true, value: bounds.default }
  if (!/^-?\d+$/.test(str)) {
    return { ok: false, error: 'count must be an integer' }
  }
  const n = Number(str)
  if (n < bounds.min || n > bounds.max) {
    return { ok: false, error: `count must be between ${bounds.min} and ${bounds.max}` }
  }
  return { ok: true, value: n }
}

/**
 * Validates the `freshness` parameter against the supported enums.
 * Missing/empty values are allowed (no date filter); anything else is
 * rejected early so unknown values never reach the Serper adapter.
 */
export function validateFreshness(raw: unknown): ValidationResult<Freshness | undefined> {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, value: undefined }
  }
  if (Array.isArray(raw)) {
    return { ok: false, error: 'freshness must be a single value' }
  }
  const str = String(raw).trim()
  if (str === '') return { ok: true, value: undefined }
  if (!(FRESHNESS_VALUES as readonly string[]).includes(str)) {
    return { ok: false, error: `freshness must be one of: ${FRESHNESS_VALUES.join(', ')}` }
  }
  return { ok: true, value: str as Freshness }
}
