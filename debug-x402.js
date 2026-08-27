// Debug script to test x402 client setup
// Run this in browser console after connecting Freighter

async function debugX402Client() {
  console.log('🔧 Testing x402 Client Setup...\n')

  try {
    // 1. Check Freighter connection
    console.log('1️⃣ Checking Freighter...')
    if (!window.freighter) {
      throw new Error('Freighter extension not found')
    }

    const connected = await window.freighter.isConnected()
    if (!connected.isConnected) {
      throw new Error('Freighter not connected')
    }
    console.log('✅ Freighter connected')

    // 2. Check network
    console.log('\n2️⃣ Checking network...')
    const network = await window.freighter.getNetworkDetails()
    console.log('Network:', network.network)
    if (network.network !== 'TESTNET') {
      throw new Error(`Wrong network: ${network.network}. Switch to TESTNET.`)
    }
    console.log('✅ Network is TESTNET')

    // 3. Get wallet address
    console.log('\n3️⃣ Getting wallet address...')
    const address = await window.freighter.getAddress()
    console.log('Address:', address.address)
    console.log('✅ Wallet address obtained')

    // 4. Test server 402 response
    console.log('\n4️⃣ Testing server 402 response...')
    const response = await fetch('http://localhost:3001/search?q=test&count=3')
    console.log('Status:', response.status)

    if (response.status !== 402) {
      throw new Error(`Expected 402, got ${response.status}`)
    }

    const paymentHeader = response.headers.get('PAYMENT-REQUIRED')
    if (!paymentHeader) {
      throw new Error('No PAYMENT-REQUIRED header found')
    }

    console.log('✅ Server returned 402 with payment header')

    // 5. Decode payment requirements
    console.log('\n5️⃣ Decoding payment requirements...')
    try {
      const decoded = JSON.parse(atob(paymentHeader))
      console.log('Payment requirements:', decoded)

      if (!decoded.accepts || decoded.accepts.length === 0) {
        throw new Error('No payment options in requirements')
      }

      const paymentOption = decoded.accepts[0]
      console.log('First payment option:', paymentOption)

      // Check required fields
      const requiredFields = ['scheme', 'network', 'amount', 'payTo']
      for (const field of requiredFields) {
        if (!paymentOption[field]) {
          throw new Error(`Missing required field: ${field}`)
        }
      }

      console.log('✅ Payment requirements valid')
      console.log('   Scheme:', paymentOption.scheme)
      console.log('   Network:', paymentOption.network)
      console.log('   Amount:', paymentOption.amount, 'stroops')
      console.log('   PayTo:', paymentOption.payTo.slice(0, 8) + '...')
    } catch (decodeError) {
      throw new Error(`Failed to decode payment header: ${decodeError.message}`)
    }

    console.log('\n🎉 All checks passed! x402 setup looks correct.')
    console.log('\n💡 If payment still fails, the issue might be:')
    console.log('   - Freighter wallet needs to be unlocked')
    console.log('   - Insufficient USDC balance')
    console.log('   - User rejecting the payment prompt')
  } catch (error) {
    console.error('\n❌ x402 setup issue:', error.message)
    console.log('\n🔧 Troubleshooting steps:')
    console.log('   1. Install Freighter extension')
    console.log('   2. Connect to the site')
    console.log('   3. Switch to Testnet')
    console.log('   4. Ensure server is running on port 3001')
  }
}

// Run the debug
debugX402Client()
