import { describe, expect, it, vi } from 'vitest'
import {
  getX402DiscoveryMetadata,
  isX402DiscoveryMetadata,
  requestOrigin,
  X402_DISCOVERY_PATH,
} from './x402Discovery'

describe('x402 discovery metadata', () => {
  it('enumerates all paid resource templates and shared payment capabilities', () => {
    const metadata = getX402DiscoveryMetadata({
      origin: 'https://search.example.com',
      payTo: 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3',
    })

    expect(metadata.version).toBe(1)
    expect(metadata.protocol).toBe('x402')
    expect(metadata.resourceTemplates.map((template) => template.resource)).toEqual([
      '/search?q={q}',
      '/images?q={q}',
      '/news?q={q}',
    ])
    expect(metadata.networks).toEqual(['stellar:testnet'])
    expect(metadata.assets).toEqual(['CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA'])
    expect(metadata.schemes).toEqual(['exact'])
    expect(metadata.priceDiscoveryUrl).toBe(`https://search.example.com${X402_DISCOVERY_PATH}`)
    expect(metadata.resourceTemplates.every((template) => template.accepts[0].amount === '10000')).toBe(true)
    expect(metadata.resourceTemplates.every((template) => template.accepts[0].payTo !== null)).toBe(true)
    expect(isX402DiscoveryMetadata(metadata)).toBe(true)
  })

  it('takes the receiving address from runtime configuration when not supplied', () => {
    vi.stubEnv('STELLAR_RECEIVING_ADDRESS', 'G_RUNTIME_ADDRESS')
    const metadata = getX402DiscoveryMetadata({ origin: 'http://localhost:3001' })
    expect(metadata.resourceTemplates[0].accepts[0].payTo).toBe('G_RUNTIME_ADDRESS')
    vi.unstubAllEnvs()
  })

  it('derives origin from forwarded deployment headers and honors PUBLIC_BASE_URL', () => {
    expect(requestOrigin({ headers: { host: 'example.test', 'x-forwarded-proto': 'https' } })).toBe('https://example.test')
    vi.stubEnv('PUBLIC_BASE_URL', 'https://canonical.example')
    expect(requestOrigin({ headers: { host: 'internal:3000' } })).toBe('https://canonical.example')
    vi.unstubAllEnvs()
  })

  it('rejects malformed metadata', () => {
    expect(isX402DiscoveryMetadata(null)).toBe(false)
    expect(isX402DiscoveryMetadata({ protocol: 'x402' })).toBe(false)
  })
})
