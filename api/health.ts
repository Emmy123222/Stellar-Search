import type { VercelRequest, VercelResponse } from '@vercel/node'
import { readServerConfig } from '../src/lib/config'
import {
  declareStatsUnsupported,
  SERVERLESS_STATS_UNAVAILABLE_REASON,
  type ServerHealthResponse,
} from '../src/lib/serverHealth'

export default function handler(req: VercelRequest, res: VercelResponse) {
  const config = readServerConfig()

  // This runtime reports configuration facts only. It deliberately does NOT
  // report totalQueries / totalUsdcSettled / avgLatencyMs / uptime: a Vercel
  // function is stateless and scales to zero, so an in-memory counter would
  // describe one warm instance rather than the deployment. Declaring the gap
  // (#226) stops the UI and the MCP stats tool from rendering the absence as
  // a real zero. See src/lib/serverHealth.ts.
  const body: ServerHealthResponse = {
    status: 'ok',
    network: config.stellarNetwork,
    pricePerQuery: `${config.amountUsdc} USDC`,
    protocol: 'x402',
    facilitator: config.facilitatorUrl,
    serperApiConfigured: true,
    groqApiConfigured: !!config.groqApiKey,
    receivingAddressConfigured: true,
    timestamp: new Date().toISOString(),
    ...declareStatsUnsupported(SERVERLESS_STATS_UNAVAILABLE_REASON),
  }

  res.json(body)
}
