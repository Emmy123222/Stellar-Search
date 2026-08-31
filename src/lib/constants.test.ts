import { describe, it, expect } from 'vitest'
import {
  STELLAR_NETWORK,
  IS_MAINNET,
  EXPECTED_WALLET_NETWORK,
  HORIZON_URL,
  HORIZON_TESTNET,
  HORIZON_MAINNET,
  STELLAR_EXPERT_URL,
  STELLAR_EXPERT_TESTNET,
  STELLAR_EXPERT_MAINNET,
  USDC_ISSUER,
  USDC_ISSUER_TESTNET,
  USDC_ISSUER_MAINNET,
  USDC_CONTRACT,
  USDC_CONTRACT_TESTNET,
  USDC_CONTRACT_MAINNET,
  AMOUNT_STROOPS,
  AMOUNT_USDC,
  assertValidStellarConfig,
  isValidStellarNetwork,
  isValidStellarReceivingAddress,
  VALID_STELLAR_NETWORKS,
} from './constants'

describe('constants — Express, Vercel, browser, MCP alignment', () => {
  it('defaults to stellar:testnet when env not set', () => {
    // In test env without STELLAR_NETWORK, should be testnet
    expect(STELLAR_NETWORK).toBe('stellar:testnet')
  })

  it('IS_MAINNET is false for testnet', () => {
    expect(IS_MAINNET).toBe(false)
  })

  it('EXPECTED_WALLET_NETWORK aligns with network', () => {
    expect(EXPECTED_WALLET_NETWORK).toBe('TESTNET')
    if (IS_MAINNET) {
      expect(EXPECTED_WALLET_NETWORK).toBe('PUBLIC')
    }
  })

  it('HORIZON_URL aligns with network', () => {
    expect(HORIZON_URL).toBe(HORIZON_TESTNET)
    expect(HORIZON_MAINNET).toBe('https://horizon.stellar.org')
    expect(HORIZON_TESTNET).toBe('https://horizon-testnet.stellar.org')
  })

  it('STELLAR_EXPERT_URL aligns with network', () => {
    expect(STELLAR_EXPERT_URL).toBe(STELLAR_EXPERT_TESTNET)
    expect(STELLAR_EXPERT_MAINNET).toBe('https://stellar.expert/explorer/public')
    expect(STELLAR_EXPERT_TESTNET).toBe('https://stellar.expert/explorer/testnet')
  })

  it('USDC_ISSUER aligns with network', () => {
    expect(USDC_ISSUER).toBe(USDC_ISSUER_TESTNET)
    expect(USDC_ISSUER_MAINNET).toBe('GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN')
    expect(USDC_ISSUER_TESTNET).toBe('GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5')
  })

  it('USDC_CONTRACT aligns with network', () => {
    expect(USDC_CONTRACT).toBe(USDC_CONTRACT_TESTNET)
    expect(USDC_CONTRACT_MAINNET).toBe('CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7EJJUST')
    expect(USDC_CONTRACT_TESTNET).toBe('CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA')
  })

  it('payment amounts are 0.001 USDC and 10000 stroops (x402 settlement semantics)', () => {
    expect(AMOUNT_USDC).toBe('0.001')
    expect(AMOUNT_STROOPS).toBe('10000')
    // Verify stroops = USDC * 10^7 (Stellar 7 decimals)
    expect(parseFloat(AMOUNT_USDC) * 10_000_000).toBe(parseInt(AMOUNT_STROOPS))
  })

  it('HORIZON_URLs are https and contain horizon', () => {
    expect(HORIZON_URL.startsWith('https://')).toBe(true)
    expect(HORIZON_TESTNET.startsWith('https://')).toBe(true)
    expect(HORIZON_MAINNET.startsWith('https://')).toBe(true)
  })

  it('USDC amounts are parseable numbers', () => {
    expect(isNaN(parseFloat(AMOUNT_USDC))).toBe(false)
    expect(isNaN(parseInt(AMOUNT_STROOPS))).toBe(false)
    expect(parseFloat(AMOUNT_USDC)).toBeGreaterThan(0)
  })

  it('accepts only the supported Stellar network identifiers', () => {
    expect(VALID_STELLAR_NETWORKS).toContain('stellar:testnet')
    expect(VALID_STELLAR_NETWORKS).toContain('stellar:mainnet')
    expect(isValidStellarNetwork('stellar:testnet')).toBe(true)
    expect(isValidStellarNetwork('stellar:mainnet')).toBe(true)
    expect(isValidStellarNetwork('stellar:regtest')).toBe(false)
  })

  it('accepts valid public keys and rejects malformed Stellar receiving addresses', () => {
    const validAddress = 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3'
    expect(isValidStellarReceivingAddress(validAddress)).toBe(true)
    expect(isValidStellarReceivingAddress('not-a-public-key')).toBe(false)
    expect(isValidStellarReceivingAddress('')).toBe(false)
  })

  it('throws a clear startup error when the Stellar runtime config is invalid', () => {
    expect(() => assertValidStellarConfig({
      STELLAR_NETWORK: 'stellar:regtest',
      STELLAR_RECEIVING_ADDRESS: 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3',
    })).toThrow(/STELLAR_NETWORK/)

    expect(() => assertValidStellarConfig({
      STELLAR_NETWORK: 'stellar:testnet',
      STELLAR_RECEIVING_ADDRESS: 'not-a-public-key',
    })).toThrow(/STELLAR_RECEIVING_ADDRESS/)
  })
})
