import crypto from "crypto";

/**
 * Default validity window for consumed payment payloads in milliseconds.
 * Aligned with x402 maxTimeoutSeconds (300 seconds = 5 minutes).
 */
export const DEFAULT_PAYMENT_VALIDITY_WINDOW_MS = 300 * 1000;

export interface ConsumedPayment {
  consumedAt: number;
  expiresAt: number;
}

export interface IdempotentRequestRecord<T = unknown> {
  key: string;
  route: string;
  payer: string;
  paramsKey: string;
  createdAt: number;
  expiresAt: number;
  status: "pending" | "resolved";
  promise?: Promise<T>;
  value?: T;
  resolve?: (value: T) => void;
  reject?: (error: unknown) => void;
}

// In-memory store for consumed payment identifiers and their expiration timestamps
const consumedPayments = new Map<string, ConsumedPayment>();
const idempotentRequests = new Map<string, IdempotentRequestRecord>();

/**
 * Periodically purge expired payment entries to prevent memory leaks.
 */
export function cleanupExpiredPayments(now: number = Date.now()): void {
  for (const [id, record] of consumedPayments.entries()) {
    if (record.expiresAt <= now) {
      consumedPayments.delete(id);
    }
  }
  clearExpiredIdempotentRequests(now);
}

/**
 * Resets the consumed payment store. Essential for clean test isolation.
 */
export function resetConsumedPayments(): void {
  consumedPayments.clear();
}

export function resetIdempotentRequests(): void {
  idempotentRequests.clear();
}

/**
 * Returns the current size of the consumed payments cache (useful for diagnostic tests).
 */
export function getConsumedPaymentsCount(): number {
  return consumedPayments.size;
}

export function getIdempotentRequestCount(): number {
  return idempotentRequests.size;
}

export function normalizeIdempotencyKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function buildIdempotencyKey(
  route: string,
  payer: string,
  params: Record<string, unknown>,
  providedKey?: string,
): string {
  const safeRoute = String(route || "").trim();
  const safePayer = String(payer || "").trim();
  const supplied = normalizeIdempotencyKey(providedKey) ?? "generated";
  const normalizedParams = Object.fromEntries(
    Object.entries(params)
      .filter(
        ([, value]) =>
          value !== undefined && value !== null && String(value).trim() !== "",
      )
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, String(value).trim()]),
  );

  const payload = `${safeRoute}|${safePayer}|${supplied}|${JSON.stringify(normalizedParams)}`;
  return `idem:${crypto.createHash("sha256").update(payload).digest("hex")}`;
}

export function getIdempotencyHeaderValue(
  headers: Record<string, string | string[] | undefined>,
): string | null {
  const candidates = [
    "idempotency-key",
    "x-idempotency-key",
    "x-payment-idempotency-key",
  ];

  for (const headerName of candidates) {
    const value = headers[headerName];
    if (Array.isArray(value)) {
      const first = value.find(Boolean);
      if (first) return normalizeIdempotencyKey(first);
    }
    if (typeof value === "string") {
      const normalized = normalizeIdempotencyKey(value);
      if (normalized) return normalized;
    }
  }

  return null;
}

export function beginIdempotentRequest<T>(
  route: string,
  payer: string,
  params: Record<string, unknown>,
  providedKey?: string,
  now: number = Date.now(),
  validityWindowMs: number = DEFAULT_PAYMENT_VALIDITY_WINDOW_MS,
): {
  ok: true;
  duplicate: boolean;
  key: string;
  record: IdempotentRequestRecord<T>;
} {
  const key = buildIdempotencyKey(route, payer, params, providedKey);
  const existing = idempotentRequests.get(key);

  if (existing && existing.expiresAt > now) {
    return {
      ok: true,
      duplicate: true,
      key,
      record: existing as IdempotentRequestRecord<T>,
    };
  }

  const record: IdempotentRequestRecord<T> = {
    key,
    route,
    payer,
    paramsKey: JSON.stringify(
      Object.fromEntries(
        Object.entries(params)
          .filter(
            ([, value]) =>
              value !== undefined &&
              value !== null &&
              String(value).trim() !== "",
          )
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => [key, String(value).trim()]),
      ),
    ),
    createdAt: now,
    expiresAt: now + validityWindowMs,
    status: "pending",
  };

  idempotentRequests.set(key, record);
  return { ok: true, duplicate: false, key, record };
}

