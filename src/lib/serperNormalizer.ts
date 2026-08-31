import type { SearchResult, ImageResult, NewsResult } from '../types/index.js'

/**
 * Validates whether a given string is a valid HTTP or HTTPS URL.
 */
export function isValidHttpUrl(url: unknown): boolean {
  if (typeof url !== 'string' || !url.trim()) return false
  try {
    const parsed = new URL(url.trim())
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Safely extracts a display hostname (domain) from a URL string.
 */
export function extractSafeHostname(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.hostname.replace(/^www\./i, '')
  } catch {
    return url || 'unknown'
  }
}

/**
 * Validates unknown raw upstream JSON payload from Serper web search
 * and normalizes organic results deterministically. Skips malformed rows.
 */
export function normalizeOrganicResults(rawData: unknown): SearchResult[] {
  if (!rawData || typeof rawData !== 'object') {
    return []
  }

  const payload = rawData as Record<string, unknown>
  if (!Array.isArray(payload.organic)) {
    return []
  }

  const validResults: SearchResult[] = []

  for (const item of payload.organic) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const row = item as Record<string, unknown>

    // Must have a valid HTTP/HTTPS link
    if (!isValidHttpUrl(row.link)) {
      continue
    }

    const url = (row.link as string).trim()

    // Title: string or fallback
    const title = typeof row.title === 'string' && row.title.trim()
      ? row.title.trim()
      : 'No title'

    // Description: snippet or description or empty
    let description = ''
    if (typeof row.snippet === 'string' && row.snippet.trim()) {
      description = row.snippet.trim()
    } else if (typeof row.description === 'string' && row.description.trim()) {
      description = row.description.trim()
    }

    // Source domain
    const source = extractSafeHostname(url)

    // Published date
    const publishedAt = typeof row.date === 'string' && row.date.trim()
      ? row.date.trim()
      : undefined

    const index = validResults.length
    validResults.push({
      id: String(index + 1),
      title,
      url,
      description,
      source,
      relevanceScore: Math.max(0.5, 1 - index * 0.06),
      publishedAt,
    })
  }

  return validResults
}

/**
 * Validates unknown raw upstream JSON payload from Serper image search
 * and normalizes image results deterministically. Skips malformed rows.
 */
export function normalizeImageResults(rawData: unknown): ImageResult[] {
  if (!rawData || typeof rawData !== 'object') {
    return []
  }

  const payload = rawData as Record<string, unknown>
  if (!Array.isArray(payload.images)) {
    return []
  }

  const validResults: ImageResult[] = []

  for (const item of payload.images) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const row = item as Record<string, unknown>

    // Must have a valid HTTP/HTTPS imageUrl
    if (!isValidHttpUrl(row.imageUrl)) {
      continue
    }

    const imageUrl = (row.imageUrl as string).trim()

    // Title: string or fallback
    const title = typeof row.title === 'string' && row.title.trim()
      ? row.title.trim()
      : 'No title'

    // Source URL / link
    const sourceUrl = isValidHttpUrl(row.link)
      ? (row.link as string).trim()
      : imageUrl

    // Thumbnail URL
    const thumbnailUrl = isValidHttpUrl(row.thumbnailUrl)
      ? (row.thumbnailUrl as string).trim()
      : imageUrl

    // Source domain
    const source = extractSafeHostname(sourceUrl)

    // Dimensions
    const width = typeof row.imageWidth === 'number' && Number.isFinite(row.imageWidth) && row.imageWidth > 0
      ? row.imageWidth
      : undefined

    const height = typeof row.imageHeight === 'number' && Number.isFinite(row.imageHeight) && row.imageHeight > 0
      ? row.imageHeight
      : undefined

    const index = validResults.length
    validResults.push({
      id: String(index + 1),
      title,
      imageUrl,
      thumbnailUrl,
      sourceUrl,
      source,
      width,
      height,
    })
  }

  return validResults
}

/**
 * Validates unknown raw upstream JSON payload from Serper news search
 * and normalizes news results deterministically. Skips malformed rows.
 */
export function normalizeNewsResults(rawData: unknown): NewsResult[] {
  if (!rawData || typeof rawData !== 'object') {
    return []
  }

  const payload = rawData as Record<string, unknown>
  if (!Array.isArray(payload.news)) {
    return []
  }

  const validResults: NewsResult[] = []

  for (const item of payload.news) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const row = item as Record<string, unknown>

    // Must have a valid HTTP/HTTPS link
    if (!isValidHttpUrl(row.link)) {
      continue
    }

    const url = (row.link as string).trim()

    // Title: string or fallback
    const title = typeof row.title === 'string' && row.title.trim()
      ? row.title.trim()
      : 'No title'

    // Snippet: string or empty
    const snippet = typeof row.snippet === 'string' && row.snippet.trim()
      ? row.snippet.trim()
      : ''

    // Source: explicit string or fallback to hostname
    const source = typeof row.source === 'string' && row.source.trim()
      ? row.source.trim()
      : extractSafeHostname(url)

    // Published date
    const publishedAt = typeof row.date === 'string' && row.date.trim()
      ? row.date.trim()
      : undefined

    // Image URL
    const imageUrl = isValidHttpUrl(row.imageUrl)
      ? (row.imageUrl as string).trim()
      : undefined

    const index = validResults.length
    validResults.push({
      id: String(index + 1),
      title,
      url,
      snippet,
      source,
      publishedAt,
      imageUrl,
    })
  }

  return validResults
}

/**
 * Compares two result sets (previous and current) by canonical URL and
 * categorizes each result as added, removed, moved, or unchanged.
 * Items are matched by their canonical URL; moved items are those present in
 * both sets but at different ranks (indices). The comparison is stable: in the
 * output, items retain the order they appear in the current set.
 *
 * @param previous - The earlier stored result set.
 * @param current - The later stored result set.
 * @param getCanonicalUrl - Function that returns the canonical URL for a result.
 * @returns A comparison object containing arrays for added, removed, moved, and unchanged items.
 */
export function compareResultSets<T>(
  previous: readonly T[],
  current: readonly T[],
  getCanonicalUrl: (item: T) => string
): {
  added: T[]
  removed: T[]
  moved: Array<{ item: T; previousRank: number; currentRank: number }>
  unchanged: T[]
} {
  const previousIndexByUrl = new Map<string, number>()
  const currentIndexByUrl = new Map<string, number>()

  previous.forEach((item, index) => {
    const key = getCanonicalUrl(item)
    if (!previousIndexByUrl.has(key)) {
      previousIndexByUrl.set(key, index)
    }
  })

  current.forEach((item, index) => {
    const key = getCanonicalUrl(item)
    if (!currentIndexByUrl.has(key)) {
      currentIndexByUrl.set(key, index)
    }
  })

  const added: T[] = []
  const removed: T[] = []
  const moved: Array<{ item: T; previousRank: number; currentRank: number }> = []
  const unchanged: T[] = []

  current.forEach((item, index) => {
    const key = getCanonicalUrl(item)
    const previousIndex = previousIndexByUrl.get(key)
    if (previousIndex === undefined) {
      added.push(item)
    } else {
      if (previousIndex !== index) {
        moved.push({ item, previousRank: previousIndex, currentRank: index })
      } else {
        unchanged.push(item)
      }
    }
  })

  previous.forEach((item) => {
    const key = getCanonicalUrl(item)
    if (!currentIndexByUrl.has(key)) {
      removed.push(item)
    }
  })

  return { added, removed, moved, unchanged }
}
