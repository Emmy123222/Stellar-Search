import type { PaymentChallenge, SignedPaymentHeader, SignerContext, ClientSigner } from '../types'

export type { PaymentChallenge, SignedPaymentHeader, SignerContext, ClientSigner }

export type CustomSignerFn = (
  challenge: PaymentChallenge,
  context: SignerContext
) => Promise<string | Record<string, unknown> | SignedPaymentHeader>
