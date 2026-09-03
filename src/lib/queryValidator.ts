// Environment-agnostic validation for the user-supplied `q` search parameter.
// Shared by the Express server (server/index.ts) and the Vercel serverless
// handler (api/search.ts) so both runtimes enforce identical rules and
// return identical status codes / cleaned queries for the same input.

export const MAX_QUERY_LENGTH = 256

export type QueryValidationResult =
  | { ok: true; cleanQ: string }
  | { ok: false; error: string }

// Validate and sanitize the user-supplied `q` parameter. Returns either the
// cleaned string or an error message to send back as a 400 response.
export function validateQuery(q: unknown): QueryValidationResult {
  if (typeof q !== 'string' || !q.trim()) {
    return { ok: false, error: 'Missing required parameter: q' }
  }
  if (q.length > MAX_QUERY_LENGTH) {
    return { ok: false, error: `Query too long. Maximum ${MAX_QUERY_LENGTH} characters.` }
  }
  // Strip null bytes and ASCII control characters (C0 + DEL) to prevent
  // log injection and odd upstream search-provider behavior.
  const cleanQ = q.replace(/[\x00-\x1F\x7F]/g, '').trim()
  if (!cleanQ) {
    return { ok: false, error: 'Query contains no valid characters.' }
  }
  return { ok: true, cleanQ }
}
