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
    const signedAuthEntry = typeof raw === 'string'
      ? raw
      : Buffer.from(raw as unknown as Uint8Array).toString('base64')
    return { signedAuthEntry, signerAddress: walletAddress }
  }
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

| Type | Header Name | Version | Description & Role |
|---|---|---|---|
| **Response** | `PAYMENT-REQUIRED` | **x402 v2 Canonical** | Base64-encoded JSON containing `x402Version: 2`, `resource`, and `accepts` requirements. |
| **Response** | `X-Payment-Required` | Legacy Alias | Backward-compatibility response header alias. |
| **Request** | `X-Payment` | **x402 v2 Canonical** | Base64-encoded payment payload containing signed Soroban auth entry. |
| **Request** | `x-payment`, `X-PAYMENT` | Case Variants | Case-insensitive request header variants handled by Express/Vercel. |
| **Request** | `payment-signature` | Legacy Alias | Backward-compatibility request header alias accepted by backend routes. |

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
- **Expected Result**:
  ```json
  {
    "x402Version": 2,
    "error": "Payment required",
    "resource": {
      "url": "http://localhost:3001/search?q=test",
      "description": "StellarSearch: pay-per-query web search — 0.001 USDC on Stellar",
      "mimeType": "application/json"
    },
    "accepts": [{
      "scheme": "exact",
      "network": "stellar:testnet",
      "amount": "10000",
      "payTo": "GBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
    }]
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

| Error Message | Root Cause | Stated Fix |
|---|---|---|
| `"Switch Freighter to TESTNET"` | Wallet network set to `PUBLIC` or Custom RPC | Open Freighter settings and switch active network to `Testnet`. |
| `"Freighter extension not found"` | `@stellar/freighter-api` failed to detect extension | Install the extension from [freighter.app](https://freighter.app) and refresh page. |
| `"Wallet not connected"` | Site domain unapproved in Freighter | Click **Connect Wallet** button and accept prompt in Freighter. |
| `"User declined signature"` | User cancelled Soroban auth signing prompt | Retry search query and click **Approve** in Freighter popup. |

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