/**
 * facilitatorValidation.ts
 * Discovers and validates facilitator compatibility with the selected Stellar network,
 * scheme, and asset.
 */

import {
  USDC_CONTRACT_TESTNET,
  USDC_CONTRACT_MAINNET,
} from './constants'

export const SUPPORTED_NETWORKS = ['stellar:testnet', 'stellar:mainnet'] as const
export type SupportedNetwork = typeof SUPPORTED_NETWORKS[number]

export const SUPPORTED_SCHEMES = ['exact'] as const
export type SupportedScheme = typeof SUPPORTED_SCHEMES[number]

export interface FacilitatorConfigInput {
  facilitatorUrl?: string
  network?: string
  scheme?: string
  asset?: string
}

export interface FacilitatorValidationResult {
  valid: boolean
  network: string
  scheme: string
  asset: string
  facilitatorUrl: string
  errors: string[]
  warnings: string[]
  details?: {
    expectedAsset?: string
    inferredNetwork?: string
  }
}

/**
 * Validates the static configuration of a facilitator URL against the target network,
 * payment scheme, and token contract asset.
 */
export function validateFacilitatorConfig(
  config: FacilitatorConfigInput = {}
): FacilitatorValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  const network = config.network || 'stellar:testnet'
  const scheme = config.scheme || 'exact'
  const facilitatorUrl = config.facilitatorUrl || 'https://www.x402.org/facilitator'
  const isMainnet = network === 'stellar:mainnet'
  const expectedAsset = isMainnet ? USDC_CONTRACT_MAINNET : USDC_CONTRACT_TESTNET
  const asset = config.asset || expectedAsset

  // 1. Network Validation
  if (!SUPPORTED_NETWORKS.includes(network as SupportedNetwork)) {
    errors.push(
      `Unsupported network '${network}'. Supported networks are: ${SUPPORTED_NETWORKS.join(', ')}.`
    )
  }

  // 2. Scheme Validation
  if (!SUPPORTED_SCHEMES.includes(scheme as SupportedScheme)) {
    errors.push(
      `Unsupported payment scheme '${scheme}'. Supported schemes are: ${SUPPORTED_SCHEMES.join(', ')}.`
    )
  }

  // 3. Asset Validation
  if (asset !== expectedAsset) {
    errors.push(
      `Mismatched asset contract for ${network}. Expected '${expectedAsset}' but received '${asset}'.`
    )
  }

  // 4. Facilitator URL Validation
  let parsedUrl: URL | null = null
  try {
    parsedUrl = new URL(facilitatorUrl)
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      errors.push(`Facilitator URL must use HTTP or HTTPS protocol: '${facilitatorUrl}'.`)
    }
  } catch {
    errors.push(`Invalid facilitator URL: '${facilitatorUrl}'.`)
  }

  // 5. Network vs URL Heuristic Compatibility
  if (parsedUrl) {
    const urlLower = facilitatorUrl.toLowerCase()
    if (urlLower.includes('testnet') && network === 'stellar:mainnet') {
      errors.push(
        `Facilitator URL indicates a testnet endpoint ('${facilitatorUrl}') but STELLAR_NETWORK is set to 'stellar:mainnet'.`
      )
    } else if ((urlLower.includes('mainnet') || urlLower.includes('/public')) && network === 'stellar:testnet') {
      errors.push(
        `Facilitator URL indicates a mainnet endpoint ('${facilitatorUrl}') but STELLAR_NETWORK is set to 'stellar:testnet'.`
      )
    }
  }

  return {
    valid: errors.length === 0,
    network,
    scheme,
    asset,
    facilitatorUrl,
    errors,
    warnings,
    details: {
      expectedAsset,
    },
  }
}

export interface FacilitatorCapabilities {
  networks?: string[]
  schemes?: string[]
  assets?: string[]
  version?: string
}

/**
 * Discovers capability metadata from an x402 facilitator endpoint if available.
 */
export async function discoverFacilitatorCapabilities(
  facilitatorUrl: string,
  timeoutMs: number = 3000
): Promise<{ ok: boolean; capabilities?: FacilitatorCapabilities; error?: string }> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    // Try discovery paths
    const res = await fetch(facilitatorUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout))

    if (!res.ok) {
      return { ok: false, error: `Facilitator probe returned HTTP ${res.status}` }
    }

    const contentType = res.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) {
      return { ok: true }
    }

    const data = (await res.json()) as any
    const capabilities: FacilitatorCapabilities = {
      networks: Array.isArray(data.networks) ? data.networks : Array.isArray(data.supportedNetworks) ? data.supportedNetworks : undefined,
      schemes: Array.isArray(data.schemes) ? data.schemes : Array.isArray(data.supportedSchemes) ? data.supportedSchemes : undefined,
      assets: Array.isArray(data.assets) ? data.assets : Array.isArray(data.supportedAssets) ? data.supportedAssets : undefined,
      version: typeof data.version === 'string' ? data.version : undefined,
    }

    return { ok: true, capabilities }
  } catch (err: any) {
    return { ok: false, error: err.message || 'Discovery probe failed' }
  }
}

/**
 * Full compatibility check combining static configuration validation and remote capability checks.
 */
export async function validateFacilitatorCompatibility(
  config: FacilitatorConfigInput = {},
  options: { discoverRemote?: boolean; timeoutMs?: number } = {}
): Promise<FacilitatorValidationResult> {
  const staticResult = validateFacilitatorConfig(config)
  if (!staticResult.valid || !options.discoverRemote) {
    return staticResult
  }

  const discovery = await discoverFacilitatorCapabilities(
    staticResult.facilitatorUrl,
    options.timeoutMs || 3000
  )

  if (discovery.ok && discovery.capabilities) {
    const caps = discovery.capabilities
    if (caps.networks && caps.networks.length > 0 && !caps.networks.includes(staticResult.network)) {
      staticResult.valid = false
      staticResult.errors.push(
        `Facilitator at '${staticResult.facilitatorUrl}' does not support network '${staticResult.network}'. Supported: ${caps.networks.join(', ')}.`
      )
    }
    if (caps.schemes && caps.schemes.length > 0 && !caps.schemes.includes(staticResult.scheme)) {
      staticResult.valid = false
      staticResult.errors.push(
        `Facilitator at '${staticResult.facilitatorUrl}' does not support scheme '${staticResult.scheme}'. Supported: ${caps.schemes.join(', ')}.`
      )
    }
  }

  return staticResult
}
