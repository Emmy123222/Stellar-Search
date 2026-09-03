// Test what payment header format the x402 client expects
// Run this in Node.js to test different formats

const testFormats = [
  // Current server format (what we're sending)
  {
    name: 'Current Server Format',
    data: {
      x402Version: 2,
      error: 'Payment required',
      resource: {
        url: 'http://localhost:3001/search?q=test',
        description: 'StellarSearch: pay-per-query web search for AI agents',
        mimeType: 'application/json',
      },
      accepts: [
        {
          scheme: 'exact',
          network: 'stellar:testnet',
          amount: '10000',
          asset: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
          payTo: 'GDXA3V2LI3VN3GBH5BMOF25QSFJV7S7ZOWMHHQMJRPP4BVORDDRTIIMU',
          maxTimeoutSeconds: 300,
          extra: {
            areFeesSponsored: true,
          },
        },
      ],
    },
  },

  // Simplified format (what client might expect)
  {
    name: 'Simplified Format',
    data: {
      accepts: [
        {
          scheme: 'exact',
          network: 'stellar:testnet',
          amount: '10000',
          payTo: 'GDXA3V2LI3VN3GBH5BMOF25QSFJV7S7ZOWMHHQMJRPP4BVORDDRTIIMU',
        },
      ],
    },
  },

  // V1 format
  {
    name: 'V1 Format',
    data: {
      x402Version: 1,
      error: 'Payment required',
      accepts: [
        {
          scheme: 'exact',
          network: 'stellar:testnet',
          maxAmountRequired: '10000',
          resource: 'http://localhost:3001/search?q=test',
          description: 'StellarSearch: pay-per-query web search for AI agents',
          mimeType: 'application/json',
          outputSchema: {},
          payTo: 'GDXA3V2LI3VN3GBH5BMOF25QSFJV7S7ZOWMHHQMJRPP4BVORDDRTIIMU',
          maxTimeoutSeconds: 300,
          asset: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
          extra: {},
        },
      ],
    },
  },
]

console.log('Testing different payment header formats:\n')

testFormats.forEach(format => {
  console.log(`${format.name}:`)
  const encoded = Buffer.from(JSON.stringify(format.data)).toString('base64')
  console.log(`Base64: ${encoded.substring(0, 50)}...`)
  console.log(`JSON: ${JSON.stringify(format.data, null, 2)}\n`)
})

console.log('To test with curl:')
console.log('curl -H "PAYMENT-REQUIRED: <base64_here>" http://localhost:3001/search?q=test')
