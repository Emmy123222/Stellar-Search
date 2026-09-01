import type { VercelRequest, VercelResponse } from '@vercel/node'
import { readServerConfig } from '../src/lib/config'

export default function handler(req: VercelRequest, res: VercelResponse) {
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
    timestamp: new Date().toISOString(),
  })
}
