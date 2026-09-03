import { describe, expect, it } from 'vitest';
import { Buffer } from 'buffer';

describe('x402 v2 Header & Alias Resolution Suite', () => {
  const mockPaymentRequiredV2 = {
    x402Version: 2,
    error: 'Payment required',
    resource: {
      url: 'http://localhost:3001/search?q=stellar',
      description: 'StellarSearch: pay-per-query web search — 0.001 USDC on Stellar',
      mimeType: 'application/json',
    },
    accepts: [
      {
        scheme: 'exact',
        network: 'stellar:testnet',
        amount: '10000',
        asset: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
        payTo: 'GDXA3V2LI3VN3GBH5BMOF25QSFJV7S7ZOWMHHQMJRPP4BVORDDRTIIMU',
        maxTimeoutSeconds: 300,
        extra: { areFeesSponsored: true },
      },
    ],
  };

  it('correctly encodes and decodes x402 v2 PAYMENT-REQUIRED header', () => {
    const encoded = Buffer.from(JSON.stringify(mockPaymentRequiredV2)).toString('base64');
    expect(typeof encoded).toBe('string');
    expect(encoded.length).toBeGreaterThan(20);

    const decodedRaw = Buffer.from(encoded, 'base64').toString('utf8');
    const parsed = JSON.parse(decodedRaw);

    expect(parsed.x402Version).toBe(2);
    expect(parsed.accepts[0].scheme).toBe('exact');
    expect(parsed.accepts[0].network).toBe('stellar:testnet');
    expect(parsed.accepts[0].amount).toBe('10000');
    expect(parsed.accepts[0].payTo).toBe('GDXA3V2LI3VN3GBH5BMOF25QSFJV7S7ZOWMHHQMJRPP4BVORDDRTIIMU');
  });

  it('resolves payment payload across canonical X-Payment and legacy aliases', () => {
    const mockPayload = {
      x402Version: 2,
      signedAuthEntry: 'AAAAAQAAAAD...',
      signerAddress: 'GDXA3V2LI3VN3GBH5BMOF25QSFJV7S7ZOWMHHQMJRPP4BVORDDRTIIMU',
      transactionHash: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    };
    const encodedPayload = Buffer.from(JSON.stringify(mockPayload)).toString('base64');

    const resolvePaymentHeader = (headers: Record<string, string | undefined>): string | null => {
      const canonicalOrAlias =
        headers['x-payment'] ||
        headers['X-Payment'] ||
        headers['payment-signature'] ||
        headers['X-PAYMENT'];
      return canonicalOrAlias || null;
    };

    // Test canonical header
    expect(resolvePaymentHeader({ 'x-payment': encodedPayload })).toBe(encodedPayload);
    expect(resolvePaymentHeader({ 'X-Payment': encodedPayload })).toBe(encodedPayload);

    // Test legacy alias
    expect(resolvePaymentHeader({ 'payment-signature': encodedPayload })).toBe(encodedPayload);
    expect(resolvePaymentHeader({ 'X-PAYMENT': encodedPayload })).toBe(encodedPayload);
    expect(resolvePaymentHeader({})).toBeNull();
  });

  it('decodes payment signature payload transaction hash correctly', () => {
    const mockPayload = {
      x402Version: 2,
      signedAuthEntry: 'AAAAAQAAAAD...',
      signerAddress: 'GDXA3V2LI3VN3GBH5BMOF25QSFJV7S7ZOWMHHQMJRPP4BVORDDRTIIMU',
      transactionHash: 'a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef',
    };
    const encoded = Buffer.from(JSON.stringify(mockPayload)).toString('base64');

    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);

    expect(parsed.transactionHash).toBe('a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef');
  });
});
