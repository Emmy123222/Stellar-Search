# 🔧 StellarSearch Troubleshooting Guide

## x402 Payment & Integration Issues

### Summary of x402 Setup

The **"Failed to parse payment requirements"** error occurs when client header resolution or wallet network settings mismatch. The correct implementation relies on `@stellar/freighter-api` and official x402 v2 protocols:

#### ✅ **Correct x402 & Freighter Integration**

1. **Proper Signer & Base64 Auth Entry**:

```typescript
import { signAuthEntry } from '@stellar/freighter-api'

// Freighter returns a Buffer / Uint8Array, x402 expects base64 string format
const signer = {
  address: walletAddress,
  signAuthEntry: async (entryXdr: string, opts?: { networkPassphrase?: string }) => {
    const result = await signAuthEntry(entryXdr, opts)
    if (result.error) throw new Error(result.error.message)
    const raw = result.signedAuthEntry
    const signedAuthEntry =
      typeof raw === 'string' ? raw : Buffer.from(raw as unknown as Uint8Array).toString('base64')
    return { signedAuthEntry, signerAddress: walletAddress }
  },
}
```

2. **Scheme Registration**:

```typescript
import { x402Client } from '@x402/fetch'
import { ExactStellarScheme } from '@x402/stellar/exact/client'

const client = new x402Client().register(
  'stellar:*',
  new ExactStellarScheme(signer, { url: SOROBAN_RPC_URL })
)
```

3. **Network Verification via `@stellar/freighter-api`**:

```typescript
import { getNetworkDetails } from '@stellar/freighter-api'

const net = await getNetworkDetails()
if (net.error) throw new Error(net.error.message)
if (net.network !== 'TESTNET') {
  throw new Error(`Switch Freighter to TESTNET. Currently on ${net.network}`)
}
```

---

## Supported Header Conventions (x402 v2)

StellarSearch implements x402 v2 specification headers across Express (`server/`), Vercel serverless (`api/`), Browser client (`src/`), and MCP server (`mcp-server/`):

| Type         | Header Name              | Version               | Description & Role                                                                       |
| ------------ | ------------------------ | --------------------- | ---------------------------------------------------------------------------------------- |
| **Response** | `PAYMENT-REQUIRED`       | **x402 v2 Canonical** | Base64-encoded JSON containing `x402Version: 2`, `resource`, and `accepts` requirements. |
| **Response** | `X-Payment-Required`     | Legacy Alias          | Backward-compatibility response header alias.                                            |
| **Request**  | `X-Payment`              | **x402 v2 Canonical** | Base64-encoded payment payload containing signed Soroban auth entry.                     |
| **Request**  | `x-payment`, `X-PAYMENT` | Case Variants         | Case-insensitive request header variants handled by Express/Vercel.                      |
| **Request**  | `payment-signature`      | Legacy Alias          | Backward-compatibility request header alias accepted by backend routes.                  |

---

## Detailed Troubleshooting Steps

### Problem 1: "Failed to parse payment requirements: Invalid payment required response"

This indicates the x402 client cannot parse or decode the server's payment header.

#### Command 1: Inspect server 402 response header

```bash
curl -v "http://localhost:3001/search?q=test" 2>&1 | grep -i payment
```

- **Expected Result**:
  ```http
  < PAYMENT-REQUIRED: eyJ4NDAyVmVyc2lvbiI6Miw...
  ```
- **Failure Interpretation**:
  - If output shows `HTTP/1.1 500 Internal Server Error` or missing headers: Server is misconfigured or missing required `.env` keys (`SERPER_API_KEY`, `GROQ_API_KEY`, `STELLAR_RECEIVING_ADDRESS`).
  - If connection is refused: Backend server is not running. Start it with `npm run server`.

#### Command 2: Base64 decode response header

```bash
echo "eyJ4NDAyVmVyc2lvbiI6Miw..." | base64 -d | jq .
```

