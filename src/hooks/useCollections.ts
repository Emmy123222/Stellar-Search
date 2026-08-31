/**
 * useCollections.ts
 *
 * Manages named collections of saved (paid) search results.
 *
 * Storage:
 *   localStorage key: stellarsearch_collections
 *   Schema version:   COLLECTIONS_SCHEMA_VERSION (bump + migrate on breaking changes)
 *
 * Quota:
 *   Max saved results across all collections: COLLECTIONS_QUOTA_MAX (500)
 *   Max number of named collections:          COLLECTIONS_MAX_COUNT  (50)
 *
 * Resilience:
 *   - JSON parse errors → store treated as empty (corruption recovery)
 *   - localStorage.setItem quota errors → caught, error surface via `quotaError`
 *   - Unknown schema version → store reset to empty rather than mis-migrated
 */

import { useState, useCallback, useEffect } from 'react'
import type { SearchResult } from '../types'
import {
  COLLECTIONS_SCHEMA_VERSION,
  COLLECTIONS_QUOTA_MAX,
  COLLECTIONS_MAX_COUNT,
  COLLECTIONS_STORAGE_KEY,
  type Collection,
  type CollectionsStore,
  type SavedResult,
} from '../types'

// ─── Helpers ────────────────────────────────────────────────────────────────

