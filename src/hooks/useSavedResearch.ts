import { useCallback, useEffect, useState } from 'react'
import type { SavedResearchItem, SearchResult } from '../types'

const STORAGE_KEY = 'stellarsearch_saved_research'

function loadFromStorage(): SavedResearchItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (e) {
    console.error('Failed to parse saved research:', e)
    return []
  }
}

function persist(items: SavedResearchItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch (e) {
    console.error('Failed to persist saved research:', e)
  }
}

/** Deterministic id for a (query, result) pair so saving the same result from the same query twice updates the existing entry instead of duplicating it. */
function makeId(query: string, resultId: string): string {
  return `${query}::${resultId}`
}

/**
 * Manages the user's saved research: bookmarking search results, and
 * annotating them with free-text notes and tags (#305).
 *
 * Backed by localStorage, matching the existing `stellarsearch_receipts`
 * pattern used for the payment audit log — no backend persistence layer
 * exists in this app for user-generated data.
 */
export function useSavedResearch() {
  const [items, setItems] = useState<SavedResearchItem[]>([])

  useEffect(() => {
    setItems(loadFromStorage())
  }, [])

  const isSaved = useCallback(
    (query: string, resultId: string) => items.some((i) => i.id === makeId(query, resultId)),
    [items],
  )

  const save = useCallback((result: SearchResult, query: string) => {
    setItems((prev) => {
      const id = makeId(query, result.id)
      if (prev.some((i) => i.id === id)) return prev // already saved
      const next: SavedResearchItem[] = [
        {
          id,
          query,
          title: result.title,
          url: result.url,
          description: result.description,
          source: result.source,
          savedAt: new Date().toISOString(),
          notes: '',
          tags: [],
        },
        ...prev,
      ]
      persist(next)
      return next
    })
  }, [])

  const remove = useCallback((id: string) => {
    setItems((prev) => {
      const next = prev.filter((i) => i.id !== id)
      persist(next)
      return next
    })
  }, [])

  const toggle = useCallback(
    (result: SearchResult, query: string) => {
      const id = makeId(query, result.id)
      setItems((prev) => {
        if (prev.some((i) => i.id === id)) {
          const next = prev.filter((i) => i.id !== id)
          persist(next)
          return next
        }
        const next: SavedResearchItem[] = [
          {
            id,
            query,
            title: result.title,
            url: result.url,
            description: result.description,
            source: result.source,
            savedAt: new Date().toISOString(),
            notes: '',
            tags: [],
          },
          ...prev,
        ]
        persist(next)
        return next
      })
    },
    [],
  )

  const updateNotes = useCallback((id: string, notes: string) => {
    setItems((prev) => {
      const next = prev.map((i) => (i.id === id ? { ...i, notes } : i))
      persist(next)
      return next
    })
  }, [])

  const addTag = useCallback((id: string, rawTag: string) => {
    const tag = rawTag.trim().toLowerCase().replace(/\s+/g, '-')
    if (!tag) return
    setItems((prev) => {
      const next = prev.map((i) =>
        i.id === id && !i.tags.includes(tag) ? { ...i, tags: [...i.tags, tag] } : i,
      )
      persist(next)
      return next
    })
  }, [])

  const removeTag = useCallback((id: string, tag: string) => {
    setItems((prev) => {
      const next = prev.map((i) => (i.id === id ? { ...i, tags: i.tags.filter((t) => t !== tag) } : i))
      persist(next)
      return next
    })
  }, [])

  return { items, isSaved, save, remove, toggle, updateNotes, addTag, removeTag }
}
