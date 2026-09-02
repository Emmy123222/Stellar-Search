import { describe, expect, it } from 'vitest'
import { resolveApiUrl } from './config'

describe('resolveApiUrl', () => {
  it.each([
    [{ VITE_SERVER_URL: 'http://localhost:3001' }, '/health', 'http://localhost:3001/health'],
    [{ VITE_SERVER_URL: 'https://example.com/api/' }, '/search', 'https://example.com/api/search'],
    [{}, 'health', '/api/health'],
  ])('joins a configured base and route', (env, path, expected) => {
    expect(resolveApiUrl(path, env)).toBe(expected)
  })
})
