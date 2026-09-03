import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSerperBreakerState } from '../src/lib/serperClient'
import { readServerConfig } from '../src/lib/config'
import { applyServerlessHeaders } from '../src/lib/serverlessHeaders'

export default function handler(req: VercelRequest, res: VercelResponse) {
  applyServerlessHeaders(res)
  const config = readServerConfig()

  res.json({
    status: 'ok',
    network: config.stellarNetwork,
    pricePerQuery: `${config.amountUsdc} USDC`,
    protocol: 'x402',
    facilitator: config.facilitatorUrl,
    serperApiConfigured: true,
    groqApiConfigured: !!config.groqApiKey,
    receivingAddressConfigured: true,
    serperCircuitBreaker: getSerperBreakerState(),
    timestamp: new Date().toISOString(),
  })
}
