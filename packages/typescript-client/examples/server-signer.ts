/**
 * Server Signer Example — @stellar-search/client
 *
 * Demonstrates integrating StellarSearchClient in a backend service, autonomous
 * AI agent, or CLI tool using a server signer with environment-configured credentials.
 *
 * Security:
 * - NEVER hardcode secret seeds into source code or commit them to git.
 * - Secret is read securely from `process.env.STELLAR_PRIVATE_KEY` (or a secrets manager).
 * - Secrets are redacted automatically and never echoed into log files.
 */

import dotenv from 'dotenv'
import {
  StellarSearchClient,
  createServerSigner,
  redactSecret,
  type PaymentChallenge,
} from '../src/index'

dotenv.config()

export async function runServerAgentExample() {
  const serverUrl = process.env.SEARCH_API_URL || 'http://localhost:3001'
  const privateKey = process.env.STELLAR_PRIVATE_KEY || process.env.SEARCH_PRIVATE_KEY

  console.log('--- StellarSearch Server Agent Example ---')
  console.log(`Server URL: ${serverUrl}`)
  console.log(`Private key configured: ${privateKey ? 'Yes (' + redactSecret(privateKey) + ')' : 'No (will fail paid queries)'}`)

  // 1. Create a server signer reading from secure environment variables or vault
  const serverSigner = createServerSigner({
    // Method 1: Provide via resolver callback (ideal for AWS Secrets Manager, HashiCorp Vault)
    getSecretKey: async () => {
      const key = process.env.STELLAR_PRIVATE_KEY || process.env.SEARCH_PRIVATE_KEY
      if (!key) {
        throw new Error('STELLAR_PRIVATE_KEY environment variable is not configured')
      }
      return key
    },
  })

  // 2. Initialize the typed client
  const client = new StellarSearchClient({
    baseUrl: serverUrl,
    signer: serverSigner,
    network: 'stellar:testnet',
    onPaymentRequired: async (challenge: PaymentChallenge) => {
      // Server agent budget guard: verify the price does not exceed agent policy
      const option = challenge.accepts[0]
      const priceStroops = parseInt(option?.amount || '0', 10)
      const MAX_ALLOWED_STROOPS = 50_000 // e.g. max 0.005 USDC per query

      if (priceStroops > MAX_ALLOWED_STROOPS) {
        console.warn(`[Agent Policy] Price ${priceStroops} stroops exceeds max allowed ${MAX_ALLOWED_STROOPS} stroops. Rejecting payment.`)
        return false
      }

      console.log(`[Agent Policy] Authorized payment of ${priceStroops} stroops to ${option.payTo} on ${option.network}`)
      return true
    },
  })

  // 3. Unpaid discovery check
  console.log('\n[1] Checking discovery metadata from /.well-known/x402...')
  const discovery = await client.discovery()
  console.log(`Protocol: ${discovery.protocol}, Version: ${discovery.version}`)
  console.log(`Available templates: ${discovery.resourceTemplates.map(t => t.id).join(', ')}`)

  // 4. Quote check without settling payment
  console.log('\n[2] Requesting payment quote for "Stellar Horizon API"...')
  const quote = await client.quote('search', 'Stellar Horizon API')
  console.log(`Quote received: requires ${quote.accepts[0]?.amount} stroops on ${quote.accepts[0]?.network}`)

  // 5. Execute paid web search
  console.log('\n[3] Executing paid search query...')
  const searchResults = await client.search('Stellar Horizon API guide', {
    count: 3,
    freshness: 'pm', // past month
  })

  console.log(`Search succeeded! ${searchResults.results.length} results returned in ${searchResults.latencyMs}ms.`)
  searchResults.results.forEach((r, i) => console.log(`  ${i + 1}. ${r.title} -> ${r.url}`))

  // 6. Verify receipt on ledger if settlement hash was returned
  if (searchResults.txHash) {
    console.log(`\n[4] Verifying receipt on Stellar Horizon: ${searchResults.txHash}`)
    const verification = await client.verifyReceipt({
      txHash: searchResults.txHash,
      query: searchResults.query,
      amount: searchResults.paidAmount,
      network: searchResults.network,
      timestamp: new Date().toISOString(),
    })

    console.log(`Verification status: ${verification.status}`)
    if (verification.ledgerSequence) {
      console.log(`Confirmed in ledger sequence: ${verification.ledgerSequence}`)
    }
  }

  // 7. Execute image search
  console.log('\n[5] Executing paid image search...')
  const imageResults = await client.searchImages('Stellar logo transparent', { count: 2 })
  console.log(`Image search returned ${imageResults.results.length} images.`)
  imageResults.results.forEach((img, i) => console.log(`  ${i + 1}. ${img.title} -> ${img.imageUrl}`))

  console.log('\n--- Server Agent Example Finished Successfully ---')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runServerAgentExample().catch(err => {
    console.error('Example failed:', err.message)
    process.exit(1)
  })
}
