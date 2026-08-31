import { describe, it, expect } from 'vitest'
import {
  parseVersion,
  compareVersions,
  coerceVersion,
  satisfiesRange,
  checkNodeVersion,
  SUPPORTED_RANGE,
} from './check-node-version'

describe('parseVersion', () => {
  it('parses a standard semver string', () => {
    expect(parseVersion('18.17.1')).toEqual([18, 17, 1])
  })

  it('parses a v-prefixed version', () => {
    expect(parseVersion('v20.19.0')).toEqual([20, 19, 0])
  })

  it('returns null for non-version string', () => {
    expect(parseVersion('not-a-version')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseVersion('')).toBeNull()
  })
})

describe('compareVersions', () => {
  it('returns 0 for equal versions', () => {
    expect(compareVersions([18, 0, 0], [18, 0, 0])).toBe(0)
  })

  it('returns -1 when a < b by major', () => {
    expect(compareVersions([17, 9, 0], [18, 0, 0])).toBe(-1)
  })

  it('returns 1 when a > b by major', () => {
    expect(compareVersions([22, 0, 0], [20, 19, 0])).toBe(1)
  })

  it('compares by minor when majors are equal', () => {
    expect(compareVersions([18, 16, 0], [18, 17, 0])).toBe(-1)
  })

  it('compares by patch when major and minor are equal', () => {
    expect(compareVersions([18, 17, 0], [18, 17, 1])).toBe(-1)
  })
})

describe('coerceVersion', () => {
  it('strips v prefix', () => {
    expect(coerceVersion('v18.17.1')).toBe('18.17.1')
  })

  it('returns clean version unchanged', () => {
    expect(coerceVersion('20.19.0')).toBe('20.19.0')
  })

  it('returns null for invalid input', () => {
    expect(coerceVersion('abc')).toBeNull()
  })

  it('handles version with extra metadata', () => {
    expect(coerceVersion('v18.17.1-beta.1')).toBe('18.17.1')
  })
})

describe('satisfiesRange', () => {
  it('>= range — version at boundary passes', () => {
    expect(satisfiesRange('18.0.0', '>=18.0.0')).toBe(true)
  })

  it('>= range — version above passes', () => {
    expect(satisfiesRange('20.19.0', '>=18.0.0')).toBe(true)
  })

  it('>= range — version below fails', () => {
    expect(satisfiesRange('17.9.0', '>=18.0.0')).toBe(false)
  })

  it('^ range — same major above minimum passes', () => {
    expect(satisfiesRange('20.19.0', '^20.19.0')).toBe(true)
  })

  it('^ range — next major fails', () => {
    expect(satisfiesRange('21.0.0', '^20.19.0')).toBe(false)
  })

  it('disjunction with || — first alternative passes', () => {
    expect(satisfiesRange('20.19.0', '^20.19.0 || >=22.12.0')).toBe(true)
  })

  it('disjunction with || — second alternative passes', () => {
    expect(satisfiesRange('22.12.0', '^20.19.0 || >=22.12.0')).toBe(true)
  })

  it('disjunction with || — neither passes', () => {
    expect(satisfiesRange('18.17.1', '^20.19.0 || >=22.12.0')).toBe(false)
  })

  it('space-separated range — both bounds must hold', () => {
    expect(satisfiesRange('19.0.0', '>=18.0.0 <21')).toBe(true)
    expect(satisfiesRange('17.0.0', '>=18.0.0 <21')).toBe(false)
    expect(satisfiesRange('21.0.0', '>=18.0.0 <21')).toBe(false)
  })

  it('x-range matches major only', () => {
    expect(satisfiesRange('18.17.1', '18.x')).toBe(true)
    expect(satisfiesRange('19.0.0', '18.x')).toBe(false)
  })

  it('bare number matches major', () => {
    expect(satisfiesRange('18.17.1', '18')).toBe(true)
    expect(satisfiesRange('20.0.0', '18')).toBe(false)
  })

  it('* matches everything', () => {
    expect(satisfiesRange('18.0.0', '*')).toBe(true)
    expect(satisfiesRange('14.0.0', '*')).toBe(true)
  })

  it('tilde range ~X.Y.Z allows patch updates', () => {
    expect(satisfiesRange('18.17.2', '~18.17.0')).toBe(true)
    expect(satisfiesRange('18.18.0', '~18.17.0')).toBe(false)
  })
})

describe('checkNodeVersion', () => {
  it('returns ok for a supported version', () => {
    const result = checkNodeVersion('v20.19.0', '>=18.0.0')
    expect(result.ok).toBe(true)
    expect(result.current).toBe('20.19.0')
    expect(result.required).toBe('>=18.0.0')
    expect(result.message).toBeUndefined()
  })

  it('returns ok for minimum version', () => {
    const result = checkNodeVersion('v18.0.0', '>=18.0.0')
    expect(result.ok).toBe(true)
  })

  it('returns ok for current LTS', () => {
    const result = checkNodeVersion('v22.12.0', '>=18.0.0')
    expect(result.ok).toBe(true)
  })

  it('fails for unsupported version below minimum', () => {
    const result = checkNodeVersion('v16.20.0', '>=18.0.0')
    expect(result.ok).toBe(false)
    expect(result.current).toBe('16.20.0')
    expect(result.message).toContain('Node 16.20.0 is not supported')
    expect(result.message).toContain('nvm, fnm, or volta')
  })

  it('fails for unparseable version string', () => {
    const result = checkNodeVersion('unknown', '>=18.0.0')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Unable to parse')
  })

  it('works with complex range like Vite 8 engines', () => {
    // Vite 8 requires: ^20.19.0 || >=22.12.0
    const range = '^20.19.0 || >=22.12.0'
    expect(checkNodeVersion('v20.19.0', range).ok).toBe(true)
    expect(checkNodeVersion('v22.12.0', range).ok).toBe(true)
    expect(checkNodeVersion('v22.14.0', range).ok).toBe(true)
    expect(checkNodeVersion('v18.17.1', range).ok).toBe(false)
    expect(checkNodeVersion('v21.0.0', range).ok).toBe(false)
  })

  it('SUPPORTED_RANGE default is >=18.0.0', () => {
    expect(SUPPORTED_RANGE).toBe('>=18.0.0')
  })
})
