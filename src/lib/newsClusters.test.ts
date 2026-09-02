import { describe, expect, it } from 'vitest'
import { clusterNewsResults } from './newsClusters'

describe('clusterNewsResults', () => {
  it('groups syndicated titles while retaining every source', () => {
    const result = clusterNewsResults([
      { id: '1', title: 'Stellar launches update', url: 'https://a.test', snippet: '', source: 'a' },
      { id: '2', title: 'Stellar launches update - breaking', url: 'https://b.test', snippet: '', source: 'b' },
    ])
    expect(result).toHaveLength(1)
    expect(result[0]).toHaveLength(2)
  })
})
