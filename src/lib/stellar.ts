/**
 * stellar.ts — Real Stellar Horizon helpers (no mock data)
 */

import { STELLAR_EXPERT_URL } from './constants'

export * from './constants'

export function truncateAddress(address: string, chars = 6): string {
  if (!address) return ''
  return `${address.slice(0, chars)}...${address.slice(-4)}`
}

export function truncateHash(hash: string, chars = 8): string {
  if (!hash) return ''
  return `${hash.slice(0, chars)}...${hash.slice(-6)}`
}

export function explorerTxUrl(hash: string): string {
  return `${STELLAR_EXPERT_URL}/tx/${hash}`
}

export function explorerAccountUrl(address: string): string {
  return `${STELLAR_EXPERT_URL}/account/${address}`
}

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
 * Fetch live server stats from the /api/health endpoint.
 * Uses the same SERVER_URL logic as the search functionality.
 */
export async function fetchServerStats() {
  try {
    const SERVER_URL = (import.meta as any).env?.VITE_SERVER_URL ?? (
      typeof window !== 'undefined' && window.location.origin.includes('vercel.app') 
        ? `${window.location.origin}/api`
        : 'http://localhost:3001'
    )
    
    const res = await fetch(`${SERVER_URL}/health`)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}
