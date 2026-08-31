import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  USDC_CONTRACT_TESTNET,
  USDC_CONTRACT_MAINNET,
  validateFacilitatorConfig,
} from '../src/lib/constants'

export default function handler(req: VercelRequest, res: VercelResponse) {
  const NETWORK = process.env.STELLAR_NETWORK || 'stellar:testnet'
  const FACILITATOR_URL = process.env.FACILITATOR_URL || 'https://www.x402.org/facilitator'
  const SERPER_API_KEY = process.env.SERPER_API_KEY
  const GROQ_API_KEY = process.env.GROQ_API_KEY
  const RECEIVING_ADDRESS = process.env.STELLAR_RECEIVING_ADDRESS

  const currentValidation = validateFacilitatorConfig({
    facilitatorUrl: FACILITATOR_URL,
    network: NETWORK,
    scheme: 'exact',
    asset: NETWORK === 'stellar:mainnet' ? USDC_CONTRACT_MAINNET : USDC_CONTRACT_TESTNET,
  })

  res.json({
    status: currentValidation.valid ? 'ok' : 'degraded',
    network: NETWORK,
    pricePerQuery: '0.001 USDC',
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
    serperApiConfigured: !!SERPER_API_KEY,
    groqApiConfigured: !!GROQ_API_KEY,
    receivingAddressConfigured: !!RECEIVING_ADDRESS,
    timestamp: new Date().toISOString(),
  })
}