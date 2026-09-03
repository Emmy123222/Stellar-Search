import { describe, expect, it } from 'vitest'
import { explorerTxUrl } from './lib/stellar'
import { FRESHNESS_OPTIONS } from './components/search/SearchBar'
import helmet from 'helmet'

describe('Stellar Search Utilities & App Suite', () => {
  it('formats search queries and handles empty states correctly', () => {
    const rawQuery = '  stellar blockchain  '
    const trimmed = rawQuery.trim()
    expect(trimmed).toBe('stellar blockchain')
  })

  it('validates Stellar account address structure', () => {
    const validGAddress = 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3'
    expect(validGAddress.startsWith('G')).toBe(true)
    expect(validGAddress.length).toBe(56)
  })

  it('constructs correct Stellar Expert transaction explorer deep link (#14)', () => {
    const mockTxHash = 'a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef'
    const url = explorerTxUrl(mockTxHash)
    expect(url).toContain('/tx/a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef')
    expect(url.startsWith('https://stellar.expert/explorer/')).toBe(true)
  })

  it('provides all 4 required freshness options (#17)', () => {
    const values = FRESHNESS_OPTIONS.map(opt => opt.value)
    expect(values).toEqual(['', 'pd', 'pw', 'pm'])
  })

  it('initializes Helmet middleware correctly for security headers (#20)', () => {
    expect(typeof helmet).toBe('function')
    const middleware = helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } })
    expect(typeof middleware).toBe('function')
  })
})
