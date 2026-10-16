# @stellar-search/client

Typed TypeScript client SDK for paid search using the **x402 payment protocol** on **Stellar**.

Enables autonomous AI agents, backend services, and web applications to search the web, images, and news with verified micropayments in **USDC**.

---

## Features

- 🌐 **Web, Image & News Search**: Typed methods for `/search`, `/images`, and `/news` with automatic 402 challenge parsing and payment retry.
- 🔐 **Pluggable Signers**:
  - **Browser Signer**: Seamlessly connects to [Freighter wallet](https://www.freighter.app) without ever touching private keys.
  - **Server Signer**: Securely loads signing credentials from environment variables (`STELLAR_PRIVATE_KEY`) or external secret managers (Vault/KMS).
- 🛡️ **Explicit User Approval**: Built-in `onPaymentRequired` confirmation hook to prevent silent or unauthorized fund transfers.
- 🔍 **On-Chain Receipt Verification**: Verifies settlement proofs against the Stellar Horizon ledger directly (`verifyReceipt` & `verifyReceipts`).
- 🩺 **Health & Price Discovery**: First-class support for `/health` and `/.well-known/x402` machine-readable price discovery.
- 🔒 **Zero-Leakage Security**: Built-in secret redaction ensures private keys are never echoed into logs, error messages, or shell outputs.
- ⚡ **Runtime Parity**: Works identically across Node.js, Express, Vercel Serverless, browser, and MCP agent environments.

---

## Installation

```bash
npm install @stellar-search/client @stellar/stellar-sdk
```

*(For browser applications using Freighter)*:
```bash
npm install @stellar/freighter-api
```

---

## Quickstart

### 1. Backend / AI Agent with Server Signer

```typescript
import {
  StellarSearchClient,
  createServerSigner,
  type PaymentChallenge,
} from '@stellar-search/client'

// 1. Create a server signer from environment variables
const signer = createServerSigner({
  getSecretKey: async () => process.env.STELLAR_PRIVATE_KEY!,
})

// 2. Initialize the client
const client = new StellarSearchClient({
  baseUrl: process.env.SEARCH_API_URL || 'http://localhost:3001',
  signer,
  network: 'stellar:testnet', // or 'stellar:mainnet'
  onPaymentRequired: async (challenge: PaymentChallenge) => {
    // Budget guard: verify price does not exceed max allowed
    const priceStroops = parseInt(challenge.accepts[0]?.amount || '0', 10)
    return priceStroops <= 50_000 // Approve if <= 0.005 USDC
  },
})

// 3. Perform a paid web search
const response = await client.search('Stellar smart contracts', {
  count: 5,
  freshness: 'pw', // past week
  suggestions: true,
})

console.log(`Received ${response.count} results (Latency: ${response.latencyMs}ms):`)
for (const item of response.results) {
  console.log(`- ${item.title}: ${item.url}`)
}

// 4. Verify the settlement receipt on Horizon
if (response.txHash) {
  const verification = await client.verifyReceipt({
    txHash: response.txHash,
    query: response.query,
    amount: response.paidAmount,
    network: response.network,
    timestamp: new Date().toISOString(),
  })
  console.log(`Receipt Status: ${verification.status}`) // 'confirmed'
}
```

---

### 2. Browser Application with Freighter Wallet

```typescript
import {
  StellarSearchClient,
  createBrowserSigner,
  type PaymentChallenge,
} from '@stellar-search/client'
import * as freighter from '@stellar/freighter-api'

// 1. Create a browser signer adapter (never holds private keys)
const signer = createBrowserSigner(freighter, {
  expectedNetwork: 'stellar:testnet',
})

// 2. Initialize client with explicit user confirmation
const client = new StellarSearchClient({
  baseUrl: 'https://your-search-api.com',
  signer,
  onPaymentRequired: async (challenge: PaymentChallenge) => {
    // Prompt the user in the UI before requesting wallet signature
    return window.confirm('Authorize 0.001 USDC payment for this search?')
  },
})

// 3. Search with pop-up signature
const results = await client.search('Soroban contracts tutorial')
console.log(results.results)
```

---

## API Reference

### `new StellarSearchClient(options)`

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `baseUrl` | `string` | `'http://localhost:3001'` | API server base URL. Handles `/api` prefixes automatically. |
| `signer` | `ClientSigner` | `undefined` | Default signer adapter for settling x402 payments. |
| `network` | `string` | `'stellar:testnet'` | Target Stellar network identifier (`stellar:testnet` or `stellar:mainnet`). |
| `horizonUrl` | `string` | SDF default | Custom Horizon endpoint URL for ledger lookups. |
| `onPaymentRequired`| `Function` | `undefined` | Hook called when 402 challenge is received. Return `false` to abort payment. |
| `timeoutMs` | `number` | `30000` | HTTP request timeout in milliseconds. |
| `headers` | `Record<string, string>`| `{}` | Default headers to include in all requests. |

---

### Methods

#### `client.search(query, options?): Promise<SearchResponse>`
Executes an organic web search paying 0.001 USDC via x402.
- `options.count`: Number of results (1–20, default 5).
- `options.freshness`: Date filter (`'pd'` past day, `'pw'` past week, `'pm'` past month).
- `options.includeDomains`: List of domains to restrict results to.
- `options.excludeDomains`: List of domains to exclude from results.
- `options.suggestions`: Set `true` to return related search suggestions.

#### `client.searchImages(query, options?): Promise<ImageSearchResponse>`
Executes an image search paying 0.001 USDC via x402.
- `options.count`: Number of image results (1–10, default 10).

#### `client.searchNews(query, options?): Promise<NewsSearchResponse>`
Executes a news search paying 0.001 USDC via x402.
- `options.count`: Number of news articles (1–20, default 10).
- `options.freshness`: Date filter (`'pd'`, `'pw'`, `'pm'`).

#### `client.quote(endpoint, query, options?): Promise<PaymentChallenge>`
Requests payment terms and challenge details from the server without initiating payment or invoking the signer.

#### `client.health(): Promise<ServerHealthResponse>`
Queries the `/health` endpoint to check readiness, uptime, and pricing status.

#### `client.discovery(): Promise<X402DiscoveryMetadata>`
Queries the `/.well-known/x402` endpoint to discover supported schemes, networks, and price templates.

#### `client.verifyReceipt(receipt, options?): Promise<ReceiptVerificationDetail>`
Verifies an on-chain search receipt against the Stellar Horizon ledger. Returns `'confirmed'`, `'mismatched'`, or `'unverified'`.

#### `client.verifyReceipts(receipts, options?): Promise<Map<string, ReceiptVerificationDetail>>`
Verifies multiple receipts in parallel against Horizon.

---

## Security Best Practices

1. **Never Hardcode Secrets**: Never embed `S...` private keys in application code, frontend bundles, or git repositories.
2. **Use Environment Variables**: In backend services and autonomous agents, provide keys via `process.env.STELLAR_PRIVATE_KEY` or a dedicated secrets manager (`getSecretKey` callback).
3. **Use Browser Signers**: In browser environments, always use `createBrowserSigner` with Freighter so the user retains custody and explicitly authorizes each transaction.
4. **Enforce Approval Hooks**: Always implement `onPaymentRequired` to safeguard budgets and avoid accidental spending loops.

---

## License

MIT © StellarSearch Contributors
