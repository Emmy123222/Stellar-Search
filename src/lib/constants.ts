/**
 * constants.ts
 * Centralized Stellar network constants for both Frontend and Backend.
 */

import { readBrowserConfig } from './config'

// Browser code only receives VITE_* values through this typed view.
const browserConfig = readBrowserConfig()
export const STELLAR_NETWORK = browserConfig.stellarNetwork
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

/**
 * Resolves the base URL for backend API requests across development, production, and Vercel environments
 * without relying on brittle hostname matching.
 */
export function getServerUrl(): string {
  const envUrl = getEnv('SERVER_URL', '')
  if (envUrl) {
    return envUrl
  }
  const win = typeof globalThis !== 'undefined' ? (globalThis as any).window : undefined
  if (typeof win !== 'undefined' && win?.location) {
    const isLocalhost = win.location.hostname === 'localhost' || win.location.hostname === '127.0.0.1'
    // @ts-ignore
    const isProd = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.PROD
    if (!isLocalhost || isProd) {
      return `${win.location.origin}/api`
    }
  }
  return 'http://localhost:3001'
}

export const SERVER_URL = getServerUrl()

