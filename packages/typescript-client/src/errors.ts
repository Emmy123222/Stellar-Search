import type { PaymentChallenge } from './types'

/**
 * Base error class for all @stellar-search/client errors.
 */
export class StellarSearchError extends Error {
  public readonly statusCode?: number
  public readonly details?: unknown

  constructor(message: string, options?: { statusCode?: number; details?: unknown; cause?: unknown }) {
    super(message)
    this.name = 'StellarSearchError'
    this.statusCode = options?.statusCode
    this.details = options?.details
    if (options?.cause) {
      this.cause = options.cause
    }
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * Thrown when client-side parameter validation fails before sending a request.
 */
export class ValidationError extends StellarSearchError {
  constructor(message: string) {
    super(message, { statusCode: 400 })
    this.name = 'ValidationError'
  }
}

/**
 * Thrown when an endpoint requires x402 payment and no signer is provided to settle it,
 * or when quoting an endpoint.
 */
export class PaymentRequiredError extends StellarSearchError {
  public readonly challenge: PaymentChallenge

  constructor(message: string, challenge: PaymentChallenge) {
    super(message, { statusCode: 402, details: challenge })
    this.name = 'PaymentRequiredError'
    this.challenge = challenge
  }
}

/**
 * Thrown when the explicit user approval hook (onPaymentRequired) rejects the payment challenge.
 */
export class PaymentApprovalRejectedError extends StellarSearchError {
  public readonly challenge: PaymentChallenge

  constructor(message: string, challenge: PaymentChallenge) {
    super(message, { statusCode: 402, details: challenge })
    this.name = 'PaymentApprovalRejectedError'
    this.challenge = challenge
  }
}

/**
 * Thrown when a paid request retry fails after presenting payment credentials.
 */
export class PaymentFailedError extends StellarSearchError {
  public readonly serverError?: string

  constructor(message: string, options?: { statusCode?: number; serverError?: string; details?: unknown }) {
    super(message, { statusCode: options?.statusCode ?? 402, details: options?.details })
    this.name = 'PaymentFailedError'
    this.serverError = options?.serverError
  }
}

/**
 * Thrown when receipt verification fails.
 */
export class VerificationError extends StellarSearchError {
  constructor(message: string, details?: unknown) {
    super(message, { details })
    this.name = 'VerificationError'
  }
}