function uuidv4(): string {
  // Use crypto.randomUUID when available (all modern browsers + Node ≥ 14.17)
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback: RFC 4122 v4 via Math.random
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function now(): string {
  return new Date().toISOString()
}

/** Empty, version-tagged store. */
function emptyStore(): CollectionsStore {
  return {
    version: COLLECTIONS_SCHEMA_VERSION,
    collections: {},
    results: {},
  }
}

/**
 * Load and validate the store from localStorage.
 * Returns an empty store on any parse/validation error (corruption recovery).
 */
function loadStore(): CollectionsStore {
  try {
    const raw = localStorage.getItem(COLLECTIONS_STORAGE_KEY)
    if (!raw) return emptyStore()
    const parsed = JSON.parse(raw) as Partial<CollectionsStore>
    // Version check — unknown versions are reset rather than migrated blindly
    if (parsed.version !== COLLECTIONS_SCHEMA_VERSION) {
      console.warn(
        `[useCollections] Unknown schema version ${parsed.version}. Resetting store.`
      )
      return emptyStore()
    }
    // Structural sanity check
    if (
      typeof parsed.collections !== 'object' ||
      parsed.collections === null ||
      typeof parsed.results !== 'object' ||
      parsed.results === null
    ) {
      console.warn('[useCollections] Corrupt store shape. Resetting store.')
      return emptyStore()
    }
    return parsed as CollectionsStore
  } catch (e) {
    console.warn('[useCollections] Failed to parse store. Resetting.', e)
    return emptyStore()
  }
}

/**
 * Persist the store to localStorage.
 * Returns true on success, false on quota exhaustion.
 */
function saveStore(store: CollectionsStore): boolean {
  try {
    localStorage.setItem(COLLECTIONS_STORAGE_KEY, JSON.stringify(store))
    return true
  } catch (e) {
    console.error('[useCollections] localStorage write failed (quota?)', e)
    return false
  }
}

// ─── Hook return type ────────────────────────────────────────────────────────

export interface UseCollectionsReturn {
  /** All collections, sorted newest-first by updatedAt. */
  collections: Collection[]
  /** All saved results, keyed by id. */
  results: Record<string, SavedResult>

  /** Set if the last write hit localStorage quota. */
  quotaError: string | null
  /** Clear the quota error banner. */
  clearQuotaError: () => void

  /**
   * Create a new named collection.
   * Returns the new collection, or null if the max-collection limit is reached.
   */
  createCollection: (name: string) => Collection | null

  /**
   * Rename a collection.
   * Returns true on success, false if not found or name invalid.
   */
  renameCollection: (collectionId: string, newName: string) => boolean

  /**
   * Delete a collection and all its saved results.
   * Returns true on success.
   */
  deleteCollection: (collectionId: string) => boolean

  /**
   * Save a search result into a collection.
   *
   * @param collectionId  Target collection.
   * @param result        The SearchResult to save (snapshot taken at call time).
   * @param query         The query that produced this result.
   * @param txHash        The x402 tx hash of the paid search.
   * @param network       Stellar network (e.g. "stellar:testnet").
   * @returns The SavedResult on success, null if quota exceeded or already saved.
   */
  saveResult: (
    collectionId: string,
    result: SearchResult,
    query: string,
    txHash: string | null,
    network: string
  ) => SavedResult | null

  /**
   * Remove a saved result from its collection.
   * Returns true on success.
   */
  removeResult: (savedResultId: string) => boolean

  /**
   * Move a saved result from its current collection to another.
   * Returns true on success.
   */
  moveResult: (savedResultId: string, targetCollectionId: string) => boolean

  /**
   * True if the given SearchResult.id is already saved in the given collection.
   */
  isSaved: (collectionId: string, resultId: string) => boolean

  /**
   * Total number of saved results across all collections.
   */
  totalSaved: number

  /**
   * Remaining quota (COLLECTIONS_QUOTA_MAX - totalSaved).
   */
  remaining: number
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useCollections(): UseCollectionsReturn {
  const [store, setStore] = useState<CollectionsStore>(() => loadStore())
  const [quotaError, setQuotaError] = useState<string | null>(null)

  // Sync in-memory state whenever another tab writes to localStorage
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === COLLECTIONS_STORAGE_KEY) {
        setStore(loadStore())
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  /** Commit a new store state — updates React state and persists. */
  const commit = useCallback((next: CollectionsStore): boolean => {
    const ok = saveStore(next)
    if (!ok) {
      setQuotaError(
        `Storage quota exceeded. Remove some collections or results to free space.`
      )
    } else {
      setQuotaError(null)
    }
    setStore(next)
    return ok
  }, [])

  const clearQuotaError = useCallback(() => setQuotaError(null), [])

  // ── Derived values ──────────────────────────────────────────────────────

  const totalSaved = Object.keys(store.results).length
  const remaining = Math.max(0, COLLECTIONS_QUOTA_MAX - totalSaved)

  const collections: Collection[] = Object.values(store.collections).sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt)
  )

  // ── Collection operations ───────────────────────────────────────────────

  const createCollection = useCallback(
    (name: string): Collection | null => {
      const trimmed = name.trim().slice(0, 100)
      if (!trimmed) return null
      const currentCount = Object.keys(store.collections).length
      if (currentCount >= COLLECTIONS_MAX_COUNT) return null

      const col: Collection = {
        id: uuidv4(),
        name: trimmed,
        createdAt: now(),
        updatedAt: now(),
        resultIds: [],
      }

      const next: CollectionsStore = {
        ...store,
        collections: { ...store.collections, [col.id]: col },
      }
      commit(next)
      return col
    },
    [store, commit]
  )

  const renameCollection = useCallback(
    (collectionId: string, newName: string): boolean => {
      const col = store.collections[collectionId]
      if (!col) return false
      const trimmed = newName.trim().slice(0, 100)
      if (!trimmed) return false

      const next: CollectionsStore = {
        ...store,
        collections: {
          ...store.collections,
          [collectionId]: { ...col, name: trimmed, updatedAt: now() },
        },
      }
      return commit(next)
    },
    [store, commit]
  )

  const deleteCollection = useCallback(
    (collectionId: string): boolean => {
      const col = store.collections[collectionId]
      if (!col) return false

      // Remove all results that belong to this collection
      const nextResults = { ...store.results }
      for (const rid of col.resultIds) {
        delete nextResults[rid]
      }

      const nextCollections = { ...store.collections }
      delete nextCollections[collectionId]

      const next: CollectionsStore = {
        ...store,
        collections: nextCollections,
        results: nextResults,
      }
      return commit(next)
    },
    [store, commit]
  )

  // ── Result operations ───────────────────────────────────────────────────

  const saveResult = useCallback(
    (
      collectionId: string,
      result: SearchResult,
      query: string,
      txHash: string | null,
      network: string
    ): SavedResult | null => {
      const col = store.collections[collectionId]
      if (!col) return null

      // Quota guard
      if (totalSaved >= COLLECTIONS_QUOTA_MAX) {
        setQuotaError(
          `Collection quota reached (${COLLECTIONS_QUOTA_MAX} results). Remove some results to continue saving.`
        )
        return null
      }

      // Deduplicate: same original result in same collection
      const alreadySavedId = col.resultIds.find(
        (rid) => store.results[rid]?.result.id === result.id
      )
      if (alreadySavedId) {
        // Return existing entry rather than duplicating
        return store.results[alreadySavedId]
      }

      const saved: SavedResult = {
        id: uuidv4(),
        collectionId,
        savedAt: now(),
        query: query.trim(),
        txHash,
        network,
        result,
      }

      const updatedCol: Collection = {
        ...col,
        resultIds: [...col.resultIds, saved.id],
        updatedAt: now(),
      }

      const next: CollectionsStore = {
        ...store,
        collections: { ...store.collections, [collectionId]: updatedCol },
        results: { ...store.results, [saved.id]: saved },
      }
      const ok = commit(next)
      return ok ? saved : null
    },
    [store, commit, totalSaved]
  )

  const removeResult = useCallback(
    (savedResultId: string): boolean => {
      const saved = store.results[savedResultId]
      if (!saved) return false

      const col = store.collections[saved.collectionId]
      const nextResults = { ...store.results }
      delete nextResults[savedResultId]

      const nextCollections = col
        ? {
            ...store.collections,
            [col.id]: {
              ...col,
              resultIds: col.resultIds.filter((id) => id !== savedResultId),
              updatedAt: now(),
            },
          }
        : store.collections

      const next: CollectionsStore = {
        ...store,
        collections: nextCollections,
        results: nextResults,
      }
      return commit(next)
    },
    [store, commit]
  )

  const moveResult = useCallback(
    (savedResultId: string, targetCollectionId: string): boolean => {
      const saved = store.results[savedResultId]
      if (!saved) return false
      if (saved.collectionId === targetCollectionId) return true

      const srcCol = store.collections[saved.collectionId]
      const dstCol = store.collections[targetCollectionId]
      if (!dstCol) return false

      // Check for duplicate in target
      const alreadyInTarget = dstCol.resultIds.some(
        (rid) => store.results[rid]?.result.id === saved.result.id
      )
      if (alreadyInTarget) return false

      const nextSaved: SavedResult = {
        ...saved,
        collectionId: targetCollectionId,
        savedAt: now(),
      }

      const nextCollections = { ...store.collections }
      if (srcCol) {
        nextCollections[srcCol.id] = {
          ...srcCol,
          resultIds: srcCol.resultIds.filter((id) => id !== savedResultId),
          updatedAt: now(),
        }
      }
      nextCollections[targetCollectionId] = {
        ...dstCol,
        resultIds: [...dstCol.resultIds, savedResultId],
        updatedAt: now(),
      }

      const next: CollectionsStore = {
        ...store,
        collections: nextCollections,
        results: { ...store.results, [savedResultId]: nextSaved },
      }
      return commit(next)
    },
    [store, commit]
  )

  const isSaved = useCallback(
    (collectionId: string, resultId: string): boolean => {
      const col = store.collections[collectionId]
      if (!col) return false
      return col.resultIds.some((rid) => store.results[rid]?.result.id === resultId)
    },
    [store]
  )

  return {
    collections,
    results: store.results,
    quotaError,
    clearQuotaError,
    createCollection,
    renameCollection,
    deleteCollection,
    saveResult,
    removeResult,
    moveResult,
    isSaved,
    totalSaved,
    remaining,
  }
}
