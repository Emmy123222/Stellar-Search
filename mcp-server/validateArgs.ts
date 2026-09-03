/**
 * Runtime argument validation for MCP tool calls.
 *
 * Validates required fields, types, enums, and bounds before any tool
 * handler reaches network providers or payment settlement.
 */

export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Return the error string on the first validation failure, or null if valid.
 */
export function validateWebSearchArgs(
  args: Record<string, unknown> | undefined,
): string | null {
  if (!args || typeof args !== 'object') return 'Missing arguments object';

  const { query, count, freshness } = args as Record<string, unknown>;

  // query: required string, non-empty
  if (typeof query !== 'string' || query.trim().length === 0) {
    return 'query is required and must be a non-empty string';
  }

  // count: optional number in [1, 10]
  if (count !== undefined && count !== null) {
    const n = Number(count);
    if (!Number.isFinite(n) || n !== Math.floor(n)) {
      return 'count must be an integer';
    }
    if (n < 1 || n > 10) {
      return 'count must be between 1 and 10';
    }
  }

  // freshness: optional enum
  if (freshness !== undefined && freshness !== null) {
    if (typeof freshness !== 'string') {
      return 'freshness must be a string';
    }
    const allowed = ['pd', 'pw', 'pm'];
    if (!allowed.includes(freshness)) {
      return `freshness must be one of: ${allowed.join(', ')}`;
    }
  }

  return null;
}

export function validateImageSearchArgs(
  args: Record<string, unknown> | undefined,
): string | null {
  if (!args || typeof args !== 'object') return 'Missing arguments object';

  const { query, count } = args as Record<string, unknown>;

  if (typeof query !== 'string' || query.trim().length === 0) {
    return 'query is required and must be a non-empty string';
  }

  if (count !== undefined && count !== null) {
    const n = Number(count);
    if (!Number.isFinite(n) || n !== Math.floor(n)) {
      return 'count must be an integer';
    }
    if (n < 1 || n > 10) {
      return 'count must be between 1 and 10';
    }
  }

  return null;
}

export function validateNewsSearchArgs(
  args: Record<string, unknown> | undefined,
): string | null {
  if (!args || typeof args !== 'object') return 'Missing arguments object';

  const { query, count, freshness } = args as Record<string, unknown>;

  if (typeof query !== 'string' || query.trim().length === 0) {
    return 'query is required and must be a non-empty string';
  }

  if (count !== undefined && count !== null) {
    const n = Number(count);
    if (!Number.isFinite(n) || n !== Math.floor(n)) {
      return 'count must be an integer';
    }
    if (n < 1 || n > 20) {
      return 'count must be between 1 and 20';
    }
  }

  if (freshness !== undefined && freshness !== null) {
    if (typeof freshness !== 'string') {
      return 'freshness must be a string';
    }
    const allowed = ['pd', 'pw', 'pm'];
    if (!allowed.includes(freshness)) {
      return `freshness must be one of: ${allowed.join(', ')}`;
    }
  }

  return null;
}

export function validateAiSummarizeArgs(
  args: Record<string, unknown> | undefined,
): string | null {
  if (!args || typeof args !== 'object') return 'Missing arguments object';

  const { text } = args as Record<string, unknown>;

  if (typeof text !== 'string' || text.trim().length === 0) {
    return 'text is required and must be a non-empty string';
  }

  return null;
}

export function validateCheckBalanceArgs(
  args: Record<string, unknown> | undefined,
): string | null {
  if (!args || typeof args !== 'object') return 'Missing arguments object';

  const { address } = args as Record<string, unknown>;

  if (typeof address !== 'string' || address.length === 0) {
    return 'address is required and must be a non-empty string';
  }

  // Stellar public keys start with G and are 56 characters
  if (!/^G[A-Z0-9]{55}$/.test(address)) {
    return 'address must be a valid Stellar public key (56 characters starting with G)';
  }

  return null;
}