export function resolveIdempotentRequest<T>(
  key: string,
  value: T,
  now: number = Date.now(),
  validityWindowMs: number = DEFAULT_PAYMENT_VALIDITY_WINDOW_MS,
): void {
  const record = idempotentRequests.get(key);
  if (!record) return;

  record.status = "resolved";
  record.value = value;
  record.expiresAt = now + validityWindowMs;
  record.resolve?.(value);
}

export function rejectIdempotentRequest<T>(key: string, error: unknown): void {
  const record = idempotentRequests.get(key);
  if (!record) return;
  record.reject?.(error);
}

export function getIdempotentResult<T>(key: string): T | undefined {
  const record = idempotentRequests.get(key);
  return record?.value as T | undefined;
}

export function clearExpiredIdempotentRequests(now: number = Date.now()): void {
  for (const [key, record] of idempotentRequests.entries()) {
    if (record.expiresAt <= now) {
      idempotentRequests.delete(key);
    }
  }
}

/**
 * Extracts a unique, deterministic payment identifier from a payment header string or object.
 *
 * Checks if the header contains structured JSON with a transaction hash/id/signature.
 * If no explicit ID field is found, computes a SHA-256 hash of the normalized header string.
 */
export function extractPaymentIdentifier(header: unknown): string | null {
  if (!header || (typeof header !== "string" && typeof header !== "object")) {
    return null;
  }

  const rawString =
    typeof header === "string" ? header.trim() : JSON.stringify(header);
  if (!rawString) return null;

  // 1. Try parsing JSON (or base64-decoded JSON)
  let obj: any = null;
  if (typeof header === "object") {
    obj = header;
  } else {
    try {
      obj = JSON.parse(rawString);
    } catch {
      try {
        const decoded = Buffer.from(rawString, "base64").toString("utf8");
        obj = JSON.parse(decoded);
      } catch {
        // Raw non-JSON string
      }
    }
  }

  if (obj && typeof obj === "object") {
    const explicitId =
      obj.transactionHash ||
      obj.txHash ||
      obj.transaction_hash ||
      obj.signature ||
      obj.id ||
      obj.nonce ||
      obj.paymentId;
    if (typeof explicitId === "string" && explicitId.trim()) {
      return `tx:${explicitId.trim()}`;
    }
  }

  // 2. Fallback: SHA-256 hash of the raw header string
  const hash = crypto.createHash("sha256").update(rawString).digest("hex");
  return `hash:${hash}`;
}

/**
 * Attempts to consume a payment identifier for its validity window.
 * Returns { ok: true, paymentId } if the payment payload was successfully consumed (first time).
 * Returns { ok: false, error, paymentId } if the payment payload has already been consumed within its validity window.
 */
export function consumePaymentPayload(
  header: unknown,
  validityWindowMs: number = DEFAULT_PAYMENT_VALIDITY_WINDOW_MS,
  now: number = Date.now(),
):
  | { ok: true; paymentId: string }
  | { ok: false; error: string; paymentId: string | null } {
  cleanupExpiredPayments(now);

  const paymentId = extractPaymentIdentifier(header);
  if (!paymentId) {
    return {
      ok: false,
      error: "Invalid or missing payment header",
      paymentId: null,
    };
  }

  const existing = consumedPayments.get(paymentId);
  if (existing && existing.expiresAt > now) {
    return { ok: false, error: "Payment payload already consumed", paymentId };
  }

  // Atomically mark as consumed
  consumedPayments.set(paymentId, {
    consumedAt: now,
    expiresAt: now + validityWindowMs,
  });

  return { ok: true, paymentId };
}

/**
 * Returns whether a payment identifier is currently marked as consumed within its validity window.
 */
export function isPaymentConsumed(
  header: unknown,
  now: number = Date.now(),
): boolean {
  cleanupExpiredPayments(now);
  const paymentId = extractPaymentIdentifier(header);
  if (!paymentId) return false;
  const existing = consumedPayments.get(paymentId);
  return !!(existing && existing.expiresAt > now);
}
