export const MAX_QUERY_LENGTH = 256;

export function validateQuery(
  q: unknown,
): { ok: true; cleanQ: string } | { ok: false; error: string } {
  if (Array.isArray(q)) {
    return { ok: false, error: 'Multiple query parameters not allowed' };
  }
  
  if (typeof q !== 'string' || !q.trim()) {
    return { ok: false, error: 'Missing required parameter: q' };
  }
  
  if (q.length > MAX_QUERY_LENGTH) {
    return { ok: false, error: `Query too long. Maximum ${MAX_QUERY_LENGTH} characters.` };
  }
  
  // Strip null bytes and ASCII control characters (C0 + DEL) to prevent
  // log injection and odd Serper behavior.
  const cleanQ = q.replace(/[\x00-\x1F\x7F]/g, '').trim();
  
  if (!cleanQ) {
    return { ok: false, error: 'Query contains no valid characters.' };
  }
  
  return { ok: true, cleanQ };
}
