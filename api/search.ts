import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  STELLAR_NETWORK,
  USDC_CONTRACT,
  AMOUNT_STROOPS,
  AMOUNT_USDC,
} from "../src/lib/constants";
import { consumePaymentPayload } from "../src/lib/paymentIntegrity";
import { normalizeOrganicResults } from "../src/lib/serperNormalizer";
import type { SearchResponse, ApiErrorResponse } from "../src/types/index.js";

function validateLocalization(
  input: Record<string, string | undefined>,
):
  | { ok: true; values: { locale: string; country: string; language: string } }
  | { ok: false; error: string } {
  const locale = (input.locale ?? "en-US").trim() || "en-US";
  const country = (input.country ?? "us").trim().toLowerCase() || "us";
  const language = (input.language ?? "en").trim().toLowerCase() || "en";

  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/.test(locale))
    return { ok: false, error: "Invalid locale parameter" };
  if (!/^[a-z]{2}$/.test(country))
    return { ok: false, error: "Invalid country parameter" };
  if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/.test(language))
    return { ok: false, error: "Invalid language parameter" };

  return { ok: true, values: { locale, country, language } };
}

// ─── Config ───────────────────────────────────────────────────────────────
const RECEIVING_ADDRESS = process.env.STELLAR_RECEIVING_ADDRESS!;
const NETWORK = STELLAR_NETWORK as "stellar:testnet" | "stellar:mainnet";
const SERPER_API_KEY = process.env.SERPER_API_KEY!;

export default async function handler(req: VercelRequest, res: VercelResponse) {
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

  const {
    q,
    count = "5",
    freshness,
    locale,
    country,
    language,
  } = req.query as Record<string, string>;

  if (!q?.trim()) {
    const errorBody: ApiErrorResponse = {
      error: "Missing required parameter: q",
    };
    return res.status(400).json(errorBody);
  }

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

  let txHash: string | null = null;
  try {
    const decoded = Buffer.from(paymentHeader as string, "base64").toString(
      "utf8",
    );
    const parsed = JSON.parse(decoded);
    txHash = parsed.transactionHash || parsed.txHash || null;
  } catch {
    // payment header not base64 JSON — fine, tx hash just won't show
  }

  const t0 = Date.now();

  try {
    // ─── Serper.dev ──────────────────────────────────────────────────────────
    const requestBody: Record<string, unknown> = {
      q: q.trim(),
      num: Math.min(parseInt(count) || 5, 20),
      hl: normalizedLanguage,
      gl: normalizedCountry,
      locale: normalizedLocale,
    };

    if (freshness) {
      const dateFilters: Record<string, string> = {
        pd: "qdr:d", // past day
        pw: "qdr:w", // past week
        pm: "qdr:m", // past month
      };
      if (dateFilters[freshness]) requestBody.tbs = dateFilters[freshness];
    }

    const serperRes = await fetch("https://google.serper.dev/search", {
      method: "POST",
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

    const results = normalizeOrganicResults(data);

    const responseBody: SearchResponse = {
      query: q.trim(),
      results,
      count: results.length,
      network: NETWORK,
      paidAmount: AMOUNT_USDC,
      currency: "USDC",
      txHash,
      latencyMs,
      locale: normalizedLocale,
      country: normalizedCountry,
      language: normalizedLanguage,
    };

    return res.json(responseBody);
  } catch (err: any) {
    console.error("[search error]", err.message);
    const errorBody: ApiErrorResponse = { error: "Search failed." };
    return res.status(500).json(errorBody);
  }
}
