/**
 * Typed configuration boundary shared by browser and Node runtimes.
 * Secrets are deliberately absent from BrowserConfig.
 */
export type StellarNetwork = 'stellar:testnet' | 'stellar:mainnet'

type Environment = Record<string, string | undefined>

export class ConfigurationError extends Error {
  constructor(public readonly missing: string[], public readonly invalid: string[] = []) {
    super(`Invalid configuration: ${[...missing, ...invalid].join(', ')}`)
    this.name = 'ConfigurationError'
  }
}

export interface ServerConfig {
  receivingAddress: string
  serperApiKey: string
  groqApiKey?: string
  stellarNetwork: StellarNetwork
  facilitatorUrl: string
  port: number
  rateLimitPerMinute: number
  allowedOrigins?: string
  searchApiUrl: string
  amountStroops: string
  amountUsdc: string
}

export interface BrowserConfig {
  stellarNetwork: StellarNetwork
  apiBaseUrl: string
}

export interface McpConfig { searchApiUrl: string; groqApiKey?: string }

const networks = new Set<StellarNetwork>(['stellar:testnet', 'stellar:mainnet'])
const publicKey = /^G[A-Z2-7]{55}$/
const positiveInteger = /^[1-9]\d*$/
const decimal = /^\d+(?:\.\d+)?$/

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function url(value: string | undefined, name: string, invalid: string[], fallback: string): string {
  const candidate = optional(value) ?? fallback
  try {
    const parsed = new URL(candidate)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported protocol')
    return parsed.toString().replace(/\/$/, '')
  } catch {
    invalid.push(name)
    return fallback
  }
}

/** Parses and validates server-only values. It never includes values in errors. */
export function readServerConfig(env: Environment = process.env): ServerConfig {
  const missing: string[] = []
  const invalid: string[] = []
  const receivingAddress = optional(env.STELLAR_RECEIVING_ADDRESS)
  const serperApiKey = optional(env.SERPER_API_KEY)
  if (!receivingAddress) missing.push('STELLAR_RECEIVING_ADDRESS')
  else if (!publicKey.test(receivingAddress)) invalid.push('STELLAR_RECEIVING_ADDRESS')
  if (!serperApiKey) missing.push('SERPER_API_KEY')

  const stellarNetwork = optional(env.STELLAR_NETWORK) ?? 'stellar:testnet'
  if (!networks.has(stellarNetwork as StellarNetwork)) invalid.push('STELLAR_NETWORK')
  const portText = optional(env.PORT) ?? '3001'
  if (!positiveInteger.test(portText) || Number(portText) > 65535) invalid.push('PORT')
  const rateText = optional(env.RATE_LIMIT_PER_MINUTE) ?? '30'
  if (!positiveInteger.test(rateText)) invalid.push('RATE_LIMIT_PER_MINUTE')
  const amountStroops = optional(env.PAYMENT_AMOUNT_STROOPS) ?? '10000'
  const amountUsdc = optional(env.PAYMENT_AMOUNT_USDC) ?? '0.001'
  if (!positiveInteger.test(amountStroops)) invalid.push('PAYMENT_AMOUNT_STROOPS')
  if (!decimal.test(amountUsdc) || Number(amountUsdc) <= 0 || Number(amountUsdc) * 10_000_000 !== Number(amountStroops)) {
    invalid.push('PAYMENT_AMOUNT_USDC')
  }
  const facilitatorUrl = url(env.FACILITATOR_URL, 'FACILITATOR_URL', invalid, 'https://www.x402.org/facilitator')
  const searchApiUrl = url(env.SEARCH_API_URL, 'SEARCH_API_URL', invalid, 'http://localhost:3001')
  const allowedOrigins = optional(env.ALLOWED_ORIGINS)
  if (allowedOrigins) allowedOrigins.split(',').forEach(origin => url(origin, 'ALLOWED_ORIGINS', invalid, 'http://invalid.local'))

  if (missing.length || invalid.length) throw new ConfigurationError(missing, [...new Set(invalid)])
  return {
    receivingAddress: receivingAddress!, serperApiKey: serperApiKey!, groqApiKey: optional(env.GROQ_API_KEY),
    stellarNetwork: stellarNetwork as StellarNetwork, facilitatorUrl, port: Number(portText),
    rateLimitPerMinute: Number(rateText), allowedOrigins, searchApiUrl, amountStroops, amountUsdc,
  }
}

/** Parses browser-safe build-time values; it cannot expose server secrets. */
export function readBrowserConfig(env: Environment = (import.meta as unknown as { env: Environment }).env): BrowserConfig {
  const invalid: string[] = []
  const stellarNetwork = optional(env.VITE_STELLAR_NETWORK) ?? 'stellar:testnet'
  if (!networks.has(stellarNetwork as StellarNetwork)) invalid.push('VITE_STELLAR_NETWORK')
  const apiBaseUrl = optional(env.VITE_SERVER_URL) ?? '/api'
  if (!(apiBaseUrl.startsWith('/') || /^https?:\/\//.test(apiBaseUrl))) invalid.push('VITE_SERVER_URL')
  if (invalid.length) throw new ConfigurationError([], invalid)
  return { stellarNetwork: stellarNetwork as StellarNetwork, apiBaseUrl: apiBaseUrl.replace(/\/$/, '') }
}

/** MCP needs a reachable search service; Groq remains optional for ai_summarize. */
export function readMcpConfig(env: Environment = process.env): McpConfig {
  const invalid: string[] = []
  const searchApiUrl = url(env.SEARCH_API_URL, 'SEARCH_API_URL', invalid, 'http://localhost:3001')
  if (invalid.length) throw new ConfigurationError([], invalid)
  return { searchApiUrl, groqApiKey: optional(env.GROQ_API_KEY) }
}

/** Emits names only, so deployment logs never leak secret values. */
export function formatConfigurationError(error: unknown): string {
  if (!(error instanceof ConfigurationError)) return 'Configuration validation failed.'
  const parts = [
    error.missing.length && `missing required variables: ${error.missing.join(', ')}`,
    error.invalid.length && `invalid variables: ${error.invalid.join(', ')}`,
  ].filter(Boolean)
  return `Configuration validation failed — ${parts.join('; ')}.`
}
