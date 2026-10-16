/**
 * Browser Signer Example — @stellar-search/client
 *
 * Demonstrates integrating StellarSearchClient in a browser application with
 * Freighter wallet for paid x402 search without holding or exposing private keys.
 *
 * Security:
 * - NEVER embed private keys or seeds in client-side bundles.
 * - Signatures are securely generated via Freighter wallet extension.
 * - Preserves explicit user approval before signing payments.
 */

import {
  StellarSearchClient,
  createBrowserSigner,
  type PaymentChallenge,
} from '../src/index'

// Simulate or import Freighter API in browser environment:
// import { signAuthEntry, getPublicKey } from '@stellar/freighter-api'
async function getFreighterWallet() {
  if (typeof window === 'undefined') {
    throw new Error('Browser wallet signer can only run in a browser runtime')
  }

  // Check if Freighter extension is installed
  const freighter = (window as any).freighter
  if (!freighter) {
    throw new Error('Freighter wallet extension not found. Please install Freighter from https://www.freighter.app')
  }

  return {
    signAuthEntry: (xdr: string, opts?: { networkPassphrase?: string }) =>
      freighter.signAuthEntry(xdr, opts),
    getPublicKey: () => freighter.getPublicKey(),
  }
}

export async function runBrowserSearchExample(userQuery = 'Stellar Soroban smart contracts') {
  console.log(`[Browser Example] Initializing client for query: "${userQuery}"`)

  // 1. Initialize Freighter browser signer adapter (NO embedded secrets)
  const wallet = await getFreighterWallet().catch(() => ({
    // Mock wallet for demonstration if running in test/sandbox environment
    signAuthEntry: async (_entryXdr: string) => {
      console.log('[Freighter Mock] User approved signing prompt for auth entry')
      return { signedAuthEntry: 'mockSignedAuthEntryBase64==' }
    },
    getPublicKey: async () => 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3',
  }))

  const browserSigner = createBrowserSigner(wallet, {
    expectedNetwork: 'stellar:testnet',
  })

  // 2. Initialize StellarSearchClient with explicit user approval hook
  const client = new StellarSearchClient({
    baseUrl: 'http://localhost:3001', // Or your Vercel deployment URL
    signer: browserSigner,
    network: 'stellar:testnet',
    onPaymentRequired: async (challenge: PaymentChallenge) => {
      const option = challenge.accepts[0]
      const price = option ? `${Number(option.amount) / 10_000_000} USDC` : '0.001 USDC'
      console.log(`[Approval Prompt] This search requires an x402 payment of ${price} on ${option?.network || 'Stellar'}.`)

      // In a real UI, this would show a confirmation modal or prompt to the user
      const userApproved = true // e.g. await showConfirmModal(...)
      if (!userApproved) {
        console.log('[Approval Prompt] User rejected payment request')
        return false
      }

      console.log('[Approval Prompt] User confirmed payment')
      return true
    },
  })

  // 3. Execute paid search with automatic 402 challenge handling & wallet approval
  try {
    const response = await client.search(userQuery, {
      count: 3,
      suggestions: true,
    })

    console.log(`\n[Search Complete] Returned ${response.count} results (Latency: ${response.latencyMs}ms):`)
    response.results.forEach((item, idx) => {
      console.log(`  ${idx + 1}. ${item.title} (${item.url})`)
    })

    if (response.txHash) {
      console.log(`\nSettlement Receipt: On-chain txHash = ${response.txHash}`)
      console.log(`View on StellarExpert: https://stellar.expert/explorer/testnet/tx/${response.txHash}`)

      // 4. Verify receipt on-chain via Horizon
      const verification = await client.verifyReceipt({
        txHash: response.txHash,
        query: response.query,
        amount: response.paidAmount,
        network: response.network,
        timestamp: new Date().toISOString(),
      })

      console.log(`Receipt Verification Status: ${verification.status.toUpperCase()}`)
    }

    return response
  } catch (err: any) {
    console.error('[Browser Search Error]:', err.message)
    throw err
  }
}
