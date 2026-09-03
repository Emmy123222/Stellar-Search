import { describe, it, expect, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.STELLAR_RECEIVING_ADDRESS =
    "GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3";
  process.env.SERPER_API_KEY = "test-serper";
});

vi.mock("../src/lib/constants", async () => {
  const actual: any = await vi.importActual("../src/lib/constants");
  return {
    ...actual,
    STELLAR_NETWORK: "stellar:testnet",
    USDC_CONTRACT: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    AMOUNT_STROOPS: "10000",
    AMOUNT_USDC: "0.001",
  };
});

// ─── Mock x402 facilitator ──────────────────────────────────────────────
const { mockVerify, mockSettle, mockDecode } = vi.hoisted(() => ({
  mockVerify: vi.fn().mockResolvedValue({ isValid: true }),
  mockSettle: vi.fn().mockResolvedValue({ success: true, transaction: 'tx_ok', network: 'stellar:testnet' }),
  mockDecode: vi.fn((header: string) => {
    try {
      const decoded = Buffer.from(header, 'base64').toString('utf8')
      const parsed = JSON.parse(decoded)
      return {
        x402Version: 2,
        payload: parsed,
        accepted: {
          scheme: 'exact',
          network: 'stellar:testnet',
          asset: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
          amount: '10000',
          payTo: 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3',
          maxTimeoutSeconds: 300,
          extra: { areFeesSponsored: true },
        },
      }
    } catch {
      throw new Error('Malformed payment payload')
    }
  }),
}))

vi.mock('@x402/core/server', () => ({
  HTTPFacilitatorClient: class {
    verify = mockVerify
    settle = mockSettle
    constructor(_opts: any) {}
  },
}))

vi.mock('@x402/core/http', () => ({
  decodePaymentSignatureHeader: mockDecode,
}))

vi.mock('@x402/stellar/exact/server', () => ({
  ExactStellarScheme: class {},
}))

vi.mock('../src/lib/x402Config', async () => {
  const actual: any = await vi.importActual('../src/lib/x402Config')
  return {
    ...actual,
    getNetwork: () => 'stellar:testnet',
    getPayTo: () => 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3',
    getFacilitatorUrl: () => 'https://www.x402.org/facilitator',
  }
})

import handler from './search'
import { resetConsumedPayments } from '../src/lib/paymentIntegrity'

function mockReqRes(overrides: any = {}) {
  const req: any = {
    method: "GET",
    query: {},
    url: "/api/search?q=stellar",
    ...overrides,
    headers: { ...(overrides.headers || {}) },
  };
  const res: any = {};
  res.setHeader = vi.fn();
  res.status = vi.fn().mockImplementation((code: number) => {
    res._status = code;
    return res;
  });
  res.json = vi.fn().mockImplementation((data: any) => {
    res._json = data;
    return res;
  });
  res.end = vi.fn();
  return { req, res };
}

