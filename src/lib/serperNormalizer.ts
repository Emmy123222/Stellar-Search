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