3. **Verify required fields:**
   The decoded JSON must have:

```json
{
  "accepts": [
    {
      "scheme": "exact",
      "network": "stellar:testnet",
      "amount": "10000",
      "payTo": "GXXX..."
    }
  ]
}
```

**Common Fixes:**

- Server not base64 encoding the header
- Missing `scheme` or `network` fields
- Malformed JSON in payment requirements

### Problem: "Payment required: 0.001 USDC via x402 protocol"

This is **expected behavior** for the first step of x402 payment flow. If you're seeing this repeatedly, check:

### 1. ✅ Freighter Network Check

**Most Common Issue (90% of cases)**

```javascript
// Run in browser console:
await window.freighter.getNetworkDetails()
// Should return: { network: 'TESTNET' }
// If it returns 'PUBLIC' or anything else, that's the problem
```

**Fix**: Switch Freighter to Testnet:

1. Open Freighter extension
2. Click Settings (gear icon)
3. Select "Testnet" network
4. Refresh the page

### 2. ✅ Wallet Connection

```javascript
// Check connection status:
await window.freighter.isConnected()
// Should return: { isConnected: true }
```

**Fix**: Connect wallet:

1. Click "CONNECT FREIGHTER TO SEARCH" button
2. Approve connection in Freighter popup
3. Ensure wallet is unlocked

### 3. ✅ USDC Balance

Check you have testnet USDC:

```javascript
// Get your address:
const addr = await window.freighter.getAddress()
console.log('Address:', addr.address)

// Check balance at: https://stellar.expert/explorer/testnet/account/YOUR_ADDRESS
```

**Fix**: Get testnet USDC:

