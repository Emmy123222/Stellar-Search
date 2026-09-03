/**
 * Deterministic Serper.dev fixtures for normalization and error-mapping tests.
 *
 * These payloads mirror what the Serper engine actually returns for the
 * organic (`/search`), image (`/images`), and news (`/news`) families, plus
 * edge cases the engine has been observed to produce: missing fields,
 * unsafe URLs, empty result sets, spelling metadata, and upstream provider
 * error responses (including hostile bodies with control characters).
 *
 * Keep these fixtures read-only and stable — tests assert exact normalized
 * shapes against them, so changing a fixture without updating assertions
 * will fail loudly.
 */

// ─── Organic (/search) ───────────────────────────────────────────────────────

export const organicEmpty = {
  searchParameters: { q: 'stellar blockchain' },
  organic: [],
}

export const organicMissingFields = {
  searchParameters: { q: 'stellar' },
  organic: [
    // Valid link, but every optional field is missing or the wrong type
    { link: 'https://example.com/bare' },
    { link: 'https://example.com/numeric-title', title: 12345, snippet: null },
    { link: 'https://example.com/numeric-date', title: 'Date', date: 2026 },
    { link: 'https://example.com/blank', title: '   ', snippet: '   ' },
  ],
}

export const organicUnsafeUrls = {
  searchParameters: { q: 'stellar' },
  organic: [
    { title: 'XSS', link: 'javascript:alert(1)' },
    { title: 'Data', link: 'data:text/html,<script>alert(1)</script>' },
    { title: 'FTP', link: 'ftp://example.com/file' },
    { title: 'Relative', link: '/relative/path' },
    { title: 'Empty Link' },
    { title: 'Malformed', link: 'not a url' },
  ],
}

export const organicMixed = {
  searchParameters: { q: 'stellar' },
  organic: [
    { title: 'Valid One', link: 'https://example.com/one', snippet: 'First snippet', date: '2026-01-01' },
    { title: 'XSS', link: 'javascript:alert(1)' },
    { title: 'Valid Two', link: 'https://www.example.com/two', description: 'Second description' },
    { title: 'No Link' },
  ],
}

export const organicSpellingCorrected = {
  searchParameters: { q: 'stellar blockchain' },
  searchInformation: { originalQuery: 'stelarr blockchan', autoCorrected: true },
  spelling: { queryCorrection: 'stellar blockchain' },
  organic: [{ title: 'Stellar Docs', link: 'https://developers.stellar.org', snippet: 'Official docs' }],
}

export const organicDidYouMean = {
  searchParameters: { q: 'stelarr blockchan' },
  spelling: { didYouMean: 'stellar blockchain' },
  organic: [{ title: 'Stelarr Results', link: 'https://stellar.org/alt', snippet: 'Alt snippet' }],
}

export const organicNull = null
export const organicNotAnObject = 'not-an-object'
export const organicWrongShape = { organic: 'not-an-array' }

// ─── Images (/images) ────────────────────────────────────────────────────────

export const imagesEmpty = {
  images: [],
}

export const imagesMissingFields = {
  images: [
    // Valid imageUrl, but optional fields missing or wrong type
    { imageUrl: 'https://img.example.com/bare.png' },
    { imageUrl: 'https://img.example.com/num-title.png', title: 42 },
    { imageUrl: 'https://img.example.com/bad-dims.png', imageWidth: 'wide', imageHeight: -10 },
    { imageUrl: 'https://img.example.com/bad-link.png', link: 'not-a-url' },
  ],
}

export const imagesUnsafeUrls = {
  images: [
    { title: 'JS', imageUrl: 'javascript:alert(1)' },
    { title: 'FTP', imageUrl: 'ftp://img.example.com/a.png' },
    { title: 'No Image URL', link: 'https://example.com' },
  ],
}

export const imagesMixed = {
  images: [
    {
      title: 'Stellar Logo',
      imageUrl: 'https://img.example.com/logo.png',
      thumbnailUrl: 'https://img.example.com/thumb.png',
      link: 'https://www.example.com/page',
      imageWidth: 800,
      imageHeight: 600,
    },
    { title: 'Bad One', imageUrl: 'data:image/png;base64,AAAA' },
    { title: 'Fallback Thumb', imageUrl: 'https://img.example.com/pic.png', imageWidth: 'invalid' },
  ],
}

export const imagesNull = null
export const imagesWrongShape = { images: 'not-an-array' }

// ─── News (/news) ────────────────────────────────────────────────────────────

export const newsEmpty = {
  news: [],
}

export const newsMissingFields = {
  news: [
    { link: 'https://news.example.com/bare' },
    { link: 'https://news.example.com/no-snippet', title: 'Headline' },
    { link: 'https://news.example.com/null-source', title: 'Null Source', source: null, imageUrl: 'ftp://bad-image' },
    { link: 'https://news.example.com/numeric-date', title: 'Numeric Date', date: 2026 },
  ],
}

export const newsUnsafeUrls = {
  news: [
    { title: 'JS', link: 'javascript:alert(1)' },
    { title: 'Relative', link: '/article/123' },
    { title: 'No Link' },
  ],
}

export const newsMixed = {
  news: [
    {
      title: 'News Headline',
      link: 'https://news.stellar.org/article',
      snippet: 'Article snippet text',
      source: 'Stellar News',
      date: '2026-02-15',
      imageUrl: 'https://news.stellar.org/header.jpg',
    },
    { title: 'Bad URL', link: 'not-a-valid-url' },
    { link: 'https://blog.example.com/post', title: '', source: null },
  ],
}

export const newsNull = null
export const newsWrongShape = { news: 'not-an-array' }

// ─── Upstream provider errors ────────────────────────────────────────────────

export interface UpstreamErrorFixture {
  status: number
  /** Raw upstream error body — may contain hostile/control characters. */
  body: string
  expectedStatus: 502
  expectedMessage: string
}

export const upstreamErrors: UpstreamErrorFixture[] = [
  {
    status: 400,
    body: '{"error":"Missing required field"}',
    expectedStatus: 502,
    expectedMessage: 'Serper.dev API error: 400',
  },
  {
    status: 403,
    body: '{"error":"Forbidden: invalid API key"}',
    expectedStatus: 502,
    expectedMessage: 'Serper.dev API error: 403',
  },
  {
    status: 429,
    body: '{"error":"Rate limit exceeded"}',
    expectedStatus: 502,
    expectedMessage: 'Serper.dev API error: 429',
  },
  {
    status: 500,
    body: '{"error":"Internal Server Error"}',
    expectedStatus: 502,
    expectedMessage: 'Serper.dev API error: 500',
  },
  {
    status: 502,
    // Hostile body with control characters — must never reach operator logs raw
    body: 'upstream\x00\x1b[31mbroken\x0anewline\x1fboom',
    expectedStatus: 502,
    expectedMessage: 'Serper.dev API error: 502',
  },
]
