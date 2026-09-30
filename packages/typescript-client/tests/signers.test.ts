import { describe, it, expect, vi } from 'vitest'
import { createBrowserSigner } from '../src/signers/browser'
import { createServerSigner } from '../src/signers/server'
import type { PaymentChallenge } from '../src/types'
import { ValidationError } from '../src/errors'

describe('@stellar-search/client — Signer Adapters', () => {
  const MOCK_CHALLENGE: PaymentChallenge = {
    x402Version: 2,
    accepts: [
      {
        scheme: 'exact',
        network: 'stellar:testnet',
        amount: '10000',
        asset: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
        payTo: 'GBBD47IF6LWK7P7MDEVOSCWR7DPWUV3NY3DTQEVFL4NAT4AQHAZLLFLA',
        extra: {
          entryXdr: 'AAAAAgAAAAEAAAA...',
        },
      },
    ],
  }

  const MOCK_CONTEXT = {
    url: 'http://localhost:3001/search?q=test',
    method: 'GET',
    network: 'stellar:testnet',
    challenge: MOCK_CHALLENGE,
  }

  describe('createBrowserSigner', () => {
    it('calls wallet.signAuthEntry and encodes signed auth entry', async () => {
      const mockWallet = {
        signAuthEntry: vi.fn().mockResolvedValue({
          signedAuthEntry: 'signedBase64Entry123==',
        }),
        getPublicKey: vi.fn().mockResolvedValue('GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3'),
      }

      const signer = createBrowserSigner(mockWallet)
      const address = await signer.getAddress!()
      expect(address).toBe('GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3')

      const signedHeader = await signer.sign(MOCK_CHALLENGE, MOCK_CONTEXT)
      expect(mockWallet.signAuthEntry).toHaveBeenCalledWith(
        'AAAAAgAAAAEAAAA...',
        expect.objectContaining({ networkPassphrase: expect.any(String) })
      )

      expect(signedHeader.headerName).toBe('PAYMENT-SIGNATURE')
      expect(signedHeader.headerValue).toBeDefined()
    })

    it('converts Uint8Array output from wallet to base64 properly', async () => {
      const mockWallet = {
        signAuthEntry: vi.fn().mockResolvedValue({
          signedAuthEntry: new Uint8Array([1, 2, 3, 4, 5]),
        }),
      }

      const signer = createBrowserSigner(mockWallet)
      const signed = await signer.sign(MOCK_CHALLENGE, MOCK_CONTEXT)
      expect(signed.headerValue).toBeDefined()
      expect(signed.secondaryHeaders?.['x-payment']).toBe(signed.headerValue)
    })

    it('rejects with error when wallet returns error', async () => {
      const mockWallet = {
        signAuthEntry: vi.fn().mockResolvedValue({
          error: { message: 'User rejected signature request' },
        }),
      }

      const signer = createBrowserSigner(mockWallet)
      await expect(signer.sign(MOCK_CHALLENGE, MOCK_CONTEXT)).rejects.toThrow('User rejected signature request')
    })

    it('rejects on network mismatch if expectedNetwork configured', async () => {
      const mockWallet = {
        signAuthEntry: vi.fn(),
      }
      const signer = createBrowserSigner(mockWallet, { expectedNetwork: 'stellar:mainnet' })

      await expect(signer.sign(MOCK_CHALLENGE, MOCK_CONTEXT)).rejects.toThrow(/Wallet network mismatch/)
    })

    it('supports custom signing callback function', async () => {
      const customSignFn = vi.fn().mockResolvedValue({ customToken: 'token_123' })
      const signer = createBrowserSigner(customSignFn)

      const signed = await signer.sign(MOCK_CHALLENGE, MOCK_CONTEXT)
      expect(customSignFn).toHaveBeenCalledWith(MOCK_CHALLENGE, MOCK_CONTEXT)
      expect(signed.headerName).toBe('PAYMENT-SIGNATURE')
    })
  })

  describe('createServerSigner', () => {
    const VALID_SECRET = 'SC2YZV2NFYOVSSPQAMEBH2PQ5ZUSHIXHMMN2FSOHH4PMATVNXX5QTBLV'

    it('resolves key from secretKey option and generates payment headers', async () => {
      const signer = createServerSigner({ secretKey: VALID_SECRET })
      const signed = await signer.sign(MOCK_CHALLENGE, MOCK_CONTEXT)

      expect(signed.headerName).toBe('PAYMENT-SIGNATURE')
      expect(signed.headerValue).toBeDefined()

      const decoded = JSON.parse(Buffer.from(signed.headerValue, 'base64').toString('utf8'))
      expect(decoded.scheme).toBe('exact')
      expect(decoded.network).toBe('stellar:testnet')
      expect(decoded.payTo).toBe(MOCK_CHALLENGE.accepts[0].payTo)
      expect(decoded.payer).toBeDefined()
      expect(decoded.nonce).toBeDefined()
    }, 15000)

    it('resolves key from getSecretKey callback', async () => {
      const getSecretKey = vi.fn().mockResolvedValue(VALID_SECRET)
      const signer = createServerSigner({ getSecretKey })

      const address = await signer.getAddress!()
      expect(getSecretKey).toHaveBeenCalled()
      expect(address.startsWith('G')).toBe(true)

      const signed = await signer.sign(MOCK_CHALLENGE, MOCK_CONTEXT)
      expect(signed.headerValue).toBeDefined()
    })

    it('throws ValidationError without echoing secret if key format is invalid', async () => {
      const signer = createServerSigner({ secretKey: 'INVALID_KEY_123' })

      await expect(signer.sign(MOCK_CHALLENGE, MOCK_CONTEXT)).rejects.toThrow(ValidationError)
      await expect(signer.sign(MOCK_CHALLENGE, MOCK_CONTEXT)).rejects.toThrow(/Invalid Stellar secret key format/)
      // Must not leak the invalid key in plain text
      await expect(signer.sign(MOCK_CHALLENGE, MOCK_CONTEXT)).rejects.not.toThrow('INVALID_KEY_123')
    })

    it('throws ValidationError when no secret key is provided', async () => {
      const signer = createServerSigner({})
      await expect(signer.sign(MOCK_CHALLENGE, MOCK_CONTEXT)).rejects.toThrow(
        /Server signer requires a private key/
      )
    })

    it('supports customSign option for backend proxying', async () => {
      const customSign = vi.fn().mockResolvedValue('customSignedPaymentPayload')
      const signer = createServerSigner({ customSign })

      const signed = await signer.sign(MOCK_CHALLENGE, MOCK_CONTEXT)
      expect(customSign).toHaveBeenCalledWith(MOCK_CHALLENGE, MOCK_CONTEXT)
      expect(signed.headerValue).toBe('customSignedPaymentPayload')
    })
  })
})
