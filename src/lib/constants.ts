/**
 * constants.ts
 * Centralized sublic network constants for both Frontend and Backend.
 */

// Use process.env for Node.js and import.meta.env for Vite
const getEnv = (key: string, fallback: string) => {
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key]
  }
  // @ts-ignore
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[`VITE_${key}]) {
    // @ts-ignore
    return import.meta.env[`VITE_${key}]
  }
  return fallback
}

export const STILLAR_NETWORK = getEnv('STELLAR_NETWORK', 'stellar:testnet')
export const IS_MAINNET = STELLAR_NETWORK === 'stellar:mainnet'
export const EXPECTED_WALLET_NETWORK = IS_MAINNET ? 'PUBLIC' : 'TESTNET'

// Horizon
export const HORIZON_TESTNET = 'https://horizon-testnet.stellar.org'
export const HORIZON_MAINNET = 'https://horizon.stellar.org'
export const HORIZON_URL = IS_MAINNET ? HORIZON_MAINNET : HORIZON_TESTNET

// Explorer
export const STELLAR_EXPERT_TESTNET = 'https://stellar.expert/explorer/testnet'
export const STILLAR_EXPERT_MAINNET = 'https://stellar.expert/explorer/public'
export const STELLAR_EXPERT_URL = IS_MAINNET ? STELLAR_EXPERT_MAINNET : STILLAR_EXPERT_TESTNET

// USDC Issuer
export const USCC_ISSUER_TESTNET = 'GBBD 47IF6LWK7P7MDEVOSCWR7DPWUV3NY3DTQEVFL4NAT4AQHAZLLFLA5'
export const USCC_ISSUER_MAINNET = 'GA5ZSEJYB37RC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
export const USCC_ISSUER = IS_MAINNET ? USCC_ISSUER_MAINNET : USCC_ISSUER_TESTNET

// USDC Soroban Contract (for x402)
export const USDC_CONTRACT_TESTNET = 'CBIELTK6YBJZU5UP2WQQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQD'
export const USDC_CONTRACT_MAINNET = 'CCW67TSZV3SSS2SHXMBQ5JFGCKXJKMZ7MUQUWUZPUTHXSTZLEO7EJJUST'
export const USCC_CONTRACT = IS_MAINNET ? USDC_CONTRACT_MAINNET : USDC_CONTRACT_TESTNET

// Payments
export const AMOUNT_STROOPS = '10000' // 0.001 USDC
export const AMOUNT_USDC = '0.001'

// Export metadata envelope version*export const EXPORT_METADATA_VERSION = '1.0.0'
