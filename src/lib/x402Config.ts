/**
 * x402Config.ts
 *
 * Single source of truth for x402 payment route and asset configuration.
 * Both Express (server/index.ts) and Vercel (api/search.ts) import this
 * module to build payment requirements, eliminating protocol drift.
 *
 * Fields covered:
 *   - network       (stellar:testnet | stellar:mainnet)
 *   - asset         (Soroban USDC contract address)
 *   - amount        (stroops — 0.001 USDC = 10000)
 *   - payTo         ( Stellar receiving address from env)
 *   - timeout       (maxTimeoutSeconds)
 *   - fee sponsorship (areFeesSponsored)
 */

import {
  STELLAR_NETWORK,
  USDC_CONTRACT,
  AMOUNT_STROOPS,
  AMOUNT_USDC,
} from './constants'

// ─── Constants ───────────────────────────────────────────────────────────
const MAX_TIMEOUT_SECONDS = 300
const X402_VERSION = 2

// ─── Types ───────────────────────────────────────────────────────────────

export interface X402PaymentRequirement {
  scheme: string
  network: string
  asset: string
  amount: string
  payTo: string
  maxTimeoutSeconds: number
  extra: Record<string, unknown>
}

export interface X402ExpressPaymentOption {
  scheme: string
  payTo: string
  price: number
  network: string
}

export interface X402RouteConfig {
  accepts: X402ExpressPaymentOption[]
  description: string
}

export interface X402FullConfig {
  x402Version: number
  network: string
  asset: string
  amount: string
  price: number
  payTo: string
  maxTimeoutSeconds: number
  extra: Record<string, unknown>
  facilitatorUrl: string
  expressRoutes: Record<string, X402RouteConfig>
}

// ─── Validation ──────────────────────────────────────────────────────────

function validateNetwork(network: string): network is 'stellar:testnet' | 'stellar:mainnet' {
  return network === 'stellar:testnet' || network === 'stellar:mainnet'
}

function validateAddress(addr: string): boolean {
  return typeof addr === 'string' && /^[A-Z2-7]{56}$/.test(addr)
}

function validateStroops(amount: string): boolean {
  const n = parseInt(amount, 10)
  return Number.isFinite(n) && n > 0
}

function validatePayTo(payTo: string | undefined, _network: string): string {
  if (payTo && validateAddress(payTo)) return payTo
  // Fallback: read from env at call time
  const envPayTo = process.env.STELLAR_RECEIVING_ADDRESS
  if (envPayTo && validateAddress(envPayTo)) return envPayTo
  throw new Error(
    `[x402Config] STELLAR_RECEIVING_ADDRESS is missing or invalid`,
  )
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Returns the validated network string for x402.
 */
export function getNetwork(): string {
  const network = STELLAR_NETWORK
  if (!validateNetwork(network)) {
    throw new Error(`[x402Config] Invalid STELLAR_NETWORK: ${network}`)
  }
  return network
}

/**
 * Returns the Soroban USDC contract address for the current network.
 */
export function getAsset(): string {
  const contract = USDC_CONTRACT
  if (!validateAddress(contract)) {
    throw new Error(`[x402Config] Invalid USDC_CONTRACT: ${contract}`)
  }
  return contract
}

/**
 * Returns the payment amount in stroops.
 */
export function getAmount(): string {
  if (!validateStroops(AMOUNT_STROOPS)) {
    throw new Error(`[x402Config] Invalid AMOUNT_STROOPS: ${AMOUNT_STROOPS}`)
  }
  return AMOUNT_STROOPS
}

/**
 * Returns the payment amount as a decimal USDC string.
 */
export function getAmountUsdc(): string {
  return AMOUNT_USDC
}

/**
 * Returns the payment amount as a parsed number (for Express middleware price field).
 */
export function getPrice(): number {
  const price = parseFloat(AMOUNT_USDC)
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`[x402Config] Invalid AMOUNT_USDC: ${AMOUNT_USDC}`)
  }
  return price
}

/**
 * Returns the payTo address. Validates or throws if not configured.
 */
export function getPayTo(override?: string): string {
  const network = getNetwork()
  return validatePayTo(override, network)
}

/**
 * Returns the default payment requirement object shared by all runtimes.
 */
export function buildPaymentRequirement(
  payToOverride?: string,
): X402PaymentRequirement {
  return {
    scheme:            'exact',
    network:           getNetwork(),
    asset:             getAsset(),
    amount:            getAmount(),
    payTo:             getPayTo(payToOverride),
    maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    extra:             { areFeesSponsored: true },
  }
}

/**
 * Builds the x402 route configuration for Express middleware.
 * The Express middleware (paymentMiddlewareFromConfig) expects PaymentOption format:
 * { scheme, payTo, price, network } — the facilitator resolves asset and amount from price.
 * Each paid route (GET /search, /images, /news) shares the same payment option.
 */
export function buildExpressRoutes(
  payToOverride?: string,
): Record<string, X402RouteConfig> {
  const payTo  = getPayTo(payToOverride)
  const network = getNetwork()
  const price   = getPrice()
  const amountUsdc = getAmountUsdc()

  const paymentOption: X402ExpressPaymentOption = {
    scheme:  'exact',
    payTo,
    price,
    network: network as 'stellar:testnet' | 'stellar:mainnet',
  }

  const routeDescription = (label: string) =>
    `StellarSearch: pay-per-query ${label} — ${amountUsdc} USDC on ${network}`

  return {
    'GET /search': {
      accepts: [paymentOption],
      description: routeDescription('web search'),
    },
    'GET /images': {
      accepts: [paymentOption],
      description: routeDescription('image search'),
    },
    'GET /news': {
      accepts: [paymentOption],
      description: routeDescription('news search'),
    },
  }
}

/**
 * Builds the x402 Payment-Required response body for Vercel's manual 402.
 */
export function buildPaymentRequiredPayload(
  requestUrl: string,
  payToOverride?: string,
) {
  const requirement = buildPaymentRequirement(payToOverride)
  return {
    x402Version: X402_VERSION,
    error:       'Payment required',
    resource: {
      url:         requestUrl,
      description: `StellarSearch: pay-per-query web search — ${getAmountUsdc()} USDC on ${getNetwork()}`,
      mimeType:    'application/json',
    },
    accepts: [requirement],
  }
}

/**
 * Returns the facilitator URL from env or default.
 */
export function getFacilitatorUrl(): string {
  return process.env.FACILITATOR_URL || 'https://www.x402.org/facilitator'
}

/**
 * Full configuration object for snapshot testing and validation.
 */
export function getFullConfig(payToOverride?: string): X402FullConfig {
  return {
    x402Version:      X402_VERSION,
    network:          getNetwork(),
    asset:            getAsset(),
    amount:           getAmount(),
    price:            getPrice(),
    payTo:            getPayTo(payToOverride),
    maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    extra:            { areFeesSponsored: true },
    facilitatorUrl:   getFacilitatorUrl(),
    expressRoutes:    buildExpressRoutes(payToOverride),
  }
}
