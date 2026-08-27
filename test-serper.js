// Simple test to verify Serper.dev API integration
const fetch = require('node-fetch')

async function testSerper() {
  const SERPER_API_KEY = 'your_serper_api_key_here' // Replace with actual key

  if (SERPER_API_KEY === 'your_serper_api_key_here') {
    console.log('❌ Please set a real SERPER_API_KEY in this file')
    return
  }

  try {
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': SERPER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: 'Stellar blockchain',
        num: 5,
      }),
    })

    if (!response.ok) {
      console.log('❌ Serper API error:', response.status, await response.text())
      return
    }

    const data = await response.json()
    console.log('✅ Serper.dev API working!')
    console.log('Results:', data.organic?.length || 0)

    if (data.organic && data.organic.length > 0) {
      console.log('\nFirst result:')
      console.log('Title:', data.organic[0].title)
      console.log('URL:', data.organic[0].link)
      console.log('Snippet:', data.organic[0].snippet?.substring(0, 100) + '...')
    }
  } catch (error) {
    console.log('❌ Error:', error.message)
  }
}

testSerper()
