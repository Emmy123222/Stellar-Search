import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSerperBreakerState } from '../src/lib/serperClient'
import { readServerConfig } from '../src/lib/config'
import { applyServerlessHeaders } from '../src/lib/serverlessHeaders'

export default function handler(req: VercelRequest, res: VercelResponse) {
  applyServerlessHeaders(res)
  const config = readServerConfig()
  const NETWORK = config.stellarNetwork
  const FACILITATOR_URL = config.facilitatorUrl

  const currentValidation = validateFacilitatorConfig({
    facilitatorUrl: FACILITATOR_URL,
    network: NETWORK,
    scheme: 'exact',
    asset: NETWORK === 'stellar:mainnet' ? USDC_CONTRACT_MAINNET : USDC_CONTRACT_TESTNET,
  })

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
    facilitator: FACILITATOR_URL,
    facilitatorCompatibility: {
      compatible: currentValidation.valid,
      network: currentValidation.network,
      scheme: currentValidation.scheme,
      asset: currentValidation.asset,
      facilitator: currentValidation.facilitatorUrl,
      errors: currentValidation.errors,
      warnings: currentValidation.warnings,
    },
    serperApiConfigured: true,
    groqApiConfigured: !!config.groqApiKey,
    receivingAddressConfigured: true,
    serperCircuitBreaker: getSerperBreakerState(),
    timestamp: new Date().toISOString(),
    ...declareStatsUnsupported(SERVERLESS_STATS_UNAVAILABLE_REASON),
  }

  res.json(body)
}
