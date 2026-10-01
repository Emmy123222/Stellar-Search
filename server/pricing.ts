/**
 * server/pricing.ts
 * Deterministic x402 pricing function supporting search mode and result count tiers.
 */

import { calculateSearchPrice, type SearchMode, type PricingTier } from '../src/lib/constants.js'

export { calculateSearchPrice, type SearchMode, type PricingTier }
