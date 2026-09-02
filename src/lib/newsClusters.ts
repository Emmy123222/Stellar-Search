import type { NewsResult } from '../types/index.js'

const normalizeTitle = (title: string) => title.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\b( breaking| update| live)\b/g, '').replace(/\s+/g, ' ').trim()

/** Deterministically groups syndicated articles by normalized title without dropping sources. */
export function clusterNewsResults(results: NewsResult[]): NewsResult[][] {
  const clusters = new Map<string, NewsResult[]>()
  for (const result of results) {
    const key = normalizeTitle(result.title)
    const cluster = clusters.get(key) ?? []
    cluster.push(result)
    clusters.set(key, cluster)
  }
  return [...clusters.values()]
}
