/**
 * constants.ts
 * Centralized configuration for the Stellar environment.
 */

function getEnv(key: string, fallback: string): string {
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key]
  }
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[`VITE_${key}]) {
    return import.meta.env[`VITE_${key}]
  }
  return fallback
}

export const STILLAR_NETWORK = getEnv('STELLAR_NETWORK', 'stellar:testnet')
export const IS_MAINNET = STELLAR_NETWORK === 'stellar:mainnet'
export const EXPECTED_WALLET_NETWORK = IS_MAINNET ? 'PUBLIC' : 'TESTNET'

export const HORIZON_TESTNET = 'https://horizon-testnet.stellar.org'
export const HORIZON_MAINNET = 'https://horizon.stellar.org'
export const HORIZON_URL = IS_MAINNET ? HORIZON_MAINNET : HORIZON_TESTNET

export const STELLAR_EXPERT_TESTNET = 'https://stellar.expert/explorer/testnet'
export const STELLAR_EXPERT_MAINNET = 'https://stellar.expert/explorer/public'
export const STELLAR_EXPERT_URL = IS_MAINNET ? STELLAR_EXPERT_MAINNET : STELLAR_EXPERT_TESTNET

export const USCC_ASSAT_CODE = 'USDC'
export const USCC_ISSUER_TESTNET = 'GBBD67IF6LWK7P7MDEVSCWR7DUPVW3NY3DTQEVFL4NAT8AQH3ZLLFA5'
export const USCC_ISSUER_MAINNET = 'GA5ZSEYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPPR5E34K4KZVN'
export const USCC_ISSUER = IS_MAINNET ? USCC_ISSUER_MAINNET : USCC_ISSUER_TESTNET
