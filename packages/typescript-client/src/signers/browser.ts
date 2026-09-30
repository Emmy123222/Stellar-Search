import type { ClientSigner, PaymentChallenge, SignedPaymentHeader, SignerContext } from '../types'
import { encodePaymentHeaders } from '../x402'
import { StellarSearchError } from '../errors'

export interface FreighterWalletLike {
  signAuthEntry(
    entryXdr: string,
    opts?: { networkPassphrase?: string }
  ): Promise<{ signedAuthEntry?: string | Uint8Array; error?: { message: string } }>
  getPublicKey?: () => Promise<string | { publicKey?: string }>
}

export type BrowserSignerSource =
  | FreighterWalletLike
  | ((challenge: PaymentChallenge, context: SignerContext) => Promise<string | Record<string, unknown> | SignedPaymentHeader>)

export interface BrowserSignerOptions {
  networkPassphrase?: string
  expectedNetwork?: string
}

/**
 * Creates a browser signer adapter that prompts the user's wallet (e.g. Freighter)
 * without holding or embedding any private keys or secrets.
 */
export function createBrowserSigner(
  source: BrowserSignerSource,
  options: BrowserSignerOptions = {}
): ClientSigner {
  return {
    async getAddress(): Promise<string> {
      if (typeof source === 'object' && typeof source.getPublicKey === 'function') {
        const res = await source.getPublicKey()
        if (typeof res === 'string') return res
        if (res && typeof res.publicKey === 'string') return res.publicKey
      }
      return 'browser-wallet'
    },

    async sign(challenge: PaymentChallenge, context: SignerContext): Promise<SignedPaymentHeader> {
      if (typeof source === 'function') {
        const result = await source(challenge, context)
        if (result && typeof result === 'object' && 'headerName' in result && 'headerValue' in result) {
          return result as SignedPaymentHeader
        }
        const headers = encodePaymentHeaders(result as string | Record<string, unknown>)
        return {
          headerName: 'PAYMENT-SIGNATURE',
          headerValue: headers['PAYMENT-SIGNATURE'],
          secondaryHeaders: { 'x-payment': headers['x-payment'] },
        }
      }

      // Freighter-like wallet adapter
      const accept = challenge.accepts[0]
      if (!accept) {
        throw new StellarSearchError('No payment options accepted in challenge', { statusCode: 402 })
      }

      // Check network alignment if specified
      if (options.expectedNetwork && accept.network !== options.expectedNetwork) {
        throw new StellarSearchError(
          `Wallet network mismatch: challenge specifies "${accept.network}", expected "${options.expectedNetwork}"`,
          { statusCode: 400 }
        )
      }

      const networkPassphrase =
        options.networkPassphrase ||
        (accept.network === 'stellar:mainnet'
          ? 'Public Global Stellar Network ; September 2015'
          : 'Test SDF Network ; September 2015')

      // If the challenge contains a Soroban entry XDR in extra or resource
      const entryXdr = String(accept.extra?.entryXdr || accept.extra?.xdr || '')
      if (!entryXdr) {
        // If entryXdr is not explicitly given, build the exact payload metadata
        const payload = {
          scheme: accept.scheme || 'exact',
          network: accept.network,
          asset: accept.asset,
          amount: accept.amount,
          payTo: accept.payTo,
          timestamp: new Date().toISOString(),
        }
        const headers = encodePaymentHeaders(payload)
        return {
          headerName: 'PAYMENT-SIGNATURE',
          headerValue: headers['PAYMENT-SIGNATURE'],
          secondaryHeaders: { 'x-payment': headers['x-payment'] },
        }
      }

      const signResult = await source.signAuthEntry(entryXdr, { networkPassphrase })
      if (signResult.error) {
        throw new StellarSearchError(`Wallet signing rejected: ${signResult.error.message}`, {
          statusCode: 402,
          details: signResult.error,
        })
      }

      if (!signResult.signedAuthEntry) {
        throw new StellarSearchError('Wallet returned empty signed auth entry', { statusCode: 402 })
      }

      const raw = signResult.signedAuthEntry
      let base64Entry: string
      if (typeof raw === 'string') {
        base64Entry = raw
      } else if (typeof Buffer !== 'undefined') {
        base64Entry = Buffer.from(raw).toString('base64')
      } else {
        base64Entry = btoa(String.fromCharCode(...raw))
      }

      const headers = encodePaymentHeaders({
        signedAuthEntry: base64Entry,
        network: accept.network,
      })

      return {
        headerName: 'PAYMENT-SIGNATURE',
        headerValue: headers['PAYMENT-SIGNATURE'],
        secondaryHeaders: { 'x-payment': headers['x-payment'] },
      }
    },
  }
}
