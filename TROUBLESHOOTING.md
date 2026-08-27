# 🔧 StellarSearch Troubleshooting Guide

## x402 Payment Issues

## Summary of the Fix

The **"Failed to parse payment requirements"** error was caused by incorrect x402 client setup. The fix involves:

### ✅ **Correct x402 Integration**

1. **Proper Signer Format**:

```typescript
// Freighter returns Buffer, x402 expects string format
signAuthEntry: async (entryXdr, opts) => {
  const result = await signAuthEntry(entryXdr, opts)
  return {
    signedAuthEntry: result.signedAuthEntry.toString('base64'),
    signerAddress: result.signerAddress,
  }
}
```

2. **Correct Registration**:

```typescript
// Use ExactStellarScheme constructor, not registerExactStellarScheme
client.register('stellar:testnet', new ExactStellarScheme(signer, rpcConfig))
```

3. **Network Verification**:

```typescript
// Must verify Freighter is on TESTNET before creating client
const netDetails = await getNetworkDetails()
if (netDetails.network !== 'TESTNET') {
  throw new Error('Switch Freighter to TESTNET')
}
```

### Problem: "Failed to parse payment requirements: Invalid payment required response"

This indicates the x402 client can't parse the server's payment header.

**Debug Steps:**

1. **Check server response format:**

```bash
curl -v "http://localhost:3001/search?q=test" 2>&1 | grep -i payment
```

2. **Decode the payment header:**

```bash
# Copy the PAYMENT-REQUIRED header value and decode:
echo "HEADER_VALUE_HERE" | base64 -d | jq .
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
            result.innerHTML =
              '✅ x402 flow working! Server returned 402 Payment Required as expected.'
          } else {
            result.innerHTML = `❌ Unexpected response: ${response.status}`
          }
        } catch (error) {
          result.innerHTML = `❌ Error: ${error.message}`
        }
      }
    </script>
  </body>
</html>
```
