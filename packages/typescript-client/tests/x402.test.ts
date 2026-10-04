import { describe, it, expect } from 'vitest'
import {
  parsePaymentChallenge,
  encodePaymentHeaders,
  extractSettlementResponse,
  redactSecret,
} from '../src/x402'

describe('@stellar-search/client — x402 utilities', () => {
  describe('redactSecret', () => {
    it('redacts valid Stellar secret keys safely', () => {
      const secret = 'SCZANGBA5YHTNYVVV4C3U252E2B6P6F5T3U6MM63WBSBZATAQI3EBTQ4'
      const redacted = redactSecret(secret)
      expect(redacted).not.toBe(secret)
      expect(redacted.startsWith('SC')).toBe(true)
      expect(redacted.endsWith('Q4')).toBe(true)
      expect(redacted).toContain('****')
      expect(redacted.length).toBeLessThan(secret.length)
    })

    it('handles short, empty, or undefined values gracefully', () => {
      expect(redactSecret(undefined)).toBe('<empty>')
      expect(redactSecret('')).toBe('<empty>')
      expect(redactSecret('abc')).toBe('***')
    })
  })

  describe('parsePaymentChallenge', () => {
    const SAMPLE_CHALLENGE = {
      x402Version: 2,
      error: 'Payment required for search',
      resource: {
        url: 'http://localhost:3001/search?q=test',
        description: 'Pay-per-query web search',
      },
      accepts: [
        {
          scheme: 'exact',
          network: 'stellar:testnet',
          amount: '10000',
          asset: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
          payTo: 'GBBD47IF6LWK7P7MDEVOSCWR7DPWUV3NY3DTQEVFL4NAT4AQHAZLLFLA',
        },
      ],
    }

    it('parses base64-encoded PAYMENT-REQUIRED header', () => {
      const base64 = Buffer.from(JSON.stringify(SAMPLE_CHALLENGE)).toString('base64')
      const headers = { 'PAYMENT-REQUIRED': base64 }

      const challenge = parsePaymentChallenge(headers)
      expect(challenge).not.toBeNull()
      expect(challenge?.x402Version).toBe(2)
      expect(challenge?.accepts).toHaveLength(1)
      expect(challenge?.accepts[0].network).toBe('stellar:testnet')
      expect(challenge?.accepts[0].amount).toBe('10000')
      expect(challenge?.accepts[0].payTo).toBe('GBBD47IF6LWK7P7MDEVOSCWR7DPWUV3NY3DTQEVFL4NAT4AQHAZLLFLA')
    })

    it('parses case-insensitive payment-required header', () => {
      const base64 = Buffer.from(JSON.stringify(SAMPLE_CHALLENGE)).toString('base64')
      const headers = { 'payment-required': base64 }

      const challenge = parsePaymentChallenge(headers)
      expect(challenge?.accepts[0].network).toBe('stellar:testnet')
    })

    it('falls back to JSON body if header is absent or invalid', () => {
      const challenge = parsePaymentChallenge({}, SAMPLE_CHALLENGE)
      expect(challenge).not.toBeNull()
      expect(challenge?.accepts[0].amount).toBe('10000')
    })

    it('returns null if neither header nor body contain valid challenge', () => {
      expect(parsePaymentChallenge(undefined, undefined)).toBeNull()
      expect(parsePaymentChallenge({}, null)).toBeNull()
      expect(parsePaymentChallenge({ 'content-type': 'text/html' }, 'Not found')).toBeNull()
    })
  })

  describe('encodePaymentHeaders', () => {
    it('encodes raw string signature to both PAYMENT-SIGNATURE and x-payment headers', () => {
      const rawSig = 'sampleSignatureString123'
      const headers = encodePaymentHeaders(rawSig)

      expect(headers['PAYMENT-SIGNATURE']).toBe(rawSig)
      expect(headers['x-payment']).toBe(rawSig)
    })

    it('encodes payload object to base64 JSON', () => {
      const payload = { txHash: 'testHash', timestamp: '2026-09-30T12:00:00Z' }
      const headers = encodePaymentHeaders(payload)

      const decoded = JSON.parse(Buffer.from(headers['PAYMENT-SIGNATURE'], 'base64').toString('utf8'))
      expect(decoded.txHash).toBe('testHash')
      expect(headers['x-payment']).toBe(headers['PAYMENT-SIGNATURE'])
    })
  })

  describe('extractSettlementResponse', () => {
    it('extracts raw 64-char hex hash from x-payment-response', () => {
      const hash = 'a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef'
      const headers = { 'x-payment-response': hash }

      const result = extractSettlementResponse(headers)
      expect(result.txHash).toBe(hash)
    })

    it('extracts transactionHash from base64 JSON envelope', () => {
      const envelope = { transactionHash: 'hash123', status: 'settled' }
      const b64 = Buffer.from(JSON.stringify(envelope)).toString('base64')
      const headers = { 'X-PAYMENT-RESPONSE': b64 }

      const result = extractSettlementResponse(headers)
      expect(result.txHash).toBe('hash123')
    })

    it('returns null when header is missing or unparseable', () => {
      expect(extractSettlementResponse(undefined).txHash).toBeNull()
      expect(extractSettlementResponse({}).txHash).toBeNull()
    })
  })
})
