import { describe, expect, it } from 'vitest'
import { ConfigurationError, formatConfigurationError, readBrowserConfig, readServerConfig } from './config'

const core = {
  STELLAR_RECEIVING_ADDRESS: 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3',
  SERPER_API_KEY: 'secret-serper-key',
}

describe('typed configuration schema', () => {
  it('keeps core requirements separate from optional AI configuration', () => {
    const config = readServerConfig(core)
    expect(config.groqApiKey).toBeUndefined()
    expect(config.amountStroops).toBe('10000')
    expect(config.amountUsdc).toBe('0.001')
  })

  it('reports missing names without including their values', () => {
    try {
      readServerConfig({ ...core, SERPER_API_KEY: undefined })
      throw new Error('expected validation to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError)
      expect(formatConfigurationError(error)).toContain('SERPER_API_KEY')
      expect(formatConfigurationError(error)).not.toContain('secret-serper-key')
    }
  })

  it('validates URLs, enum values, limits, and payment amounts', () => {
    expect(() => readServerConfig({ ...core, FACILITATOR_URL: 'not-a-url' })).toThrow('FACILITATOR_URL')
    expect(() => readServerConfig({ ...core, STELLAR_NETWORK: 'public' })).toThrow('STELLAR_NETWORK')
    expect(() => readServerConfig({ ...core, RATE_LIMIT_PER_MINUTE: '0' })).toThrow('RATE_LIMIT_PER_MINUTE')
    expect(() => readServerConfig({ ...core, PAYMENT_AMOUNT_STROOPS: '10001' })).toThrow('PAYMENT_AMOUNT_USDC')
  })

  it('uses same-origin /api by default and preserves explicit subpaths', () => {
    expect(readBrowserConfig({}).apiBaseUrl).toBe('/api')
    expect(readBrowserConfig({ VITE_SERVER_URL: '/stellar/api/' }).apiBaseUrl).toBe('/stellar/api')
  })
})