1. Go to [Stellar Laboratory](https://laboratory.stellar.org/#account-creator?network=test)
2. Create/fund testnet account
3. Add USDC trustline
4. Get testnet USDC from faucet

### 4. ✅ API Keys Configuration

Check server health:

```bash
curl http://localhost:3001/health
```

Should show:

```json
{
  "serperApiConfigured": true,
  "groqApiConfigured": true,
  "receivingAddressConfigured": true
}
```

**Fix**: Add missing API keys to `.env`:

```bash
SERPER_API_KEY=your_serper_api_key_here
OPENZEPPELIN_API_KEY=your_openzeppelin_api_key_here
GROQ_API_KEY=your_groq_api_key_here
```

## Error Messages & Solutions

### "Freighter must be on Testnet"

- **Cause**: Wallet is on wrong network
- **Fix**: Switch Freighter to Testnet in extension settings

### "Payment failed: [error]. Please ensure Freighter is unlocked"

- **Cause**: Wallet locked or user rejected transaction
- **Fix**: Unlock Freighter and approve the payment

### "Wallet not connected"

- **Cause**: Freighter not connected to the site
- **Fix**: Click connect button and approve in Freighter

### "Failed to get network details"

- **Cause**: Freighter extension not installed or not working
- **Fix**: Install Freighter from [freighter.app](https://freighter.app)

## Debug Tools

### Browser Console Commands

```javascript
// Complete network check
async function debugFreighter() {
  const network = await window.freighter.getNetworkDetails()
  const connected = await window.freighter.isConnected()
  const address = await window.freighter.getAddress()

  console.log('Network:', network.network)
  console.log('Connected:', connected.isConnected)
  console.log('Address:', address.address)

  return { network: network.network, connected: connected.isConnected }
}

debugFreighter()
```

### Network Debugger Component

When wallet is connected, the app shows a "Network Debugger" panel with real-time status.

## Expected Payment Flow

1. **User searches** → Frontend calls `/search`
2. **Server returns HTTP 402** → "Payment Required" with requirements
3. **x402 client intercepts** → Creates Stellar auth entry
4. **Freighter prompts user** → "Sign transaction" popup
5. **User approves** → Freighter signs the auth entry
6. **x402 retries request** → With payment proof in headers
7. **Server verifies payment** → OpenZeppelin facilitator settles USDC
8. **Search results returned** → Serper.dev results displayed

## Link Security & Safe Diagnostics

### Result shows `[Blocked Link]` in UI or MCP response

- **Why it occurs**: The upstream search result returned a URL with a non-http(s) scheme (e.g. `javascript:`, `data:`), a credential-bearing authority (e.g. `http://user:pass@host`), or a malformed format.
- **Safety handling**: Blocked rows render as non-interactive `<div>` containers in the UI without `href` attributes, preventing malicious clicks while keeping title and snippet readable.
- **Safe Diagnostics**: The UI header displays `SAFE DIAGNOSTICS: X SAFE, Y BLOCKED` reflecting the total count of safe vs blocked URLs.

## Still Having Issues?

1. **Check browser console** for detailed error messages
2. **Verify all API keys** are set in `.env`
3. **Ensure Freighter is on Testnet** (most common issue)
4. **Check USDC balance** on Stellar testnet
5. **Try the debug commands** above

## Quick Test Script

Save as `test-x402.html` and open in browser:

```html
<!DOCTYPE html>
<html>
  <head>
    <title>x402 Test</title>
  </head>
  <body>
    <button onclick="testX402()">Test x402 Flow</button>
    <div id="result"></div>

<script>
async function testX402() {
  const result = document.getElementById('result')

  try {
    // Check Freighter
    if (!window.freighter) {
      throw new Error('Freighter not installed')
    }

    const network = await window.freighter.getNetworkDetails()
    if (network.network !== 'TESTNET') {
      throw new Error(`Wrong network: ${network.network}. Switch to TESTNET.`)
    }

    const connected = await window.freighter.isConnected()
    if (!connected.isConnected) {
      throw new Error('Freighter not connected')
    }

    // Test search endpoint
    const response = await fetch('http://localhost:3001/search?q=test&count=3')
    if (response.status === 402) {
      result.innerHTML = '✅ x402 flow working! Server returned 402 Payment Required as expected.'
    } else {
      result.innerHTML = `❌ Unexpected response: ${response.status}`
    }

  } catch (error) {
    result.innerHTML = `❌ Error: ${error.message}`
  }
```

- **Failure Interpretation**:
  - If `base64: invalid input`: Header value was corrupted or not base64 encoded by the server handler.
  - If missing `x402Version`, `scheme`, `amount`, or `payTo`: Requirements structure does not meet x402 v2 specification.

---

### Problem 2: "Payment required: 0.001 USDC via x402 protocol"

This HTTP 402 response is expected for initial requests before payment headers are attached. If the flow halts repeatedly at this step, perform the following verification:

#### 1. ✅ Check Freighter Network via `@stellar/freighter-api`

Run the following in the browser console:

```javascript
import { getNetworkDetails } from '@stellar/freighter-api'
const details = await getNetworkDetails()
console.log('Network details:', details)
```

- **Expected Result**: `{ network: 'TESTNET' }`
- **Failure Interpretation**:
  - If `{ network: 'PUBLIC' }`: Wallet is on Mainnet. Open Freighter settings -> Network -> Switch to "Testnet".
  - If `{ error: ... }`: Freighter extension is locked or not installed.

#### 2. ✅ Check Wallet Connection Status

```javascript
import { isConnected } from '@stellar/freighter-api'
const status = await isConnected()
console.log('Connection status:', status)
```

- **Expected Result**: `{ isConnected: true }`
- **Failure Interpretation**:
  - If `isConnected: false`: Click "CONNECT FREIGHTER" in the app header and approve connection prompt.

#### 3. ✅ Check Account Address & Balances

```javascript
import { getAddress } from '@stellar/freighter-api'
const addr = await getAddress()
console.log('Address:', addr.address)
```

- **Expected Result**: Returns a valid 56-character Stellar public key starting with `G` (e.g. `GBXXX...`).
- **Failure Interpretation**:
  - If `addr.error`: Freighter popup was dismissed or locked.
  - Check account balance on Horizon: `https://horizon-testnet.stellar.org/accounts/YOUR_ADDRESS`. Ensure the account holds both native XLM (for gas fees) and testnet USDC (`CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`).

#### 4. ✅ Verify Backend Environment Setup

Run health check command:

```bash
curl -s http://localhost:3001/health | jq .
```

- **Expected Result**:
  ```json
  {
    "status": "ok",
    "network": "stellar:testnet",
    "serperApiConfigured": true,
    "groqApiConfigured": true,
    "receivingAddressConfigured": true
  }
  ```
- **Failure Interpretation**:
  - If `serperApiConfigured` or `groqApiConfigured` is `false`: Copy `.env.example` to `.env` and populate valid API keys:
  ```bash
  STELLAR_RECEIVING_ADDRESS=GBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
  SERPER_API_KEY=your_serper_api_key_here
  GROQ_API_KEY=gsk_your_groq_api_key_here
  FACILITATOR_URL=https://www.x402.org/facilitator
  ```

---

## Standard Error Messages & Fix Matrix

| Error Message                     | Root Cause                                          | Stated Fix                                                                          |
| --------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `"Switch Freighter to TESTNET"`   | Wallet network set to `PUBLIC` or Custom RPC        | Open Freighter settings and switch active network to `Testnet`.                     |
| `"Freighter extension not found"` | `@stellar/freighter-api` failed to detect extension | Install the extension from [freighter.app](https://freighter.app) and refresh page. |
| `"Wallet not connected"`          | Site domain unapproved in Freighter                 | Click **Connect Wallet** button and accept prompt in Freighter.                     |
| `"User declined signature"`       | User cancelled Soroban auth signing prompt          | Retry search query and click **Approve** in Freighter popup.                        |

---

## Debugging Utility Functions

Execute this debug helper in browser dev console:

```javascript
import { isConnected, getAddress, getNetworkDetails } from '@stellar/freighter-api'

async function debugStellarWallet() {
  console.log('🔍 Diagnostics running...')
  const connected = await isConnected()
  if (!connected.isConnected) {
    console.error('❌ Wallet disconnected')
    return { ok: false, reason: 'Disconnected' }
  }

  const address = await getAddress()
  const net = await getNetworkDetails()

  console.log('✅ Connected Address:', address.address)
  console.log('✅ Network:', net.network)

  return { ok: net.network === 'TESTNET', address: address.address, network: net.network }
}

await debugStellarWallet()
```

- **Expected Result**: `Diagnostics running...`, outputs address and `{ ok: true, address: "G...", network: "TESTNET" }`.
- **Failure Interpretation**: Identifies whether connection, network mismatch, or lock state is preventing transaction authorization.

---

## End-to-End Test Execution

To verify the x402 flow via command line:

```bash
npm run test:search "Stellar blockchain"
```

- **Expected Result**:
  ```text
  🔍 Testing StellarSearch x402 payment flow...
  📡 Status: 402 (Payment required as expected)
  ✅ Payment requirements decoded
  ✅ Results received: 5 organic search results
  ```
- **Failure Interpretation**:
  - If step 1 fails with 500: Server configuration issue or backend offline.
  - If payment authorization fails: Ensure test wallet has sufficient XLM and USDC testnet balance.

---

## Local (Express) vs. Vercel (Serverless) Runtime Discrepancies (#236)

StellarSearch runs both as a persistent Node.js Express server (`server/index.ts`) and as Vercel Serverless Functions (`api/*.ts`). Diagnostic steps for common divergence scenarios:

### 1. Endpoint Returns 404 on Vercel but Works on Express

- **Symptoms**: `GET /images` or `GET /news` succeeds against `http://localhost:3001`, but returns `404 Not Found` against `https://<vercel-deployment>/api/images` or `/images`.
- **Root Cause**: `/images`, `/news`, `POST /search/batch`, and `POST /jobs` are currently implemented only in the Express server (`server/index.ts`). Serverless functions in `api/` currently only expose `search`, `health`, and `ai/chat`.
- **Resolution**:
  - Run the Express server locally via `npm run server` or Docker (`npm run docker:run`).
  - Use the MCP server (`mcp-server/index.ts`) configured with `SEARCH_API_URL=http://localhost:3001`.
  - Track serverless porting progress:
    - Image search serverless: [#237](https://github.com/Emmy123222/Stellar-Search/issues/237) / [#330](https://github.com/Emmy123222/Stellar-Search/issues/330)
    - News search serverless: [#238](https://github.com/Emmy123222/Stellar-Search/issues/238) / [#331](https://github.com/Emmy123222/Stellar-Search/issues/331)
    - Batch streaming: [#325](https://github.com/Emmy123222/Stellar-Search/issues/325)
    - Async search jobs: [#324](https://github.com/Emmy123222/Stellar-Search/issues/324)

### 2. Activity Statistics Show "n/a" on Vercel Health Checks

- **Symptoms**: The UI dashboard shows `n/a` for total queries and latency on Vercel deployments, while local Express displays live numbers.
- **Root Cause**: By design. Serverless functions are stateless and scale to zero. Per-instance in-memory counters would reset on every cold start and report misleading partial values. Vercel's `/api/health` deliberately declares `statsSupported: false` via `declareStatsUnsupported()`.
- **Diagnostic Command**:
  ```bash
  curl -s https://<vercel-deployment>/api/health | jq .
  ```
- **Expected Result**:
  ```json
  {
    "status": "ok",
    "statsSupported": false,
    "unsupportedFields": ["totalQueries", "totalUsdcSettled", "avgLatencyMs", "uptime"],
    "statsUnavailableReason": "Serverless functions are stateless and scale to zero..."
  }
  ```

### 3. Serverless Streaming Timeouts or Truncated Responses

- **Symptoms**: Streaming responses on `/api/ai/chat` or batch endpoints terminate abruptly with `504 Gateway Timeout` or truncated chunks.
- **Root Cause**: Vercel Serverless Functions have maximum execution durations (default 10s on Hobby tier, 60s on Pro tier). Additionally, intermediate proxies may buffer streaming output if `X-Accel-Buffering: no` or `Cache-Control: no-transform` is omitted.
- **Resolution**:
  - Ensure the client sends `Accept: text/event-stream` or `application/x-ndjson`.
  - For long-running batch search tasks, use Express (`server/index.ts`).

### 4. CORS Preflight & Header Exposure Diagnosis

- **Symptoms**: Browser error: `Refused to get response header 'PAYMENT-REQUIRED'`.
- **Root Cause**: Missing CORS headers in serverless preflight or misconfigured reverse proxy.
- **Diagnostic Command**:
  ```bash
  curl -i -X OPTIONS "https://<vercel-deployment>/api/search" \
    -H "Origin: http://localhost:5173" \
    -H "Access-Control-Request-Method: GET" \
    -H "Access-Control-Request-Headers: X-Payment"
  ```
- **Expected Headers in Response**:
  ```http
  Access-Control-Allow-Origin: *
  Access-Control-Allow-Methods: GET, POST, OPTIONS
  Access-Control-Expose-Headers: PAYMENT-REQUIRED, X-Payment-Required, X-Payment-Response, X-Request-Id, Retry-After
  ```

### 5. Parameter Validation vs. Payment Rejection Proof

- **Diagnosis**: Verify whether an error originates from parameter validation or payment settlement:
  ```bash
  # Parameter validation failure: returns 400 immediately (payment never consulted)
  curl -i "http://localhost:3001/search?q=stellar&count=999"

  # Payment challenge: valid parameters, unpaid -> returns 402 with challenge
  curl -i "http://localhost:3001/search?q=stellar&count=5"
  ```
