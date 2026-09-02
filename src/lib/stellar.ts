/**
 * stellar.ts — Real Stellar Horizon helpers (no mock data)
 */

import { STELLAR_EXPERT_URL } from './constants'
import { readBrowserConfig } from './config'

export * from './constants'

/**
 * Truncates a Stellar public key address for display by preserving leading and trailing characters.
 *
 * @param address - Full Stellar public key address string (e.g. GAAZ...ZOM3).
 * @param chars - Number of leading characters to retain (defaults to 6).
 * @returns Truncated address string (e.g. "GAAZI4...ZOM3"), or empty string if address is falsy.
 */
export function truncateAddress(address: string, chars = 6): string {
  if (!address) return ''
  return `${address.slice(0, chars)}...${address.slice(-4)}`
}

/**
 * Truncates a Stellar transaction hash or hex string for display.
 *
 * @param hash - 64-character hex transaction hash string.
 * @param chars - Number of leading characters to retain (defaults to 8).
 * @returns Truncated hash string (e.g. "a1b2c3d4...abcdef"), or empty string if hash is falsy.
 */
export function truncateHash(hash: string, chars = 8): string {
  if (!hash) return ''
  return `${hash.slice(0, chars)}...${hash.slice(-6)}`
}

/**
 * Constructs a deep link URL to view a transaction on Stellar Expert block explorer.
 *
 * @param hash - Stellar transaction hash string.
 * @returns Full URL string targeting the transaction page on Stellar Expert.
 */
export function explorerTxUrl(hash: string): string {
  return `${STELLAR_EXPERT_URL}/tx/${hash}`
}

/**
 * Constructs a deep link URL to view an account address on Stellar Expert block explorer.
 *
 * @param address - Stellar public key address string.
 * @returns Full URL string targeting the account page on Stellar Expert.
 */
export function explorerAccountUrl(address: string): string {
  return `${STELLAR_EXPERT_URL}/account/${address}`
}

/**
 * Formats an ISO date/timestamp string into a human-readable relative time expression.
 *
 * @param isoString - ISO 8601 formatted timestamp string.
 * @returns Relative time string formatted as seconds, minutes, hours, or days ago (e.g., "5s ago", "2m ago").
 */
export function formatTimeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/**
 * Fetches live server statistics and health status from the backend health API endpoint.
 *
 * @returns Promise resolving to the server health status JSON object, or `null` if the request fails.
 */
export async function fetchServerStats() {
  try {
    const SERVER_URL = readBrowserConfig().apiBaseUrl
    
    const res = await fetch(`${SERVER_URL}/health`)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}
