import {
  AMOUNT_STROOPS,
  AMOUNT_USDC,
  STELLAR_NETWORK,
  USDC_CONTRACT,
} from './constants'

export const X402_DISCOVERY_PATH = '/.well-known/x402'

export interface X402ResourceTemplate {
  id: string
  resource: string
  method: 'GET'
  description: string
  accepts: X402PaymentOption[]
}

export interface X402PaymentOption {
  scheme: 'exact'
  network: string
  asset: string
  amount: string
  price: string
  currency: 'USDC'
  payTo: string | null
}

export interface X402DiscoveryMetadata {
  version: 1
  protocol: 'x402'
  resourceTemplates: X402ResourceTemplate[]
  networks: string[]
  assets: string[]
  schemes: string[]
  priceDiscoveryUrl: string
}

function paymentOption(payTo: string | null): X402PaymentOption {
  return {
    scheme: 'exact',
    network: STELLAR_NETWORK,
    asset: USDC_CONTRACT,
    amount: AMOUNT_STROOPS,
    price: AMOUNT_USDC,
    currency: 'USDC',
    payTo,
  }
}

export function getX402DiscoveryMetadata({
  origin,
  payTo = process.env.STELLAR_RECEIVING_ADDRESS || null,
}: {
  origin: string
  payTo?: string | null
}): X402DiscoveryMetadata {
  const accepts = paymentOption(payTo)
  const resourceTemplates = [
    ['search', '/search?q={q}', 'Pay-per-query web search'],
    ['images', '/images?q={q}', 'Pay-per-query image search'],
    ['news', '/news?q={q}', 'Pay-per-query news search'],
  ].map(([id, resource, description]) => ({
    id,
    resource,
    method: 'GET' as const,
    description,
    accepts: [accepts],
  }))

  return {
    version: 1,
    protocol: 'x402',
    resourceTemplates,
    networks: [STELLAR_NETWORK],
    assets: [USDC_CONTRACT],
    schemes: ['exact'],
    priceDiscoveryUrl: new URL(X402_DISCOVERY_PATH, origin).toString(),
  }
}

export function requestOrigin(req: { headers?: Record<string, string | string[] | undefined> }): string {
  const headers = req.headers || {}
  const forwardedProto = headers['x-forwarded-proto']
  const forwardedHost = headers['x-forwarded-host'] || headers.host
  const protocol = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto
  const host = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost
  return process.env.PUBLIC_BASE_URL || `${protocol || 'http'}://${host || 'localhost:3001'}`
}

export function isX402DiscoveryMetadata(value: unknown): value is X402DiscoveryMetadata {
  if (!value || typeof value !== 'object') return false
  const metadata = value as Partial<X402DiscoveryMetadata>
  return metadata.version === 1
    && metadata.protocol === 'x402'
    && Array.isArray(metadata.resourceTemplates)
    && metadata.resourceTemplates.length > 0
    && Array.isArray(metadata.networks)
    && Array.isArray(metadata.assets)
    && Array.isArray(metadata.schemes)
    && typeof metadata.priceDiscoveryUrl === 'string'
}
