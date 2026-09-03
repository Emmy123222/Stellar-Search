// Debug script to check Freighter network
// Run this in browser console when Freighter is connected

async function checkFreighterNetwork() {
  try {
    // Check if Freighter is available
    if (!window.freighter) {
      console.log('❌ Freighter extension not found')
      return
    }

    // Get network details
    const networkDetails = await window.freighter.getNetworkDetails()
    console.log('🌐 Network Details:', networkDetails)

    if (networkDetails.network === 'TESTNET') {
      console.log('✅ Freighter is on TESTNET - Ready for x402 payments!')
    } else {
      console.log(`❌ Wrong network: ${networkDetails.network}`)
      console.log('🔧 Please switch Freighter to Testnet in extension settings')
    }

    // Check if connected
    const isConnected = await window.freighter.isConnected()
    console.log('🔗 Connected:', isConnected)

    // Get address if connected
    if (isConnected.isConnected) {
      const address = await window.freighter.getAddress()
      console.log('👤 Address:', address.address)
    }
  } catch (error) {
    console.log('❌ Error checking network:', error.message)
  }
}

// Run the check
checkFreighterNetwork()
