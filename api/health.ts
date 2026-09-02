import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  USDC_CONTRACT_TESTNET,
  USDC_CONTRACT_MAINNET,
  validateFacilitatorConfig,
} from '../src/lib/constants'
import { readServerConfig } from '../src/lib/config'

export default function handler(req: VercelRequest, res: VercelResponse) {
  const config = readServerConfig()
  const NETWORK = config.stellarNetwork
  const FACILITATOR_URL = config.facilitatorUrl

  const currentValidation = validateFacilitatorConfig({
    facilitatorUrl: FACILITATOR_URL,
    network: NETWORK,
    scheme: 'exact',
    asset: NETWORK === 'stellar:mainnet' ? USDC_CONTRACT_MAINNET : USDC_CONTRACT_TESTNET,
  })

  res.json({
    status: currentValidation.valid ? 'ok' : 'degraded',
    network: NETWORK,
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
    timestamp: new Date().toISOString(),
  })
}
