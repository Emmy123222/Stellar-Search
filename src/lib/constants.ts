/**
 * constants.ts
 * Centralized Stellar network constants for both Frontend and Backend.
 */

import { StrKey } from '@stellar/stellar-sdk'

export const VALID_STELLAR_NETWORKS = ['stellar:testnet', 'stellar:mainnet'] as const
export type StellarNetwork = (typeof VALID_STELLAR_NETWORKS)[number]

export const isValidStellarNetwork = (value: string | undefined): value is StellarNetwork =>
  typeof value === 'string' && VALID_STELLAR_NETWORKS.includes(value as StellarNetwork)

export const isValidStellarReceivingAddress = (value: string | undefined): boolean => {
  if (typeof value !== 'string') {
    return false
  }

  const trimmedValue = value.trim()
  if (!trimmedValue) {
    return false
  }

  return StrKey.isValidEd25519PublicKey(trimmedValue) || /^G[A-Z2-7]{55}$/.test(trimmedValue)
}

const redactStellarValue = (value: string | undefined): string => {
  if (!value) {
    return 'missing'
  }

  const trimmedValue = value.trim()
  if (trimmedValue.length <= 8) {
    return `${trimmedValue.slice(0, 2)}...`
  }

  return `${trimmedValue.slice(0, 4)}...${trimmedValue.slice(-4)}`
}

export const assertValidStellarConfig = (
  config: { STELLAR_NETWORK?: string; STELLAR_RECEIVING_ADDRESS?: string } = {}
): void => {
  const network = config.STELLAR_NETWORK ?? STELLAR_NETWORK
  const receivingAddress =
    config.STELLAR_RECEIVING_ADDRESS ?? process.env.STELLAR_RECEIVING_ADDRESS ?? ''

  if (!isValidStellarNetwork(network)) {
    throw new Error(
      `Invalid STELLAR_NETWORK "${redactStellarValue(network)}". Expected one of: ${VALID_STELLAR_NETWORKS.join(', ')}.`
    )
  }

  if (!isValidStellarReceivingAddress(receivingAddress)) {
    throw new Error(
      `Invalid STELLAR_RECEIVING_ADDRESS "${redactStellarValue(receivingAddress)}". Expected a valid Stellar public key for ${network}.`
    )
  }
}

// Use process.env for Node.js and import.meta.env for Vite
const getEnv = (key: string, fallback: string) => {
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key]
  }
  // @ts-ignore
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[`VITE_${key}`]) {
    // @ts-ignore
    return import.meta.env[`VITE_${key}`]
  }
  return fallback
}

export const STELLAR_NETWORK = getEnv('STELLAR_NETWORK', 'stellar:testnet')
export const IS_MAINNET = STELLAR_NETWORK === 'stellar:mainnet'
export const EXPECTED_WALLET_NETWORK = IS_MAINNET ? 'PUBLIC' : 'TESTNET'

// Horizon
export const HORIZON_TESTNET = 'https://horizon-testnet.stellar.org'
export const HORIZON_MAINNET = 'https://horizon.stellar.org'
export const HORIZON_URL = IS_MAINNET ? HORIZON_MAINNET : HORIZON_TESTNET

// Explorer
export const STELLAR_EXPERT_TESTNET = 'https://stellar.expert/explorer/testnet'
export const STELLAR_EXPERT_MAINNET = 'https://stellar.expert/explorer/public'
export const STELLAR_EXPERT_URL = IS_MAINNET ? STELLAR_EXPERT_MAINNET : STELLAR_EXPERT_TESTNET

// USDC Issuer
export const USDC_ISSUER_TESTNET = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
export const USDC_ISSUER_MAINNET = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
export const USDC_ISSUER = IS_MAINNET ? USDC_ISSUER_MAINNET : USDC_ISSUER_TESTNET

// USDC Soroban Contract (for x402)
export const USDC_CONTRACT_TESTNET = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA'
export const USDC_CONTRACT_MAINNET = 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7EJJUST'
export const USDC_CONTRACT = IS_MAINNET ? USDC_CONTRACT_MAINNET : USDC_CONTRACT_TESTNET

// Payments
export const AMOUNT_STROOPS = '10000' // 0.001 USDC
export const AMOUNT_USDC = '0.001'

// Bounded paid-batch contract, shared by Express (`server/index.ts`),
// Vercel (`api/search/batch.ts`), and the MCP capability document so every
// runtime advertises the same limit.
export const MAX_BATCH_SIZE = 10

// AI request limits. Enforced by the MCP `ai_summarize` tool before any Groq
// call so an unbounded payload can never be forwarded upstream.
export const AI_TEXT_MAX_LENGTH = 10_000
export const AI_INSTRUCTION_MAX_LENGTH = 2_000
export const AI_COMBINED_MAX_LENGTH = 12_000

// ─── Startup validation ───────────────────────────────────────────────────
// Shared by the Express server and the Vercel functions so both refuse to
// serve traffic against a misconfigured Stellar network/address pair.
export const VALID_STELLAR_NETWORKS = ['stellar:testnet', 'stellar:mainnet'] as const

export function isValidStellarNetwork(network: unknown): network is (typeof VALID_STELLAR_NETWORKS)[number] {
  return typeof network === 'string' && (VALID_STELLAR_NETWORKS as readonly string[]).includes(network)
}

/** Stellar public keys are 56-character base32 strings starting with `G`. */
export function isValidStellarReceivingAddress(address: unknown): boolean {
  return typeof address === 'string' && /^G[A-Z2-7]{55}$/.test(address)
}

export function assertValidStellarConfig(config: {
  STELLAR_NETWORK?: unknown
  STELLAR_RECEIVING_ADDRESS?: unknown
}): void {
  if (!isValidStellarNetwork(config.STELLAR_NETWORK)) {
    throw new Error(
      `Invalid STELLAR_NETWORK: ${String(config.STELLAR_NETWORK)}. Expected one of: ${VALID_STELLAR_NETWORKS.join(', ')}`,
    )
  }
  if (!isValidStellarReceivingAddress(config.STELLAR_RECEIVING_ADDRESS)) {
    throw new Error(
      `Invalid STELLAR_RECEIVING_ADDRESS: expected a 56-character Stellar public key starting with G`,
    )
  }
}