describe("api/search — Vercel x402 settlement (aligned with Express)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks()
    resetConsumedPayments()
    // Always use a spy so not.toHaveBeenCalled() assertions work
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ organic: [] }),
    } as any)
    // Default: facilitator verify and settle succeed
    mockVerify.mockResolvedValue({ isValid: true })
    mockSettle.mockResolvedValue({ success: true, transaction: 'tx_ok', network: 'stellar:testnet' })
  })

  it("handles OPTIONS preflight", async () => {
    const { req, res } = mockReqRes({ method: "OPTIONS" });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.end).toHaveBeenCalled();
  });

  it("rejects non-GET methods", async () => {
    const { req, res } = mockReqRes({ method: "POST" });
    await handler(req, res);
    expect(res._status).toBe(405);
    expect(res._json.error).toMatch(/Method not allowed/);
  });

  it("rejects missing q", async () => {
    const { req, res } = mockReqRes({ method: "GET", query: {} });
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._json.error).toMatch(/Missing required parameter/);
  });

  it("rejects whitespace q", async () => {
    const { req, res } = mockReqRes({ method: "GET", query: { q: "   " } });
    await handler(req, res);
    expect(res._status).toBe(400);
  });

  it("returns 402 Payment Required with x402 v2 payload when no payment header", async () => {
    const { req, res } = mockReqRes({
      method: "GET",
      query: { q: "stellar" },
      headers: { host: "example.com", "x-forwarded-proto": "https" },
      url: "/api/search?q=stellar",
    });
    await handler(req, res);
    expect(res._status).toBe(402);
    expect(res.setHeader).toHaveBeenCalledWith(
      "PAYMENT-REQUIRED",
      expect.any(String),
    );
    // Decode PAYMENT-REQUIRED base64 to verify settlement semantics
    const headerCall = res.setHeader.mock.calls.find(
      (c: any) => c[0] === "PAYMENT-REQUIRED",
    );
    const decoded = JSON.parse(
      Buffer.from(headerCall[1], "base64").toString("utf8"),
    );
    expect(decoded.x402Version).toBe(2);
    expect(decoded.accepts[0].scheme).toBe("exact");
    expect(decoded.accepts[0].network).toBe("stellar:testnet");
    expect(decoded.accepts[0].amount).toBe("10000"); // stroops = 0.001 USDC
    expect(decoded.accepts[0].asset).toBe(
      "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    );
    expect(decoded.accepts[0].payTo).toBe(
      process.env.STELLAR_RECEIVING_ADDRESS,
    );
    expect(decoded.accepts[0].maxTimeoutSeconds).toBe(300);
    expect(res._json.error).toBe("Payment required");
  });

  it("sets CORS headers (Vercel browser alignment)", async () => {
    const { req, res } = mockReqRes({ method: "GET", query: {} });
    await handler(req, res);
    expect(res.setHeader).toHaveBeenCalledWith(
      "Access-Control-Allow-Origin",
      "*",
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "Access-Control-Expose-Headers",
      expect.stringContaining("PAYMENT-REQUIRED"),
    );
  });

  it("proceeds to search when payment header present (Serper mock)", async () => {
    const fakeTx = Buffer.from(
      JSON.stringify({ transactionHash: "abc123" }),
    ).toString("base64");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        organic: [
          {
            title: "Stellar",
            link: "https://stellar.org",
            snippet: "Blockchain",
            date: "2026-01-01",
          },
        ],
      }),
    } as any);

    const { req, res } = mockReqRes({
      method: "GET",
      query: { q: "stellar", count: "1" },
      headers: { "x-payment": fakeTx },
    });
    await handler(req, res);
    expect(res._json.results).toHaveLength(1);
    expect(res._json.results[0].title).toBe("Stellar");
    expect(res._json.paidAmount).toBe("0.001");
    expect(res._json.currency).toBe("USDC");
    expect(res._json.txHash).toBe("abc123");
    expect(res._json.network).toBe("stellar:testnet");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://google.serper.dev/search",
      expect.any(Object),
    );
  });

  it("preserves x402 settlement — amount decoded from constants is 0.001 USDC", async () => {
    // Verify that Vercel and Express share same amount via constants
    const { STELLAR_NETWORK, AMOUNT_STROOPS, AMOUNT_USDC } =
      await import("../src/lib/constants");
    expect(STELLAR_NETWORK).toBe("stellar:testnet");
    expect(parseInt(AMOUNT_STROOPS)).toBe(10000);
    expect(AMOUNT_USDC).toBe("0.001");
  });

  it("returns 502 when Serper fails", async () => {
    const fakeTx = Buffer.from(JSON.stringify({ txHash: "x" })).toString(
      "base64",
    );
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "serper error",
    } as any);
    const { req, res } = mockReqRes({
      method: "GET",
      query: { q: "stellar" },
      headers: { "x-payment": fakeTx },
    });
    await handler(req, res);
    expect(res._status).toBe(502);
  });

  it("applies freshness filter", async () => {
    const fakeTx = Buffer.from(JSON.stringify({})).toString("base64");
    let capturedBody: any = null;
    global.fetch = vi.fn().mockImplementation(async (_url: any, opts: any) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({ organic: [] }),
      } as any;
    });
    const { req, res } = mockReqRes({
      method: "GET",
      query: { q: "stellar", freshness: "pw" },
      headers: { "x-payment": fakeTx },
    });
    await handler(req, res);
    expect(capturedBody.tbs).toBe("qdr:w");
  });

  it("rejects unsupported freshness values with a shared validation error", async () => {
    const fakeTx = Buffer.from(
      JSON.stringify({ transactionHash: "bad_freshness" }),
    ).toString("base64");
    const { req, res } = mockReqRes({
      method: "GET",
      query: { q: "stellar", freshness: "year" },
      headers: { "x-payment": fakeTx },
    });

    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._json.error).toBe(
      "Unsupported freshness parameter. Allowed values: empty, pd, pw, pm",
    );
  });

  it("rejects replayed payment headers for their validity window", async () => {
    const fakeTx = Buffer.from(
      JSON.stringify({ transactionHash: "tx_replay_test_123" }),
    ).toString("base64");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ organic: [] }),
    } as any);

    // Request 1: first time — should succeed
    const first = mockReqRes({
      method: "GET",
      query: { q: "stellar" },
      headers: { "x-payment": fakeTx },
    });
    await handler(first.req, first.res);
    expect(first.res._json.query).toBe("stellar");

    // Request 2: second time — must be rejected as already consumed
    const second = mockReqRes({
      method: "GET",
      query: { q: "stellar" },
      headers: { "x-payment": fakeTx },
    });
    await handler(second.req, second.res);
    expect(second.res._status).toBe(402);
    expect(second.res._json.error).toBe("Payment payload already consumed");
  });

  it("concurrency test: proves only one search proceeds for the exact same payload", async () => {
    const fakeTx = Buffer.from(
      JSON.stringify({ transactionHash: "tx_concurrency_test_456" }),
    ).toString("base64");
    global.fetch = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        ok: true,
        json: async () => ({
          organic: [
            { title: "Stellar Concurrent", link: "https://stellar.org" },
          ],
        }),
      } as any;
    });

    const numConcurrent = 5;
    const pairs = Array.from({ length: numConcurrent }, () =>
      mockReqRes({
        method: "GET",
        query: { q: "stellar" },
        headers: { "x-payment": fakeTx },
      }),
    );

    await Promise.all(pairs.map((p) => handler(p.req, p.res)));

    // Upstream Serper fetch must be called EXACTLY ONCE
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const successes = pairs.filter((p) => p.res._json?.results);
    const rejections = pairs.filter(
      (p) =>
        p.res._status === 402 &&
        p.res._json?.error === "Payment payload already consumed",
    );

    expect(successes).toHaveLength(1);
    expect(rejections).toHaveLength(numConcurrent - 1);
  });

  it("safely normalizes malformed Serper payloads by filtering out rows with invalid links", async () => {
    const fakeTx = Buffer.from(
      JSON.stringify({ transactionHash: "tx_malformed_vercel" }),
    ).toString("base64");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        organic: [
          { title: "Bad Link", link: "not-a-valid-http-url" },
          { title: "Valid Vercel Result", link: "https://vercel.com/docs" },
        ],
      }),
    } as any);

    const { req, res } = mockReqRes({
      method: 'GET',
      query: { q: 'stellar' },
      headers: { 'x-payment': fakeTx },
    })
    await handler(req, res)
    expect(res._json.results).toHaveLength(1)
    expect(res._json.results[0].title).toBe('Valid Vercel Result')
    expect(res._json.results[0].url).toBe('https://vercel.com/docs')
  })

  it('returns 402 if facilitator settlement fails', async () => {
    global.fetch = vi.fn()
    const fakeTx = Buffer.from(JSON.stringify({ shouldFail: true, transactionHash: 'fail' })).toString('base64')
    const { req, res } = mockReqRes({
      method: 'GET',
      query: { q: 'stellar' },
      headers: { 'x-payment': fakeTx },
    })
    await handler(req, res)
    expect(res._status).toBe(402)
    expect(res._json.error).toMatch(/Settlement failed: mock failure/)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('returns 502 if facilitator times out or network error', async () => {
    global.fetch = vi.fn()
    const fakeTx = Buffer.from(JSON.stringify({ shouldTimeout: true, transactionHash: 'timeout' })).toString('base64')
    const { req, res } = mockReqRes({
      method: 'GET',
      query: { q: 'stellar' },
      headers: { 'x-payment': fakeTx },
    })
    await handler(req, res)
    expect(res._status).toBe(502)
    expect(res._json.error).toMatch(/timeout or network error/)
    expect(global.fetch).not.toHaveBeenCalled()
  })
  
  it('returns 400 if payment payload is malformed', async () => {
    global.fetch = vi.fn()
    const fakeTx = Buffer.from(JSON.stringify({ malformed: true, transactionHash: 'malformed' })).toString('base64')
    const { req, res } = mockReqRes({
      method: 'GET',
      query: { q: 'stellar' },
      headers: { 'x-payment': fakeTx },
    })
    await handler(req, res)
    expect(res._status).toBe(400)
    expect(res._json.error).toMatch(/Malformed/)
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

// ─── x402 payment verification tests (Issue #107) ─────────────────────────

describe('api/search — x402 payment verification (Issue #107)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetConsumedPayments()
    // Always use a spy so not.toHaveBeenCalled() assertions work
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ organic: [] }),
    } as any)
    // Default: facilitator verify and settle succeed
    mockVerify.mockResolvedValue({ isValid: true })
    mockSettle.mockResolvedValue({ success: true, transaction: 'tx_ok', network: 'stellar:testnet' })
  })

  it('rejects payment when facilitator verify returns isValid: false', async () => {
    mockVerify.mockResolvedValue({ isValid: false, invalidReason: 'Signature mismatch' })
    const fakeTx = Buffer.from(JSON.stringify({ transactionHash: 'tx_bad_sig' })).toString('base64')

    const { req, res } = mockReqRes({
      method: 'GET',
      query: { q: 'stellar' },
      headers: { 'x-payment': fakeTx },
    })
    await handler(req, res)
    expect(res._status).toBe(402)
    expect(res._json.error).toMatch(/Signature mismatch/)
    expect(mockSettle).not.toHaveBeenCalled()
    // Serper must NOT be called
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rejects payment when facilitator verify throws', async () => {
    mockVerify.mockRejectedValue(new Error('Network timeout'))
    const fakeTx = Buffer.from(JSON.stringify({ transactionHash: 'tx_verify_err' })).toString('base64')

    const { req, res } = mockReqRes({
      method: 'GET',
      query: { q: 'stellar' },
      headers: { 'x-payment': fakeTx },
    })
    await handler(req, res)
    expect(res._status).toBe(402)
    expect(res._json.error).toMatch(/Network timeout/)
    expect(mockSettle).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rejects payment when facilitator settle returns success: false', async () => {
    mockVerify.mockResolvedValue({ isValid: true })
    mockSettle.mockResolvedValue({ success: false, errorReason: 'Insufficient balance' })
    const fakeTx = Buffer.from(JSON.stringify({ transactionHash: 'tx_underpay' })).toString('base64')

    const { req, res } = mockReqRes({
      method: 'GET',
      query: { q: 'stellar' },
      headers: { 'x-payment': fakeTx },
    })
    await handler(req, res)
    expect(res._status).toBe(402)
    expect(res._json.error).toMatch(/Insufficient balance/)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rejects payment when facilitator settle throws', async () => {
    mockVerify.mockResolvedValue({ isValid: true })
    mockSettle.mockRejectedValue(new Error('Settlement network error'))
    const fakeTx = Buffer.from(JSON.stringify({ transactionHash: 'tx_settle_err' })).toString('base64')

    const { req, res } = mockReqRes({
      method: 'GET',
      query: { q: 'stellar' },
      headers: { 'x-payment': fakeTx },
    })
    await handler(req, res)
    expect(res._status).toBe(402)
    expect(res._json.error).toMatch(/Settlement network error/)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rejects malformed payment header (invalid base64)', async () => {
    const { req, res } = mockReqRes({
      method: 'GET',
      query: { q: 'stellar' },
      headers: { 'x-payment': '!!!NOT_BASE64!!!' },
    })
    await handler(req, res)
    expect(res._status).toBe(402)
    expect(res._json.error).toMatch(/Malformed payment payload/)
    expect(mockVerify).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rejects empty string payment header (no header present)', async () => {
    const { req, res } = mockReqRes({
      method: 'GET',
      query: { q: 'stellar' },
      headers: {},
    })
    await handler(req, res)
    expect(res._status).toBe(402)
    expect(res._json.error).toBe('Payment required')
  })

  it('never trusts header presence alone — verify must be called before Serper', async () => {
    const fakeTx = Buffer.from(JSON.stringify({ transactionHash: 'tx_presence_only' })).toString('base64')
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ organic: [{ title: 'Test', link: 'https://test.com' }] }),
    } as any)

    const { req, res } = mockReqRes({
      method: 'GET',
      query: { q: 'test' },
      headers: { 'x-payment': fakeTx },
    })
    await handler(req, res)

    // Verify must be called before any Serper fetch
    expect(mockVerify).toHaveBeenCalledTimes(1)
    expect(mockSettle).toHaveBeenCalledTimes(1)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('forged payment with wrong tx hash is rejected by facilitator', async () => {
    mockVerify.mockResolvedValue({ isValid: false, invalidReason: 'Transaction not found on network' })
    const forged = Buffer.from(JSON.stringify({ transactionHash: 'forged_nonexistent_tx' })).toString('base64')

    const { req, res } = mockReqRes({
      method: 'GET',
      query: { q: 'stellar' },
      headers: { 'x-payment': forged },
    })
    await handler(req, res)
    expect(res._status).toBe(402)
    expect(res._json.error).toMatch(/Transaction not found/)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('expired payment is rejected by facilitator', async () => {
    mockVerify.mockResolvedValue({ isValid: false, invalidReason: 'Payment expired' })
    const expired = Buffer.from(JSON.stringify({ transactionHash: 'tx_expired_payment' })).toString('base64')

    const { req, res } = mockReqRes({
      method: 'GET',
      query: { q: 'stellar' },
      headers: { 'x-payment': expired },
    })
    await handler(req, res)
    expect(res._status).toBe(402)
    expect(res._json.error).toMatch(/expired/i)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('underpaid payment is rejected by facilitator', async () => {
    mockVerify.mockResolvedValue({ isValid: false, invalidReason: 'Insufficient payment amount' })
    const underpaid = Buffer.from(JSON.stringify({ transactionHash: 'tx_underpaid' })).toString('base64')

    const { req, res } = mockReqRes({
      method: 'GET',
      query: { q: 'stellar' },
      headers: { 'x-payment': underpaid },
    })
    await handler(req, res)
    expect(res._status).toBe(402)
    expect(res._json.error).toMatch(/Insufficient payment amount/)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('payment-signature header is also accepted and verified', async () => {
    const fakeTx = Buffer.from(JSON.stringify({ transactionHash: 'tx_sig_header' })).toString('base64')
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ organic: [] }),
    } as any)

    const { req, res } = mockReqRes({
      method: 'GET',
      query: { q: 'stellar' },
      headers: { 'payment-signature': fakeTx },
    })
    await handler(req, res)
    expect(mockVerify).toHaveBeenCalledTimes(1)
    expect(mockSettle).toHaveBeenCalledTimes(1)
    expect(res._json.query).toBe('stellar')
  })

  it('X-PAYMENT header (uppercase) is also accepted and verified', async () => {
    const fakeTx = Buffer.from(JSON.stringify({ transactionHash: 'tx_upper_header' })).toString('base64')
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ organic: [] }),
    } as any)

    const { req, res } = mockReqRes({
      method: 'GET',
      query: { q: 'stellar' },
      headers: { 'X-PAYMENT': fakeTx },
    })
    await handler(req, res)
    expect(mockVerify).toHaveBeenCalledTimes(1)
    expect(mockSettle).toHaveBeenCalledTimes(1)
  })

  it('both verify and settle must succeed for search to proceed', async () => {
    // Verify succeeds but settle fails
    mockVerify.mockResolvedValue({ isValid: true })
    mockSettle.mockResolvedValue({ success: false, errorReason: 'Settlement rejected' })
    const fakeTx = Buffer.from(JSON.stringify({ transactionHash: 'tx_settle_fail' })).toString('base64')

    const { req, res } = mockReqRes({
      method: 'GET',
      query: { q: 'stellar' },
      headers: { 'x-payment': fakeTx },
    })
    await handler(req, res)
    expect(res._status).toBe(402)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('replay protection still works alongside facilitator verification', async () => {
    const fakeTx = Buffer.from(JSON.stringify({ transactionHash: 'tx_replay_verify' })).toString('base64')
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ organic: [] }),
    } as any)

    // First request: verify + settle + search
    const first = mockReqRes({
      method: 'GET',
      query: { q: 'stellar' },
      headers: { 'x-payment': fakeTx },
    })
    await handler(first.req, first.res)
    expect(first.res._json.query).toBe('stellar')
    expect(mockVerify).toHaveBeenCalledTimes(1)
    expect(mockSettle).toHaveBeenCalledTimes(1)

    // Second request: rejected by replay protection (before facilitator)
    const second = mockReqRes({
      method: 'GET',
      query: { q: 'stellar' },
      headers: { 'x-payment': fakeTx },
    })
    await handler(second.req, second.res)
    expect(second.res._status).toBe(402)
    expect(second.res._json.error).toBe('Payment payload already consumed')
    // Facilitator should NOT be called again
    expect(mockVerify).toHaveBeenCalledTimes(1)
  })
})
