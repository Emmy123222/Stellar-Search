import type { VercelRequest, VercelResponse } from '@vercel/node';
import { STELLAR_NETWORK, USDC_CONTRACT, AMOUNT_STROOPS, AMOUNT_USDC } from '../src/lib/constants';
import { consumePaymentPayload } from '../src/lib/paymentIntegrity';

// ─── Config ───────────────────────────────────────────────────────────────
const RECEIVING_ADDRESS = process.env.STELLAR_RECEIVING_ADDRESS!;
const NETWORK = STELLAR_NETWORK as 'stellar:testnet' | 'stellar:mainnet';
const SERPER_API_KEY = process.env.SERPER_API_KEY!;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ─── CORS ─────────────────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', [
    'Content-Type',
    'Authorization',
    'X-Payment',
    'payment-signature',
    'x-payment',
    'X-PAYMENT',
  ].join(', '));
  res.setHeader('Access-Control-Expose-Headers', ['PAYMENT-REQUIRED', 'X-Payment-Response'].join(', '));

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { q, count = '10', safeSearch = 'moderate' } = req.query as Record<string, string>;
  if (!q?.trim()) return res.status(400).json({ error: 'Missing required parameter: q' });
  const validSafeSearch = ['strict', 'moderate', 'off'].includes(safeSearch) ? safeSearch : 'moderate';

  // ─── Payment check ────────────────────────────────────────────────────────
  const paymentHeader =
    req.headers['payment-signature'] ||
    req.headers['x-payment'] ||
    req.headers['X-PAYMENT'];

  if (!paymentHeader) {
    const paymentRequired = {
      x402Version: 2,
      error: 'Payment required',
      resource: {
        url: `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['host']}${req.url}`,
        description: 'StellarSearch: pay-per-query image search — 0.001 USDC on Stellar',
        mimeType: 'application/json',
      },
      accepts: [
        {
          scheme: 'exact',
          network: NETWORK,
          amount: AMOUNT_STROOPS,
          asset: USDC_CONTRACT,
          payTo: RECEIVING_ADDRESS,
          maxTimeoutSeconds: 300,
          extra: { areFeesSponsored: true },
        },
      ],
    };
    res.setHeader('PAYMENT-REQUIRED', Buffer.from(JSON.stringify(paymentRequired)).toString('base64'));
    return res.status(402).json({ error: 'Payment required' });
  }

  const consumption = consumePaymentPayload(paymentHeader);
  if (!consumption.ok) return res.status(402).json({ error: consumption.error });

  // Extract tx hash for metadata (optional)
  let txHash: string | null = null;
  try {
    const decoded = Buffer.from(paymentHeader as string, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    txHash = parsed.transactionHash || parsed.txHash || null;
  } catch {}

  const t0 = Date.now();
  try {
    const requestBody: Record<string, unknown> = {
      q: q.trim(),
      num: Math.min(parseInt(count) || 10, 10),
    };
    requestBody.safeSearch = validSafeSearch === 'strict' ? 'active' : (validSafeSearch === 'off' ? 'off' : 'moderate');

    const serperRes = await fetch('https://google.serper.dev/images', {
      method: 'POST',
      headers: {
        'X-API-KEY': SERPER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!serperRes.ok) {
      const err = await serperRes.text();
      console.error('[serper images]', serperRes.status, err);
      return res.status(502).json({ error: `Serper.dev API error: ${serperRes.status}` });
    }

    const data = await serperRes.json() as any;
    const latencyMs = Date.now() - t0;
    const results = (data.images || []).map((r: any, i: number) => ({
      id: String(i + 1),
      title: r.title || 'No title',
      imageUrl: r.imageUrl,
      sourceUrl: r.link,
      source: (() => { try { return new URL(r.link).hostname.replace('www.', '') } catch { return r.link } })(),
      width: r.imageWidth,
      height: r.imageHeight,
    }));

    return res.json({
      query: q.trim(),
      safeSearch: validSafeSearch,
      results,
      count: results.length,
      network: NETWORK,
      paidAmount: AMOUNT_USDC,
      currency: 'USDC',
      txHash,
      latencyMs,
    });
  } catch (err: any) {
    console.error('[images error]', err.message);
    return res.status(500).json({ error: 'Image search failed.' });
  }
}
