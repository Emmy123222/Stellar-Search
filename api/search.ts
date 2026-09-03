import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  STELLAR_NETWORK,
  USDC_CONTRACT,
  AMOUNT_STROOPS,
  AMOUNT_USDC,
  assertValidStellarConfig,
} from '../src/lib/constants'
import { consumePaymentPayload, decodePaymentReceipt } from '../src/lib/paymentIntegrity'
import { normalizeOrganicResults } from '../src/lib/serperNormalizer'
import { consumePaymentPayload } from '../src/lib/paymentIntegrity'
import { normalizeOrganicResults, normalizeQueryMetadata } from '../src/lib/serperNormalizer'
import { fetchSerper, CircuitOpenError } from '../src/lib/serperClient'
import type { SearchResponse, ApiErrorResponse } from '../src/types/index.js'
import { formatConfigurationError, readServerConfig } from '../src/lib/config'
import { applyServerlessHeaders } from '../src/lib/serverlessHeaders'

// ─── Config ───────────────────────────────────────────────────────────────
const RECEIVING_ADDRESS = process.env.STELLAR_RECEIVING_ADDRESS ?? ''
const NETWORK           = (process.env.STELLAR_NETWORK ?? STELLAR_NETWORK) as 'stellar:testnet' | 'stellar:mainnet'
const SERPER_API_KEY    = process.env.SERPER_API_KEY!

