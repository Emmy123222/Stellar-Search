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

vi.mock('../src/lib/paymentIntegrity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/paymentIntegrity')>()
  return { ...actual, consumePaymentPayload: vi.fn(actual.consumePaymentPayload) }
})

import handler from './search'
import { resetConsumedPayments, consumePaymentPayload } from '../src/lib/paymentIntegrity'

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
    ;(consumePaymentPayload as any).mockClear()
    resetConsumedPayments()
    global.fetch = originalFetch
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
      query: { q: 'vercel' },
      headers: { 'x-payment': fakeTx },
    })

    await handler(req, res)
    expect(res._json.results).toHaveLength(1)
    expect(res._json.results[0].title).toBe('Valid Vercel Result')
    expect(res._json.results[0].url).toBe('https://vercel.com/docs')
  })

  it('distinguishes original, executed, and suggested query text when spelling is corrected', async () => {
    const fakeTx = Buffer.from(JSON.stringify({ transactionHash: 'tx_spelling_test' })).toString('base64')
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        searchParameters: { q: 'stellar blockchain' },
        searchInformation: { originalQuery: 'stelarr blockchan' },
        organic: [
          { title: 'Stellar', link: 'https://stellar.org', snippet: 'Blockchain' },
        ],
      }),
    } as any)

    const { req, res } = mockReqRes({
      method: 'GET',
      query: { q: 'stelarr blockchan' },
      headers: { 'x-payment': fakeTx },
    })

    await handler(req, res)
    expect(res._json.originalQuery).toBe('stelarr blockchan')
    expect(res._json.executedQuery).toBe('stellar blockchain')
    expect(res._json.suggestedQuery).toBe('stellar blockchain')
    expect(res._json.isCorrected).toBe(true)
    expect(res._json.query).toBe('stellar blockchain')
  })

  it('provides suggestedQuery when didYouMean is present without auto-correction', async () => {
    const fakeTx = Buffer.from(JSON.stringify({ transactionHash: 'tx_did_you_mean_test' })).toString('base64')
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        searchParameters: { q: 'stelarr blockchan' },
        spelling: { didYouMean: 'stellar blockchain' },
        organic: [
          { title: 'Stelarr Results', link: 'https://stellar.org/alt', snippet: 'Alt snippet' },
        ],
      }),
    } as any)

    const { req, res } = mockReqRes({
      method: 'GET',
      query: { q: 'stelarr blockchan' },
      headers: { 'x-payment': fakeTx },
    })

    await handler(req, res)
    expect(res._json.originalQuery).toBe('stelarr blockchan')
    expect(res._json.executedQuery).toBe('stelarr blockchan')
    expect(res._json.suggestedQuery).toBe('stellar blockchain')
    expect(res._json.isCorrected).toBe(false)
    expect(res._json.query).toBe('stelarr blockchan')
  })
})

// ─── Parameter validation matrix (issue #188) ────────────────────────────────

describe('api/search — parameter validation matrix (issue #188)', () => {
  let matrixCounter = 0
  const matrixTx = () => Buffer.from(JSON.stringify({ transactionHash: `tx_matrix_vercel_${++matrixCounter}` })).toString('base64')

  beforeEach(() => {
    vi.clearAllMocks()
    ;(consumePaymentPayload as any).mockClear()
    resetConsumedPayments()
  })

  const rejectCases: { label: string; query: Record<string, unknown>; error: RegExp }[] = [
    { label: 'count=0 (below min)', query: { q: 'stellar', count: '0' }, error: /count/ },
    { label: 'count=-1 (negative)', query: { q: 'stellar', count: '-1' }, error: /count/ },
    { label: 'count=21 (above max)', query: { q: 'stellar', count: '21' }, error: /count/ },
    { label: 'count=999 (above max)', query: { q: 'stellar', count: '999' }, error: /count/ },
    { label: 'count=abc (non-integer)', query: { q: 'stellar', count: 'abc' }, error: /integer/ },
    { label: 'count=1.5 (non-integer)', query: { q: 'stellar', count: '1.5' }, error: /integer/ },
    { label: 'count=1e3 (non-integer)', query: { q: 'stellar', count: '1e3' }, error: /integer/ },
    { label: 'count repeated (array)', query: { q: 'stellar', count: ['1', '2'] }, error: /single value/ },
    { label: 'freshness=day (unknown enum)', query: { q: 'stellar', freshness: 'day' }, error: /freshness/ },
    { label: 'freshness=1 (unknown enum)', query: { q: 'stellar', freshness: '1' }, error: /freshness/ },
    { label: 'freshness repeated (array)', query: { q: 'stellar', freshness: ['pd', 'pw'] }, error: /single value/ },
  ]

  for (const c of rejectCases) {
    it(`rejects ${c.label} early (400) without invoking payment or Serper adapters`, async () => {
      global.fetch = vi.fn()
      const { req, res } = mockReqRes({ method: 'GET', query: { q: 'stellar', ...c.query } })
      await handler(req, res)
      expect(res._status).toBe(400)
      expect(res._json.error).toMatch(c.error)
      expect(consumePaymentPayload).not.toHaveBeenCalled()
      expect(global.fetch).not.toHaveBeenCalled()
    })
  }

  it('rejects invalid count even with a payment header present (validation precedes payment)', async () => {
    global.fetch = vi.fn()
    const { req, res } = mockReqRes({
      method: 'GET',
      query: { q: 'stellar', count: 'nope' },
      headers: { 'x-payment': matrixTx() },
    })
    await handler(req, res)
    expect(res._status).toBe(400)
    expect(consumePaymentPayload).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('forwards the default count 5 when count is omitted', async () => {
    let capturedBody: any = null
    global.fetch = vi.fn().mockImplementation(async (_url: any, opts: any) => {
      capturedBody = JSON.parse(opts.body)
      return { ok: true, json: async () => ({ organic: [] }) } as any
    })
    const { req, res } = mockReqRes({ method: 'GET', query: { q: 'stellar' }, headers: { 'x-payment': matrixTx() } })
    await handler(req, res)
    expect(res._json.results).toEqual([])
    expect(capturedBody.num).toBe(5)
  })

  it('forwards count at min and max bounds', async () => {
    for (const count of ['1', '20']) {
      let capturedBody: any = null
      global.fetch = vi.fn().mockImplementation(async (_url: any, opts: any) => {
        capturedBody = JSON.parse(opts.body)
        return { ok: true, json: async () => ({ organic: [] }) } as any
      })
      const { req, res } = mockReqRes({ method: 'GET', query: { q: 'stellar', count }, headers: { 'x-payment': matrixTx() } })
      await handler(req, res)
      expect(res._json.results).toEqual([])
      expect(capturedBody.num).toBe(Number(count))
    }
  })

  it('forwards tbs for each supported freshness enum', async () => {
    for (const [freshness, tbs] of Object.entries({ pd: 'qdr:d', pw: 'qdr:w', pm: 'qdr:m' })) {
      let capturedBody: any = null
      global.fetch = vi.fn().mockImplementation(async (_url: any, opts: any) => {
        capturedBody = JSON.parse(opts.body)
        return { ok: true, json: async () => ({ organic: [] }) } as any
      })
      const { req, res } = mockReqRes({ method: 'GET', query: { q: 'stellar', freshness }, headers: { 'x-payment': matrixTx() } })
      await handler(req, res)
      expect(res._json.results).toEqual([])
      expect(capturedBody.tbs).toBe(tbs)
    }
  })
})


