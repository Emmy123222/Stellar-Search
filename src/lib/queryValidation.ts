export const MAX_QUERY_LENGTH = 256

export type QueryValidation =
  | { ok: true; cleanQ: string }
  | { ok: false; error: string }

/** Shared, side-effect-free validation for Express and Vercel search routes. */
export function validateQuery(q: unknown): QueryValidation {
  if (typeof q !== 'string' || !q.trim()) {
    return { ok: false, error: 'Missing required parameter: q' }
  }
  if (q.length > MAX_QUERY_LENGTH) {
    return { ok: false, error: `Query too long. Maximum ${MAX_QUERY_LENGTH} characters.` }
  }
  const cleanQ = q.replace(/[\x00-\x1F\x7F]/g, '').trim()
  if (!cleanQ) return { ok: false, error: 'Query contains no valid characters.' }
  return { ok: true, cleanQ }
}