assertValidStellarConfig({
  STELLAR_NETWORK: NETWORK,
  STELLAR_RECEIVING_ADDRESS: RECEIVING_ADDRESS,
})

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyServerlessHeaders(res)

  // ─── CORS ─────────────────────────────────────────────────────────────────
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    [
      "Content-Type",
      "Authorization",
      "X-Payment",
      "payment-signature",
      "x-payment",
      "X-PAYMENT",
    ].join(", "),
  );
  res.setHeader(
    "Access-Control-Expose-Headers",
    ["PAYMENT-REQUIRED", "X-Payment-Response"].join(", "),
  );

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    const errorBody: ApiErrorResponse = { error: "Method not allowed" };
    return res.status(405).json(errorBody);
  }

  const { q } = req.query as Record<string, string>

  const validation = validateQuery(q)
  if (!validation.ok) {
    const errorBody: ApiErrorResponse = { error: validation.error }
    return res.status(400).json(errorBody)
  }
  const cleanQ = validation.cleanQ

  // ─── Parameter validation (#188) ─────────────────────────────────────────
  // Runs BEFORE the 402 challenge and the replay check, matching Express:
  // a request the server would refuse anyway never reaches the payment
  // adapter, so the caller is neither charged nor handed a payment challenge.
  const validatedCount = validateCount(req.query.count, SEARCH_COUNT)
  if (!validatedCount.ok) {
    const errorBody: ApiErrorResponse = { error: validatedCount.error }
    return res.status(400).json(errorBody)
  }
  const validatedFreshness = validateFreshness(req.query.freshness)
  if (!validatedFreshness.ok) {
    const errorBody: ApiErrorResponse = { error: validatedFreshness.error }
    return res.status(400).json(errorBody)
  }
  const count = validatedCount.value
  const tbs = validatedFreshness.value ? FRESHNESS_TBS[validatedFreshness.value] : undefined

  const freshnessValidation = validateFreshness(freshness);
  if (!freshnessValidation.ok) {
    const errorBody: ApiErrorResponse = { error: freshnessValidation.error };
    return res.status(400).json(errorBody);
  }
  const normalizedFreshness = freshnessValidation.value;

  const localeResult = validateLocalization({ locale, country, language });
  if (!localeResult.ok) {
    const errorBody: ApiErrorResponse = { error: localeResult.error };
    return res.status(400).json(errorBody);
  }
  const {
    locale: normalizedLocale,
    country: normalizedCountry,
    language: normalizedLanguage,
  } = localeResult.values;

  // Length-validate the serialized query. Advanced operators are composed
  // client-side and sent through unchanged; the per-query price is fixed.
  if (q.length > MAX_QUERY_LENGTH) {
    const errorBody: ApiErrorResponse = { error: `Query exceeds maximum length of ${MAX_QUERY_LENGTH} characters` }
    return res.status(400).json(errorBody)
  }
  const cleanQ = v.cleanQ

  // ─── Payment check ────────────────────────────────────────────────────────
  const paymentHeader =
    req.headers["payment-signature"] ||
    req.headers["x-payment"] ||
    req.headers["X-PAYMENT"];

  if (!paymentHeader) {
    // Return x402 v2 payment requirements
    // The key fix: asset must be a Soroban C... contract address, NOT "USDC:ISSUER"
    const paymentRequired = {
      x402Version: 2,
      error: "Payment required",
      resource: {
        url: `${req.headers["x-forwarded-proto"] || "http"}://${req.headers["host"]}${req.url}`,
        description:
          "StellarSearch: pay-per-query web search — 0.001 USDC on Stellar",
        mimeType: "application/json",
      },
      accepts: [
        {
          scheme: "exact",
          network: NETWORK, // "stellar:testnet"
          amount: AMOUNT_STROOPS, // "10000" (stroops, not dollars)
          asset: USDC_CONTRACT, // "CBIELTK6..." (Soroban contract)
          payTo: RECEIVING_ADDRESS, // your G... address
          maxTimeoutSeconds: 300,
          extra: { areFeesSponsored: true },
        },
      ],
    };

    res.setHeader(
      "PAYMENT-REQUIRED",
      Buffer.from(JSON.stringify(paymentRequired)).toString("base64"),
    );
    const errorBody: ApiErrorResponse = { error: "Payment required" };
    return res.status(402).json(errorBody);
  }

  // ─── Payment Replay Protection ───────────────────────────────────────────
  const consumption = consumePaymentPayload(paymentHeader);
  if (!consumption.ok) {
    const errorBody: ApiErrorResponse = { error: consumption.error };
    return res.status(402).json(errorBody);
  }

  // ─── Payment present — proceed with search ────────────────────────────────
  console.log("✅ Payment header received");

  let txHash: string | null = null
  const requestId = String(req.headers['x-request-id'] || req.headers['x-correlation-id'] || 'unknown')
  try {
    const decoded = decodePaymentReceipt(paymentHeader, {
      network: NETWORK,
      asset: USDC_CONTRACT,
      amount: AMOUNT_STROOPS,
    })

    if (!decoded.ok) {
      console.warn('[api/search] Invalid x402 payment receipt omitted from response', {
        requestId,
        reason: decoded.reason,
        headerPreview: String(paymentHeader).slice(0, 120),
      })
    } else {
      txHash = decoded.txHash
    }
  } catch {
    console.warn('[api/search] Invalid x402 payment receipt omitted from response', {
      requestId,
      reason: 'receipt decode failed',
      headerPreview: String(paymentHeader).slice(0, 120),
    })
  }

  const t0 = Date.now();

  try {
    // ─── Serper.dev ──────────────────────────────────────────────────────────
    const requestBody: Record<string, unknown> = {
      q:   cleanQ,
      num: Math.min(parseInt(count) || 5, 20),
    };

    if (normalizedFreshness) {
      const dateFilters: Record<string, string> = {
        pd: "qdr:d", // past day
        pw: "qdr:w", // past week
        pm: "qdr:m", // past month
      };
      requestBody.tbs = dateFilters[normalizedFreshness];
    }
    if (tbs) requestBody.tbs = tbs

    const serperRes = await fetchSerper('/search', {
      method:  'POST',
      headers: {
        "X-API-KEY": SERPER_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!serperRes.ok) {
      const errText = await serperRes.text();
      console.error("[serper]", serperRes.status, errText);
      const errorBody: ApiErrorResponse = {
        error: `Serper.dev API error: ${serperRes.status}`,
      };
      return res.status(502).json(errorBody);
    }

    const data: unknown = await serperRes.json();
    const latencyMs = Date.now() - t0;

    const results = normalizeOrganicResults(data)
    const queryMeta = normalizeQueryMetadata(data, cleanQ)

    const responseBody: SearchResponse = {
      query:      cleanQ,
      results,
      count:      results.length,
      network:    NETWORK,
      paidAmount: AMOUNT_USDC,
      currency:   'USDC',
      txHash,
      latencyMs,
    };

    return res.json(responseBody);
  } catch (err: any) {
    if (err instanceof CircuitOpenError) {
      console.error('[serper circuit open]', err.message)
      res.setHeader('Retry-After', Math.ceil(err.retryAfterMs / 1000).toString())
      const errorBody: ApiErrorResponse = { error: 'Search provider temporarily unavailable. Please retry shortly.' }
      return res.status(503).json(errorBody)
    }
    console.error('[search error]', err.message)
    const credit = issueCreditForFailure(consumption.paymentId, q.trim(), `Search failed: ${err.message}`)
    const errorBody: ApiErrorResponse = { error: 'Search failed.', credit }
    return res.status(500).json(errorBody)
  }
}

// Eligible failures (a settled payment followed by a provider-side error) get
// an auditable credit linked to the settled receipt. Idempotent per receiptId.
function issueCreditForFailure(receiptId: string, query: string, reason: string): CreditReceipt {
  const credit = issueSearchCredit({
    receiptId,
    route: '/search',
    query,
    amount: AMOUNT_USDC,
    reason,
  })
  return serializeCredit(credit)
}