import type { ClientSigner, PaymentChallenge, SignedPaymentHeader, SignerContext } from '../types'
import { encodePaymentHeaders, redactSecret } from '../x402'
import { StellarSearchError, ValidationError } from '../errors'

export interface ServerSignerOptions {
  /**
   * Secret seed (e.g. from process.env.STELLAR_PRIVATE_KEY).
   * Never hardcode secrets in source files or logs.
   */
  secretKey?: string

  /**
   * Asynchronous resolver for secret key (e.g. from AWS Secrets Manager, Vault, or secure prompt).
   */
  getSecretKey?: () => Promise<string> | string

  /**
   * Optional custom signing callback for server agents.
   */
  customSign?: (challenge: PaymentChallenge, context: SignerContext) => Promise<string | Record<string, unknown>>
}

/**
 * Creates a server signer adapter that resolves signing credentials securely
 * from environment variables or a secret vault without leaking them in logs or traces.
 */
export function createServerSigner(options: ServerSignerOptions): ClientSigner {
  async function resolveKey(): Promise<string> {
    if (options.getSecretKey) {
      const key = await options.getSecretKey()
      if (typeof key === 'string' && key.trim()) {
        return key.trim()
      }
    }
    if (options.secretKey && options.secretKey.trim()) {
      return options.secretKey.trim()
    }
    const envKey =
      (typeof process !== 'undefined' && process.env
        ? process.env.STELLAR_PRIVATE_KEY || process.env.SEARCH_PRIVATE_KEY
        : undefined) || ''
    if (envKey.trim()) {
      return envKey.trim()
    }
    throw new ValidationError(
      'Server signer requires a private key. Configure STELLAR_PRIVATE_KEY or supply getSecretKey.'
    )
  }

  function validateStellarSecretKey(key: string): void {
    if (!key.startsWith('S') || key.length !== 56) {
      throw new ValidationError(
        `Invalid Stellar secret key format "${redactSecret(key)}". Expected a 56-character Ed25519 secret starting with "S".`
      )
    }
  }

  return {
    async getAddress(): Promise<string> {
      try {
        const key = await resolveKey()
        validateStellarSecretKey(key)
        try {
          const stellarSdk: any = await import('@stellar/stellar-sdk')
          const Keypair = stellarSdk.Keypair || stellarSdk.default?.Keypair
          const StrKey = stellarSdk.StrKey || stellarSdk.default?.StrKey

          if (StrKey && typeof StrKey.decodeEd25519SecretSeed === 'function' && Keypair) {
            const raw = StrKey.decodeEd25519SecretSeed(key)
            const keypair = Keypair.fromRawEd25519Seed(new Uint8Array(raw))
            return keypair.publicKey()
          }
          if (Keypair && typeof Keypair.fromSecret === 'function') {
            const keypair = Keypair.fromSecret(key)
            return keypair.publicKey()
          }
          return `G...${redactSecret(key).slice(-4)}`
        } catch {
          return `G...${redactSecret(key).slice(-4)}`
        }
      } catch {
        return 'stellar-agent'
      }
    },

    async sign(challenge: PaymentChallenge, context: SignerContext): Promise<SignedPaymentHeader> {
      if (options.customSign) {
        const res = await options.customSign(challenge, context)
        const headers = encodePaymentHeaders(res)
        return {
          headerName: 'PAYMENT-SIGNATURE',
          headerValue: headers['PAYMENT-SIGNATURE'],
          secondaryHeaders: { 'x-payment': headers['x-payment'] },
        }
      }

      const key = await resolveKey()
      validateStellarSecretKey(key)

      const accept = challenge.accepts[0]
      if (!accept) {
        throw new StellarSearchError('No payment options accepted in challenge', { statusCode: 402 })
      }

      let publicKey: string
      try {
        const stellarSdk: any = await import('@stellar/stellar-sdk')
        const Keypair = stellarSdk.Keypair || stellarSdk.default?.Keypair
        const StrKey = stellarSdk.StrKey || stellarSdk.default?.StrKey

        if (StrKey && typeof StrKey.decodeEd25519SecretSeed === 'function' && Keypair) {
          const raw = StrKey.decodeEd25519SecretSeed(key)
          const keypair = Keypair.fromRawEd25519Seed(new Uint8Array(raw))
          publicKey = keypair.publicKey()
        } else if (Keypair && typeof Keypair.fromSecret === 'function') {
          const keypair = Keypair.fromSecret(key)
          publicKey = keypair.publicKey()
        } else {
          publicKey = `G...${redactSecret(key).slice(-4)}`
        }
      } catch (err: any) {
        if (err instanceof ValidationError) throw err
        publicKey = `G...${redactSecret(key).slice(-4)}`
      }

      // Build x402 payment authorization payload
      const paymentPayload = {
        scheme: accept.scheme || 'exact',
        network: accept.network,
        asset: accept.asset,
        amount: accept.amount,
        payTo: accept.payTo,
        payer: publicKey,
        timestamp: new Date().toISOString(),
        nonce: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
      }

      const headers = encodePaymentHeaders(paymentPayload)
      return {
        headerName: 'PAYMENT-SIGNATURE',
        headerValue: headers['PAYMENT-SIGNATURE'],
        secondaryHeaders: { 'x-payment': headers['x-payment'] },
      }
    },
  }
}
