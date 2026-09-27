/**
 * Fee-sponsorship metadata for the x402 payment challenge (#312).
 *
 * The payment requirements advertise `extra.areFeesSponsored`, which tells the
 * payer whether StellarSearch covers the Stellar network fee or whether it is
 * charged on top of the 0.001 USDC price. The wallet flow previously ignored
 * that field entirely, so a payer could be shown optimistic copy ("fees are
 * sponsored") without the challenge actually saying so.
 *
 * These helpers turn the challenge metadata into a description the UI can show
 * *before* signing, and decide when the payer has to explicitly acknowledge it
 * (unknown or changed sponsorship) instead of being told a comfortable guess.
 *
 * Pure and dependency-free so the copy and the acknowledgement rules are unit
 * tested without a wallet or a network.
 */

/** Who ends up paying the Stellar network fee. */
export type FeeSponsorshipPayer = 'sponsor' | 'payer' | 'unknown'

/** Why the payer must acknowledge before signing. */
export type SponsorshipAcknowledgementReason = 'unknown' | 'changed'

export interface FeeSponsorshipInfo {
  /** Best-effort classification of who pays the network fee. */
  payer: FeeSponsorshipPayer
  /** Raw `extra.areFeesSponsored` value; `null` when the challenge omits it. */
  areFeesSponsored: boolean | null
  /** Price the payer commits to, in USDC, when the challenge states an amount. */
  priceUsdc: string | null
  /** Estimated network fee the payer covers, in XLM, when the challenge states one. */
  estimatedNetworkFeeXlm: string | null
  /** One-line status for the payment UI. */
  label: string
  /** Supporting sentence; never overstates what the challenge claimed. */
  detail: string
  /** True when signing must wait for an explicit acknowledgement. */
  requiresAcknowledgement: boolean
  /** Why acknowledgement is required, or `null` when it is not. */
  acknowledgementReason: SponsorshipAcknowledgementReason | null
  /** True when the advertised sponsorship differs from the previous challenge. */
  changed: boolean
}

/** Atomic-unit conversion: 1 XLM = 10^7 stroops. */
export const STROOPS_PER_XLM = 10_000_000

const SPONSORED_LABEL = 'Network fees sponsored'
const PAYER_LABEL = 'You pay network fees'
const UNKNOWN_LABEL = 'Network fee sponsorship not stated'

interface ChallengePaymentExtra {
  areFeesSponsored?: unknown
  estimatedFeeStroops?: unknown
  estimatedPayerFeeStroops?: unknown
  [key: string]: unknown
}

interface ChallengePaymentOption {
  amount?: unknown
  extra?: ChallengePaymentExtra
}

interface ChallengeLike {
  accepts?: unknown
}

/** Formats a stroop count as an XLM string, trimming trailing zeros. */
export function stroopsToXlm(stroops: number): string {
  const xlm = stroops / STROOPS_PER_XLM
  return xlm.toFixed(7).replace(/0+$/, '').replace(/\.$/, '') || '0'
}

function readEstimatedFeeStroops(extra: ChallengePaymentExtra | undefined): number | null {
  if (!extra) return null
  for (const key of ['estimatedFeeStroops', 'estimatedPayerFeeStroops'] as const) {
    const raw = extra[key]
    const value = typeof raw === 'string' ? Number(raw) : raw
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  }
  return null
}

/**
 * Describes who pays the network fee for a challenge.
 *
 * @param paymentRequired decoded x402 `PaymentRequired` payload
 * @param previouslySponsored `extra.areFeesSponsored` observed on the previous
 *   challenge (or `undefined` on the first one). A *different* value marks the
 *   metadata as changed, which requires fresh acknowledgement.
 */
export function readFeeSponsorship(
  paymentRequired: unknown,
  previouslySponsored?: boolean | null,
): FeeSponsorshipInfo {
  const accepts = (paymentRequired as ChallengeLike | null | undefined)?.accepts
  const option: ChallengePaymentOption | undefined =
    Array.isArray(accepts) && accepts.length > 0 ? (accepts[0] as ChallengePaymentOption) : undefined

  const rawSponsored = option?.extra?.areFeesSponsored
  const areFeesSponsored = typeof rawSponsored === 'boolean' ? rawSponsored : null

  const payer: FeeSponsorshipPayer =
    areFeesSponsored === true ? 'sponsor' : areFeesSponsored === false ? 'payer' : 'unknown'

  const priceUsdc = readPriceUsdc(option?.amount)
  const estimatedFeeStroops = readEstimatedFeeStroops(option?.extra)
  const estimatedNetworkFeeXlm = estimatedFeeStroops === null ? null : stroopsToXlm(estimatedFeeStroops)

  // `undefined` means "no previous challenge observed", so there is nothing to
  // compare against. Any other difference — including a boolean becoming
  // unstated (`null`) or vice versa — counts as a change.
  const changed =
    previouslySponsored !== undefined &&
    previouslySponsored !== areFeesSponsored

  const acknowledgementReason: SponsorshipAcknowledgementReason | null =
    changed ? 'changed' : areFeesSponsored === null ? 'unknown' : null

  const { label, detail } = describe(payer, priceUsdc, estimatedNetworkFeeXlm, changed)

  return {
    payer,
    areFeesSponsored,
    priceUsdc,
    estimatedNetworkFeeXlm,
    label,
    detail,
    requiresAcknowledgement: acknowledgementReason !== null,
    acknowledgementReason,
    changed,
  }
}

/** Converts a stroop `amount` from the challenge into a USDC string. */
function readPriceUsdc(amount: unknown): string | null {
  const value = typeof amount === 'string' ? Number(amount) : amount
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return (value / STROOPS_PER_XLM).toFixed(3)
}

function describe(
  payer: FeeSponsorshipPayer,
  priceUsdc: string | null,
  estimatedNetworkFeeXlm: string | null,
  changed: boolean,
): { label: string; detail: string } {
  const price = priceUsdc ? `${priceUsdc} USDC` : 'the advertised price'

  if (payer === 'sponsor') {
    return {
      label: SPONSORED_LABEL,
      detail: `StellarSearch covers the Stellar network fee. You are charged ${price}, and no additional network fee.`,
    }
  }

  if (payer === 'payer') {
    return {
      label: PAYER_LABEL,
      detail: estimatedNetworkFeeXlm
        ? `StellarSearch does not sponsor fees for this challenge. You pay ${price} plus an estimated ${estimatedNetworkFeeXlm} XLM network fee.`
        : `StellarSearch does not sponsor fees for this challenge. You pay ${price} plus the Stellar network fee (the challenge did not state an estimate).`,
    }
  }

  return {
    label: UNKNOWN_LABEL,
    detail: changed
      ? `This challenge no longer states who pays the network fee, which is different from the previous challenge. You are charged ${price}; any additional network fee is unknown.`
      : `This challenge does not state whether network fees are sponsored. You are charged ${price}; any additional network fee is unknown.`,
  }
}
