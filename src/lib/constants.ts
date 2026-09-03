/**
 * constants.ts
 * Centralized configuration for the Stellar environment.
 */

import { StrKey } from '@stellar/stellar-sdk'

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

  return (
    StrKey.isValidEd25519PublicKey(trimmedValue) ||
    /^G[A-Z2-7]{55}$/.test(trimmedValue)
  )
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
  config: { STELLAR_NETWORK?: string; STELLAR_RECEIVING_ADDRESS?: string } = {},
): void => {
  const network = config.STELLAR_NETWORK ?? STELLAR_NETWORK
  const receivingAddress = config.STELLAR_RECEIVING_ADDRESS ?? process.env.STELLAR_RECEIVING_ADDRESS ?? ''

  if (!isValidStellarNetwork(network)) {
    throw new Error(
      `Invalid STELLAR_NETWORK "${redactStellarValue(network)}". Expected one of: ${VALID_STELLAR_NETWORKS.join(', ')}.`,
    )
  }

  if (!isValidStellarReceivingAddress(receivingAddress)) {
    throw new Error(
      `Invalid STELLAR_RECEIVING_ADDRESS "${redactStellarValue(receivingAddress)}". Expected a valid Stellar public key for ${network}.`,
    )
  }
}

export const STELLAR_NETWORK = getEnv('STELLAR_NETWORK', 'stellar:testnet')
export const IS_MAINNET = STELLAR_NETWORK === 'stellar:mainnet'
export const EXPECTED_WALLET_NETWORK = IS_MAINNET ? 'PUBLIC' : 'TESTNET'

export const HORIZON_TESTNET = 'https://horizon-testnet.stellar.org'
export const HORIZON_MAINNET = 'https://horizon.stellar.org'
export const HORIZON_URL = IS_MAINNET ? HORIZON_MAINNET : HORIZON_TESTNET

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

// Maximum search query length (characters) — enforced client-side and by the API.
// Advanced operators (site:, filetype:, exact phrases, -exclude) are allowed;
// they do not change the per-query payment amount.
export const MAX_QUERY_LENGTH = 2048

// Payments
export const AMOUNT_STROOPS = '10000' // 0.001 USDC
export const AMOUNT_USDC = '0.001'
