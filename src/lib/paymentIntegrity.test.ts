import { describe, it, expect, beforeEach } from "vitest";
import {
  extractPaymentIdentifier,
  consumePaymentPayload,
  isPaymentConsumed,
  cleanupExpiredPayments,
  resetConsumedPayments,
  resetIdempotentRequests,
  getConsumedPaymentsCount,
  decodePaymentReceipt,
  DEFAULT_PAYMENT_VALIDITY_WINDOW_MS,
  buildIdempotencyKey,
  beginIdempotentRequest,
  resolveIdempotentRequest,
} from "./paymentIntegrity";

describe("src/lib/paymentIntegrity — Replay Protection & Payload Tracking", () => {
  beforeEach(() => {
    resetConsumedPayments();
    resetIdempotentRequests();
  });

  describe("extractPaymentIdentifier", () => {
    it("returns null for null, undefined, or empty values", () => {
      expect(extractPaymentIdentifier(null)).toBeNull();
      expect(extractPaymentIdentifier(undefined)).toBeNull();
      expect(extractPaymentIdentifier("")).toBeNull();
      expect(extractPaymentIdentifier("   ")).toBeNull();
    });

    it("extracts explicit transactionHash from JSON object", () => {
      const id = extractPaymentIdentifier({ transactionHash: "tx_12345" });
      expect(id).toBe("tx:tx_12345");
    });

    it("extracts explicit txHash from base64 JSON header string", () => {
      const payload = Buffer.from(
        JSON.stringify({ txHash: "hash_abc" }),
      ).toString("base64");
      const id = extractPaymentIdentifier(payload);
      expect(id).toBe("tx:hash_abc");
    });

    it("extracts signature/id/nonce from parsed JSON", () => {
      expect(extractPaymentIdentifier({ signature: "sig_999" })).toBe(
        "tx:sig_999",
      );
      expect(extractPaymentIdentifier({ id: "id_777" })).toBe("tx:id_777");
      expect(extractPaymentIdentifier({ nonce: "nonce_555" })).toBe(
        "tx:nonce_555",
      );
    });

    it("falls back to SHA-256 hash for raw non-JSON header strings", () => {
      const rawHeader = "X-Payment-Signature-Raw-Token-Value";
      const id = extractPaymentIdentifier(rawHeader);
      expect(id).toMatch(/^hash:[a-f0-9]{64}$/);
    });

    it('produces identical identifier for same raw header string', () => {
      const rawHeader = 'X-Payment-Signature-Raw-Token-Value'
      expect(extractPaymentIdentifier(rawHeader)).toBe(extractPaymentIdentifier(rawHeader))
    })

    it('accepts a valid x402 receipt payload with schema, network, asset, amount, and 64-hex hash', () => {
      const validReceipt = {
        schema: 'x402.payment.receipt',
        network: 'stellar:testnet',
        asset: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
        amount: '10000',
        transactionHash: 'a'.repeat(64),
      }

      const decoded = decodePaymentReceipt(validReceipt, {
        network: 'stellar:testnet',
        asset: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
        amount: '10000',
      })

      expect(decoded.ok).toBe(true)
      if (decoded.ok) {
        expect(decoded.txHash).toBe('a'.repeat(64))
      }
    })

    it('rejects invalid receipt schema, mismatched network, wrong asset, wrong amount, or non-hex hash', () => {
      const invalidReceipts = [
        { schema: 'bad', network: 'stellar:testnet', asset: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA', amount: '10000', transactionHash: 'a'.repeat(64) },
        { schema: 'x402.payment.receipt', network: 'stellar:mainnet', asset: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA', amount: '10000', transactionHash: 'a'.repeat(64) },
        { schema: 'x402.payment.receipt', network: 'stellar:testnet', asset: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', amount: '10000', transactionHash: 'a'.repeat(64) },
        { schema: 'x402.payment.receipt', network: 'stellar:testnet', asset: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA', amount: '9999', transactionHash: 'a'.repeat(64) },
        { schema: 'x402.payment.receipt', network: 'stellar:testnet', asset: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA', amount: '10000', transactionHash: 'abc' },
      ]

      for (const receipt of invalidReceipts) {
        const decoded = decodePaymentReceipt(receipt, {
          network: 'stellar:testnet',
          asset: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
          amount: '10000',
        })
        expect(decoded.ok).toBe(false)
      }
    })
  })

  describe("consumePaymentPayload & isPaymentConsumed", () => {
    it("successfully consumes a fresh payment payload on first attempt", () => {
      const header = Buffer.from(
        JSON.stringify({ transactionHash: "tx_first" }),
      ).toString("base64");
      const result = consumePaymentPayload(header);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.paymentId).toBe("tx:tx_first");
      }
      expect(isPaymentConsumed(header)).toBe(true);
    });

    it("rejects a consumed payment payload on second attempt within validity window", () => {
      const header = Buffer.from(
        JSON.stringify({ transactionHash: "tx_replay" }),
      ).toString("base64");
      const first = consumePaymentPayload(header);
      expect(first.ok).toBe(true);

      const second = consumePaymentPayload(header);
      expect(second.ok).toBe(false);
      if (!second.ok) {
        expect(second.error).toBe("Payment payload already consumed");
        expect(second.paymentId).toBe("tx:tx_replay");
      }
    });

    it("rejects alternative base64 format representing the same transactionHash", () => {
      const jsonStr = JSON.stringify({ transactionHash: "tx_shared" });
      const headerBase64 = Buffer.from(jsonStr).toString("base64");
      const headerObject = { transactionHash: "tx_shared" };

      expect(consumePaymentPayload(headerBase64).ok).toBe(true);
      expect(consumePaymentPayload(headerObject).ok).toBe(false);
    });

    it("allows re-consumption after the validity window expires", () => {
      const header = Buffer.from(
        JSON.stringify({ transactionHash: "tx_expired" }),
      ).toString("base64");
      const t0 = 1000000;

      // Consume at t0
      const res1 = consumePaymentPayload(
        header,
        DEFAULT_PAYMENT_VALIDITY_WINDOW_MS,
        t0,
      );
      expect(res1.ok).toBe(true);

      // Reject at t0 + 299 seconds
      const res2 = consumePaymentPayload(
        header,
        DEFAULT_PAYMENT_VALIDITY_WINDOW_MS,
        t0 + 299 * 1000,
      );
      expect(res2.ok).toBe(false);

      // Allow at t0 + 301 seconds (expired)
      const res3 = consumePaymentPayload(
        header,
        DEFAULT_PAYMENT_VALIDITY_WINDOW_MS,
        t0 + 301 * 1000,
      );
      expect(res3.ok).toBe(true);
    });

    it("purges expired entries via cleanupExpiredPayments", () => {
      const h1 = { transactionHash: "tx_1" };
      const h2 = { transactionHash: "tx_2" };
      const t0 = 1000000;

      consumePaymentPayload(h1, 1000, t0); // expires at t0 + 1000
      consumePaymentPayload(h2, 5000, t0); // expires at t0 + 5000

      expect(getConsumedPaymentsCount()).toBe(2);

      cleanupExpiredPayments(t0 + 2000);
      expect(getConsumedPaymentsCount()).toBe(1);

      cleanupExpiredPayments(t0 + 6000);
      expect(getConsumedPaymentsCount()).toBe(0);
    });
  });

  describe("Idempotent request keys", () => {
    it("binds the same logical request to the same payer and params for retries", () => {
      const first = buildIdempotencyKey(
        "/search",
        "GABC",
        { q: "stellar", count: "5", freshness: "pw" },
        "same-key",
      );
      const second = buildIdempotencyKey(
        "/search",
        "GABC",
        { q: "stellar", count: "5", freshness: "pw" },
        "same-key",
      );
      const third = buildIdempotencyKey(
        "/search",
        "GXYZ",
        { q: "stellar", count: "5", freshness: "pw" },
        "same-key",
      );

      expect(first).toBe(second);
      expect(first).not.toBe(third);
    });

    it("returns the original response for repeated completed idempotency keys", () => {
      const key = buildIdempotencyKey(
        "/search",
        "GABC",
        { q: "stellar", count: "5" },
        "client-123",
      );
      const first = beginIdempotentRequest(
        "/search",
        "GABC",
        { q: "stellar", count: "5" },
        "client-123",
      );
      expect(first.duplicate).toBe(false);

      const payload = { results: [{ title: "ok" }], count: 1 };
      resolveIdempotentRequest(key, payload);

      const second = beginIdempotentRequest(
        "/search",
        "GABC",
        { q: "stellar", count: "5" },
        "client-123",
      );
      expect(second.duplicate).toBe(true);
      expect(second.record.value).toEqual(payload);
    });
  });

  describe("Concurrency Protection", () => {
    it("ensures only one request succeeds among parallel concurrent calls for the same payload", async () => {
      const header = Buffer.from(
        JSON.stringify({ transactionHash: "tx_concurrent" }),
      ).toString("base64");

      const attempts = Array.from({ length: 20 }, () =>
        Promise.resolve().then(() => consumePaymentPayload(header)),
      );

      const results = await Promise.all(attempts);

      const successes = results.filter((r) => r.ok);
      const failures = results.filter((r) => !r.ok);

      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(19);
    });
  });
});
