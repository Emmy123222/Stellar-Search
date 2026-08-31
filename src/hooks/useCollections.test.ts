/**
 * useCollections.test.ts
 *
 * Unit tests for the useCollections hook.
 * Covers:
 *  - createCollection / renameCollection / deleteCollection
 *  - saveResult / removeResult / moveResult / isSaved
 *  - quota enforcement (COLLECTIONS_QUOTA_MAX / COLLECTIONS_MAX_COUNT)
 *  - deduplication (same result id cannot be saved twice in the same collection)
 *  - versioned schema: unknown version resets the store
 *  - corruption recovery: malformed JSON resets the store
 *  - quota error surface and clearQuotaError
 *  - localStorage write failure triggers quotaError
 *  - cross-tab sync via StorageEvent
 *  - derived values: totalSaved, remaining, sorted collections
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCollections } from './useCollections'
import {
  COLLECTIONS_STORAGE_KEY,
  COLLECTIONS_SCHEMA_VERSION,
  COLLECTIONS_QUOTA_MAX,
  COLLECTIONS_MAX_COUNT,
  type CollectionsStore,
  type SearchResult,
} from '../types'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const MOCK_RESULT: SearchResult = {
  id: 'r1',
  title: 'Stellar Docs',
  url: 'https://developers.stellar.org',
  description: 'Official Stellar developer documentation.',
  source: 'developers.stellar.org',
  relevanceScore: 0.95,
}

const MOCK_RESULT_2: SearchResult = {
  id: 'r2',
  title: 'Horizon API',
  url: 'https://horizon.stellar.org',
  description: 'The Horizon API for Stellar.',
  source: 'horizon.stellar.org',
  relevanceScore: 0.88,
}

// ─── localStorage mock ────────────────────────────────────────────────────────

let store: Record<string, string> = {}

beforeEach(() => {
  store = {}
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => store[key] ?? null)
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => { store[key] = String(value) })
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation((key) => { delete store[key] })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function seedStore(partial: Partial<CollectionsStore>) {
  const base: CollectionsStore = {
    version: COLLECTIONS_SCHEMA_VERSION,
    collections: {},
    results: {},
    ...partial,
  }
  store[COLLECTIONS_STORAGE_KEY] = JSON.stringify(base)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useCollections — initialization', () => {
  it('starts with an empty store when localStorage is empty', () => {
    const { result } = renderHook(() => useCollections())
    expect(result.current.collections).toHaveLength(0)
    expect(result.current.totalSaved).toBe(0)
    expect(result.current.remaining).toBe(COLLECTIONS_QUOTA_MAX)
  })

  it('loads a valid persisted store on mount', () => {
    seedStore({
      collections: {
        col1: { id: 'col1', name: 'Research', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', resultIds: [] },
      },
    })
    const { result } = renderHook(() => useCollections())
    expect(result.current.collections).toHaveLength(1)
    expect(result.current.collections[0].name).toBe('Research')
  })
})

describe('useCollections — schema migration / corruption recovery', () => {
  it('resets to empty store when schema version is unknown', () => {
    store[COLLECTIONS_STORAGE_KEY] = JSON.stringify({
      version: 999,
      collections: { old: { id: 'old', name: 'Old', createdAt: '', updatedAt: '', resultIds: [] } },
      results: {},
    })
    const { result } = renderHook(() => useCollections())
    expect(result.current.collections).toHaveLength(0)
  })

  it('resets to empty store on corrupt JSON', () => {
    store[COLLECTIONS_STORAGE_KEY] = '{not valid json'
    const { result } = renderHook(() => useCollections())
    expect(result.current.collections).toHaveLength(0)
    expect(result.current.totalSaved).toBe(0)
  })

  it('resets to empty store when collections field is missing', () => {
    store[COLLECTIONS_STORAGE_KEY] = JSON.stringify({
      version: COLLECTIONS_SCHEMA_VERSION,
      results: {},
    })
    const { result } = renderHook(() => useCollections())
    expect(result.current.collections).toHaveLength(0)
  })

  it('resets to empty store when results field is null', () => {
    store[COLLECTIONS_STORAGE_KEY] = JSON.stringify({
      version: COLLECTIONS_SCHEMA_VERSION,
      collections: {},
      results: null,
    })
    const { result } = renderHook(() => useCollections())
    expect(result.current.collections).toHaveLength(0)
  })
})

describe('useCollections — createCollection', () => {
  it('creates a collection and persists it', () => {
    const { result } = renderHook(() => useCollections())
    act(() => { result.current.createCollection('My Research') })
    expect(result.current.collections).toHaveLength(1)
    expect(result.current.collections[0].name).toBe('My Research')

    const persisted = JSON.parse(store[COLLECTIONS_STORAGE_KEY]) as CollectionsStore
    expect(Object.values(persisted.collections)).toHaveLength(1)
  })

  it('trims and truncates names to 100 chars', () => {
    const { result } = renderHook(() => useCollections())
    const longName = 'A'.repeat(150)
    act(() => { result.current.createCollection(`  ${longName}  `) })
    expect(result.current.collections[0].name).toHaveLength(100)
  })

  it('returns null and does not create when name is empty', () => {
    const { result } = renderHook(() => useCollections())
    let returned: ReturnType<typeof result.current.createCollection>
    act(() => { returned = result.current.createCollection('   ') })
    expect(returned!).toBeNull()
    expect(result.current.collections).toHaveLength(0)
  })

  it(`returns null when ${COLLECTIONS_MAX_COUNT} collections already exist`, () => {
    const collections: CollectionsStore['collections'] = {}
    for (let i = 0; i < COLLECTIONS_MAX_COUNT; i++) {
      collections[`c${i}`] = { id: `c${i}`, name: `C${i}`, createdAt: '', updatedAt: '', resultIds: [] }
    }
    seedStore({ collections })
    const { result } = renderHook(() => useCollections())
    let returned: ReturnType<typeof result.current.createCollection>
    act(() => { returned = result.current.createCollection('One More') })
    expect(returned!).toBeNull()
  })
})

describe('useCollections — renameCollection', () => {
  it('renames a collection', () => {
    const { result } = renderHook(() => useCollections())
    act(() => { result.current.createCollection('Old Name') })
    const id = result.current.collections[0].id
    act(() => { result.current.renameCollection(id, 'New Name') })
    expect(result.current.collections[0].name).toBe('New Name')
  })

  it('returns false for unknown id', () => {
    const { result } = renderHook(() => useCollections())
    let ok: boolean
    act(() => { ok = result.current.renameCollection('ghost', 'X') })
    expect(ok!).toBe(false)
  })

  it('returns false for empty new name', () => {
    const { result } = renderHook(() => useCollections())
    act(() => { result.current.createCollection('Alpha') })
    const id = result.current.collections[0].id
    let ok: boolean
    act(() => { ok = result.current.renameCollection(id, '  ') })
    expect(ok!).toBe(false)
    expect(result.current.collections[0].name).toBe('Alpha')
  })
})

describe('useCollections — deleteCollection', () => {
  it('deletes a collection and its saved results', () => {
    const { result } = renderHook(() => useCollections())

    act(() => { result.current.createCollection('To Delete') })
    const colId = result.current.collections[0].id
    act(() => { result.current.saveResult(colId, MOCK_RESULT, 'stellar', 'tx1', 'stellar:testnet') })
    expect(result.current.totalSaved).toBe(1)

    act(() => { result.current.deleteCollection(colId) })
    expect(result.current.collections).toHaveLength(0)
    expect(result.current.totalSaved).toBe(0)
  })

  it('returns false for unknown collection id', () => {
    const { result } = renderHook(() => useCollections())
    let ok: boolean
    act(() => { ok = result.current.deleteCollection('not-exist') })
    expect(ok!).toBe(false)
  })
})

describe('useCollections — saveResult', () => {
  it('saves a result and updates totalSaved', () => {
    const { result } = renderHook(() => useCollections())
    act(() => { result.current.createCollection('Saved') })
    const colId = result.current.collections[0].id
    let saved: ReturnType<typeof result.current.saveResult>
    act(() => { saved = result.current.saveResult(colId, MOCK_RESULT, 'stellar x402', 'txABC', 'stellar:testnet') })

    expect(saved!).not.toBeNull()
    expect(saved!.result.id).toBe('r1')
    expect(saved!.query).toBe('stellar x402')
    expect(saved!.txHash).toBe('txABC')
    expect(saved!.network).toBe('stellar:testnet')
    expect(result.current.totalSaved).toBe(1)
    expect(result.current.remaining).toBe(COLLECTIONS_QUOTA_MAX - 1)
  })

  it('returns null for unknown collection id', () => {
    const { result } = renderHook(() => useCollections())
    let saved: ReturnType<typeof result.current.saveResult>
    act(() => { saved = result.current.saveResult('ghost', MOCK_RESULT, 'q', null, 'stellar:testnet') })
    expect(saved!).toBeNull()
  })

  it('deduplicates: returns existing SavedResult when same result.id is saved twice', () => {
    const { result } = renderHook(() => useCollections())
    act(() => { result.current.createCollection('Dupes') })
    const colId = result.current.collections[0].id
    let first: ReturnType<typeof result.current.saveResult>
    let second: ReturnType<typeof result.current.saveResult>
    act(() => { first = result.current.saveResult(colId, MOCK_RESULT, 'q', null, 'stellar:testnet') })
    act(() => { second = result.current.saveResult(colId, MOCK_RESULT, 'q2', 'txZ', 'stellar:testnet') })

    // Both calls succeed, but only 1 result stored
    expect(first!).not.toBeNull()
    expect(second!).not.toBeNull()
    expect(result.current.totalSaved).toBe(1)
    // Second returns the original saved entry
    expect(second!.id).toBe(first!.id)
  })

  it('enforces COLLECTIONS_QUOTA_MAX and surfaces quotaError', () => {
    // Pre-fill store with quota-max results
    const results: CollectionsStore['results'] = {}
    for (let i = 0; i < COLLECTIONS_QUOTA_MAX; i++) {
      results[`sr${i}`] = {
        id: `sr${i}`,
        collectionId: 'col1',
        savedAt: '',
        query: 'q',
        txHash: null,
        network: 'stellar:testnet',
        result: { ...MOCK_RESULT, id: `orig${i}` },
      }
    }
    seedStore({
      collections: {
        col1: {
          id: 'col1',
          name: 'Full',
          createdAt: '',
          updatedAt: '',
          resultIds: Object.keys(results),
        },
      },
      results,
    })

    const { result } = renderHook(() => useCollections())
    let saved: ReturnType<typeof result.current.saveResult>
    act(() => {
      saved = result.current.saveResult('col1', { ...MOCK_RESULT, id: 'new-one' }, 'q', null, 'stellar:testnet')
    })
    expect(saved!).toBeNull()
    expect(result.current.quotaError).toContain('quota')
  })
})

describe('useCollections — removeResult', () => {
  it('removes a saved result from its collection', () => {
    const { result } = renderHook(() => useCollections())
    act(() => { result.current.createCollection('R') })
    const colId = result.current.collections[0].id
    let saved: ReturnType<typeof result.current.saveResult>
    act(() => { saved = result.current.saveResult(colId, MOCK_RESULT, 'q', null, 'stellar:testnet') })

    act(() => { result.current.removeResult(saved!.id) })
    expect(result.current.totalSaved).toBe(0)
    expect(result.current.collections[0].resultIds).toHaveLength(0)
  })

  it('returns false for unknown saved result id', () => {
    const { result } = renderHook(() => useCollections())
    let ok: boolean
    act(() => { ok = result.current.removeResult('ghost') })
    expect(ok!).toBe(false)
  })
})

describe('useCollections — moveResult', () => {
  it('moves a result to another collection', () => {
    const { result } = renderHook(() => useCollections())
    act(() => { result.current.createCollection('A') })
    act(() => { result.current.createCollection('B') })
    const [colB, colA] = result.current.collections // sorted newest-first
    let saved: ReturnType<typeof result.current.saveResult>
    act(() => { saved = result.current.saveResult(colA.id, MOCK_RESULT, 'q', null, 'stellar:testnet') })

    act(() => { result.current.moveResult(saved!.id, colB.id) })

    const updatedA = result.current.collections.find(c => c.id === colA.id)!
    const updatedB = result.current.collections.find(c => c.id === colB.id)!
    expect(updatedA.resultIds).not.toContain(saved!.id)
    expect(updatedB.resultIds).toContain(saved!.id)
    // savedResult.collectionId updated
    expect(result.current.results[saved!.id].collectionId).toBe(colB.id)
  })

  it('returns true (no-op) when moving to the same collection', () => {
    const { result } = renderHook(() => useCollections())
    act(() => { result.current.createCollection('Same') })
    const colId = result.current.collections[0].id
    let saved: ReturnType<typeof result.current.saveResult>
    act(() => { saved = result.current.saveResult(colId, MOCK_RESULT, 'q', null, 'stellar:testnet') })
    let ok: boolean
    act(() => { ok = result.current.moveResult(saved!.id, colId) })
    expect(ok!).toBe(true)
  })

  it('returns false when target collection does not exist', () => {
    const { result } = renderHook(() => useCollections())
    act(() => { result.current.createCollection('Src') })
    const colId = result.current.collections[0].id
    let saved: ReturnType<typeof result.current.saveResult>
    act(() => { saved = result.current.saveResult(colId, MOCK_RESULT, 'q', null, 'stellar:testnet') })
    let ok: boolean
    act(() => { ok = result.current.moveResult(saved!.id, 'ghost') })
    expect(ok!).toBe(false)
  })

  it('returns false when result already exists in target collection (dedup on move)', () => {
    const { result } = renderHook(() => useCollections())
    act(() => { result.current.createCollection('C1') })
    act(() => { result.current.createCollection('C2') })
    const [c2, c1] = result.current.collections
    let s1: ReturnType<typeof result.current.saveResult>
    act(() => { s1 = result.current.saveResult(c1.id, MOCK_RESULT, 'q', null, 'stellar:testnet') })
    act(() => { result.current.saveResult(c2.id, MOCK_RESULT, 'q', null, 'stellar:testnet') })

    // Try to move s1 from c1 into c2 where same result already exists
    let ok: boolean
    act(() => { ok = result.current.moveResult(s1!.id, c2.id) })
    expect(ok!).toBe(false)
    expect(result.current.totalSaved).toBe(2)
  })
})

describe('useCollections — isSaved', () => {
  it('returns true if the result is saved in the collection', () => {
    const { result } = renderHook(() => useCollections())
    act(() => { result.current.createCollection('Col') })
    const colId = result.current.collections[0].id
    act(() => { result.current.saveResult(colId, MOCK_RESULT, 'q', null, 'stellar:testnet') })
    expect(result.current.isSaved(colId, MOCK_RESULT.id)).toBe(true)
  })

  it('returns false if the result is not saved', () => {
    const { result } = renderHook(() => useCollections())
    act(() => { result.current.createCollection('Col') })
    const colId = result.current.collections[0].id
    expect(result.current.isSaved(colId, 'not-saved')).toBe(false)
  })

  it('returns false for unknown collection', () => {
    const { result } = renderHook(() => useCollections())
    expect(result.current.isSaved('ghost', 'r1')).toBe(false)
  })
})

describe('useCollections — quotaError and clearQuotaError', () => {
  it('clears quotaError when clearQuotaError is called', () => {
    // Fill to quota
    const results: CollectionsStore['results'] = {}
    for (let i = 0; i < COLLECTIONS_QUOTA_MAX; i++) {
      results[`sr${i}`] = {
        id: `sr${i}`,
        collectionId: 'col1',
        savedAt: '',
        query: 'q',
        txHash: null,
        network: 'stellar:testnet',
        result: { ...MOCK_RESULT, id: `orig${i}` },
      }
    }
    seedStore({
      collections: {
        col1: {
          id: 'col1',
          name: 'Full',
          createdAt: '',
          updatedAt: '',
          resultIds: Object.keys(results),
        },
      },
      results,
    })

    const { result } = renderHook(() => useCollections())
    act(() => {
      result.current.saveResult('col1', { ...MOCK_RESULT, id: 'overflow' }, 'q', null, 'stellar:testnet')
    })
    expect(result.current.quotaError).not.toBeNull()
    act(() => { result.current.clearQuotaError() })
    expect(result.current.quotaError).toBeNull()
  })

  it('surfaces quotaError when localStorage.setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError')
    })

    const { result } = renderHook(() => useCollections())
    act(() => { result.current.createCollection('WillFail') })
    expect(result.current.quotaError).not.toBeNull()
  })
})

describe('useCollections — cross-tab sync', () => {
  it('reloads from localStorage when a StorageEvent fires for the key', () => {
    const { result } = renderHook(() => useCollections())
    expect(result.current.collections).toHaveLength(0)

    // Simulate another tab writing a collection
    const externalStore: CollectionsStore = {
      version: COLLECTIONS_SCHEMA_VERSION,
      collections: {
        ext1: { id: 'ext1', name: 'From Other Tab', createdAt: '', updatedAt: '', resultIds: [] },
      },
      results: {},
    }
    store[COLLECTIONS_STORAGE_KEY] = JSON.stringify(externalStore)

    // Fire a storage event
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: COLLECTIONS_STORAGE_KEY,
          newValue: JSON.stringify(externalStore),
        })
      )
    })

    expect(result.current.collections).toHaveLength(1)
    expect(result.current.collections[0].name).toBe('From Other Tab')
  })

  it('does not reload when StorageEvent fires for a different key', () => {
    const { result } = renderHook(() => useCollections())
    act(() => { result.current.createCollection('Mine') })
    const count = result.current.collections.length

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'some_other_key' }))
    })

    expect(result.current.collections).toHaveLength(count)
  })
})

describe('useCollections — derived values', () => {
  it('sorts collections by updatedAt descending', () => {
    // Seed two collections with explicit timestamps so order is deterministic
    seedStore({
      collections: {
        colA: { id: 'colA', name: 'First', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', resultIds: [] },
        colB: { id: 'colB', name: 'Second', createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z', resultIds: [] },
      },
    })
    const { result } = renderHook(() => useCollections())
    // colB has later updatedAt — should be index 0
    expect(result.current.collections[0].name).toBe('Second')
    expect(result.current.collections[1].name).toBe('First')
  })

  it('totalSaved tracks across multiple collections', () => {
    const { result } = renderHook(() => useCollections())
    act(() => { result.current.createCollection('A') })
    act(() => { result.current.createCollection('B') })
    const [colB, colA] = result.current.collections
    act(() => { result.current.saveResult(colA.id, MOCK_RESULT, 'q', null, 'stellar:testnet') })
    act(() => { result.current.saveResult(colB.id, MOCK_RESULT_2, 'q2', null, 'stellar:testnet') })
    expect(result.current.totalSaved).toBe(2)
    expect(result.current.remaining).toBe(COLLECTIONS_QUOTA_MAX - 2)
  })
})

describe('useCollections — persistence format', () => {
  it('persists the correct schema version', () => {
    const { result } = renderHook(() => useCollections())
    act(() => { result.current.createCollection('Versioned') })
    const persisted = JSON.parse(store[COLLECTIONS_STORAGE_KEY]) as CollectionsStore
    expect(persisted.version).toBe(COLLECTIONS_SCHEMA_VERSION)
  })

  it('stores payment provenance (txHash, network, query) in each SavedResult', () => {
    const { result } = renderHook(() => useCollections())
    act(() => { result.current.createCollection('Provenance') })
    const colId = result.current.collections[0].id
    let saved: ReturnType<typeof result.current.saveResult>
    act(() => {
      saved = result.current.saveResult(
        colId,
        MOCK_RESULT,
        'stellar x402 payments',
        'abc123txhash',
        'stellar:testnet'
      )
    })
    const persisted = JSON.parse(store[COLLECTIONS_STORAGE_KEY]) as CollectionsStore
    const persistedResult = persisted.results[saved!.id]
    expect(persistedResult.txHash).toBe('abc123txhash')
    expect(persistedResult.network).toBe('stellar:testnet')
    expect(persistedResult.query).toBe('stellar x402 payments')
    expect(persistedResult.result).toMatchObject({ id: 'r1', title: 'Stellar Docs' })
  })
})
