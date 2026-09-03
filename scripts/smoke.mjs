#!/usr/bin/env node
/**
 * scripts/smoke.mjs
 *
 * Non-secret smoke suite for a deployed StellarSearch preview (issue: "Run
 * smoke tests against preview deployments before merge").
 *
 * Validates what only a real deployment can prove — serverless routing, CORS
 * wiring, environment wiring, static assets, and the SPA rewrite — plus the
 * x402 payment semantics that must survive every deploy.
 *
 * NON-SECRET BY CONSTRUCTION:
 *   - no API keys, no wallet, no signing material, no repository secrets;
 *   - it never settles a payment, so a run costs 0 USDC. The x402 checks stop
 *     at the 402 challenge and assert its *shape* (scheme/network/amount/
 *     asset/payTo), which is exactly the part a bad deploy breaks.
 *
 * Zero dependencies: plain ESM on Node 18+ (global `fetch`), so CI can run it
 * straight from a checkout without `npm ci`.
 *
 * Usage:
 *   node scripts/smoke.mjs <base-url> [--json <path>] [--markdown <path>]
 *
 * Exit code 0 when every check passes, 1 otherwise. Failures name the exact
 * endpoint and carry the captured response artifact.
 */

/** Response headers worth keeping in the artifact. Anything else is dropped. */
const ARTIFACT_HEADERS = [
  'content-type',
  'cache-control',
  'payment-required',
  'payment-response',
  'x-payment-response',
  'access-control-allow-origin',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-expose-headers',
  'x-vercel-id',
  'x-vercel-cache',
  'x-matched-path',
  'server',
]

/** Header names that must never reach an artifact, however the server replies. */
const REDACTED_HEADERS = ['authorization', 'set-cookie', 'x-api-key', 'payment-signature', 'x-payment']

const MAX_BODY_SNIPPET = 2000

const STELLAR_ADDRESS = /^G[A-Z2-7]{55}$/
const SOROBAN_CONTRACT = /^C[A-Z2-7]{55}$/

/** The query every check reuses. Encoded via URLSearchParams, never by hand. */
const SAMPLE_QUERY = 'stellar lumens'

/**
 * Decodes the base64 `PAYMENT-REQUIRED` challenge header into the x402 v2
 * payment-requirements object.
 *
 * @param {string} value Raw header value.
 * @returns {{ok: true, value: object} | {ok: false, error: string}}
 */
export function decodePaymentRequired(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return { ok: false, error: 'PAYMENT-REQUIRED header is missing or empty' }
  }
  let json
  try {
    json = Buffer.from(value, 'base64').toString('utf8')
  } catch {
    return { ok: false, error: 'PAYMENT-REQUIRED header is not valid base64' }
  }
  try {
    const parsed = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, error: 'PAYMENT-REQUIRED header did not decode to an object' }
    }
    return { ok: true, value: parsed }
  } catch {
    return { ok: false, error: `PAYMENT-REQUIRED header is not valid JSON: ${json.slice(0, 120)}` }
  }
}

/**
 * Asserts the x402 settlement semantics carried by a 402 challenge.
 *
 * These are the invariants a broken deploy silently violates: the wrong
 * network, dollars instead of stroops, or `USDC:ISSUER` instead of the Soroban
 * contract address. Returns a list of human-readable failures (empty = pass).
 *
 * @param {object} challenge Decoded payment-requirements object.
 * @returns {string[]} Failure descriptions.
 */
export function checkPaymentRequirements(challenge) {
  const failures = []
  if (challenge.x402Version !== 2) {
    failures.push(`expected x402Version 2, got ${JSON.stringify(challenge.x402Version)}`)
  }
  const accepts = challenge.accepts
  if (!Array.isArray(accepts) || accepts.length === 0) {
    failures.push('challenge has no `accepts` payment options')
    return failures
  }
  const option = accepts[0]
  if (option.scheme !== 'exact') {
    failures.push(`accepts[0].scheme must be "exact", got ${JSON.stringify(option.scheme)}`)
  }
  if (!/^stellar:(testnet|mainnet)$/.test(String(option.network))) {
    failures.push(`accepts[0].network must be stellar:testnet|stellar:mainnet, got ${JSON.stringify(option.network)}`)
  }
  // Amounts are stroops (integer strings), never a decimal dollar figure.
  if (!/^\d+$/.test(String(option.amount))) {
    failures.push(`accepts[0].amount must be an integer stroop string, got ${JSON.stringify(option.amount)}`)
  }
  if (!SOROBAN_CONTRACT.test(String(option.asset))) {
    failures.push(`accepts[0].asset must be a Soroban C... contract address (not "USDC:ISSUER"), got ${JSON.stringify(option.asset)}`)
  }
  if (!STELLAR_ADDRESS.test(String(option.payTo))) {
    failures.push(`accepts[0].payTo must be a Stellar G... address, got ${JSON.stringify(option.payTo)}`)
  }
  if (typeof option.maxTimeoutSeconds !== 'number' || option.maxTimeoutSeconds <= 0) {
    failures.push(`accepts[0].maxTimeoutSeconds must be a positive number, got ${JSON.stringify(option.maxTimeoutSeconds)}`)
  }
  return failures
}

/** The activity statistics a `/health` response may report (see src/lib/serverHealth.ts). */
const MEASURED_STAT_FIELDS = ['totalQueries', 'totalUsdcSettled', 'avgLatencyMs', 'uptime']

/**
 * Asserts that a health payload says what it measures.
 *
 * A serverless deployment cannot hold a durable counter, so it must declare the
 * gap rather than omit the fields silently — a silent omission is what let the
 * UI render "0 queries, $0.00 settled" as if it were a live measurement. Either
 * declaration is acceptable here; an undeclared omission is not.
 *
 * @param {object} health Parsed `/health` body.
 * @returns {string[]} Failure descriptions.
 */
export function checkStatsDeclaration(health) {
  const failures = []
  if (typeof health.statsSupported !== 'boolean') {
    failures.push(
      `health must declare \`statsSupported\` (true/false) so consumers can tell an unmeasured field from a real zero, got ${JSON.stringify(health.statsSupported)}`,
    )
    return failures
  }
  if (!Array.isArray(health.unsupportedFields)) {
    failures.push(`health must declare \`unsupportedFields\` as an array, got ${JSON.stringify(health.unsupportedFields)}`)
    return failures
  }

  if (health.statsSupported) {
    if (health.unsupportedFields.length > 0) {
      failures.push(`statsSupported is true but unsupportedFields is not empty: ${JSON.stringify(health.unsupportedFields)}`)
    }
    // A runtime claiming to measure must actually report the values.
    for (const field of MEASURED_STAT_FIELDS) {
      if (health[field] === undefined || health[field] === null) {
        failures.push(`statsSupported is true but \`${field}\` is missing from the response`)
      }
    }
    return failures
  }

  // Unsupported: the gap must be explained, and no fabricated value left behind.
  if (typeof health.statsUnavailableReason !== 'string' || health.statsUnavailableReason.trim() === '') {
    failures.push('statsSupported is false but no statsUnavailableReason was given')
  }
  for (const field of health.unsupportedFields) {
    if (health[field] !== undefined) {
      failures.push(`\`${field}\` is declared unsupported but a value was still reported: ${JSON.stringify(health[field])}`)
    }
  }
  return failures
}

/** Builds a query string without hand-encoding anything. */
function qs(params) {
  const sp = new URLSearchParams()
  for (const [k, v] of params) sp.append(k, v)
  return `?${sp.toString()}`
}

/**
 * The smoke checks. Each `expect` receives the captured response and returns a
 * list of failures; an empty list means the check passed.
 *
 * `status` is asserted separately so a wrong status reports cleanly even when
 * the body is unparseable (an HTML error page from a misrouted request, say).
 */
export const CHECKS = [
  {
    id: 'static-spa-shell',
    name: 'Static SPA shell is served at /',
    method: 'GET',
    path: '/',
    status: [200],
    expect: ({ headers, text }) => {
      const failures = []
      if (!String(headers['content-type'] || '').includes('text/html')) {
        failures.push(`expected text/html, got ${JSON.stringify(headers['content-type'])}`)
      }
      if (!text.includes('id="root"')) failures.push('index.html did not contain the #root mount point')
      return failures
    },
  },
  {
    id: 'static-favicon',
    name: 'Static asset /favicon.svg is served',
    method: 'GET',
    path: '/favicon.svg',
    status: [200],
    expect: ({ headers }) =>
      String(headers['content-type'] || '').includes('svg')
        ? []
        : [`expected an SVG content-type, got ${JSON.stringify(headers['content-type'])}`],
  },
  {
    id: 'spa-rewrite-deep-link',
    name: 'SPA rewrite serves the shell for a non-API deep link',
    method: 'GET',
    path: '/docs',
    status: [200],
    expect: ({ headers, text }) => {
      const failures = []
      if (!String(headers['content-type'] || '').includes('text/html')) {
        failures.push(
          `deep link was not rewritten to index.html — got ${JSON.stringify(headers['content-type'])}. Check the "rewrites" block in vercel.json.`,
        )
      }
      if (!text.includes('id="root"')) failures.push('rewritten response was not the SPA shell')
      return failures
    },
  },
  {
    id: 'api-service-descriptor',
    name: 'GET /api returns the service descriptor',
    method: 'GET',
    path: '/api',
    status: [200],
    expect: ({ json }) => {
      if (!json) return ['response body was not JSON — serverless routing for api/index.ts may be broken']
      const failures = []
      if (json.name !== 'StellarSearch') failures.push(`expected name "StellarSearch", got ${JSON.stringify(json.name)}`)
      if (!json.endpoints || typeof json.endpoints !== 'object') failures.push('descriptor is missing the `endpoints` map')
      return failures
    },
  },
  {
    id: 'api-health-env-wiring',
    name: 'GET /api/health proves environment wiring',
    method: 'GET',
    path: '/api/health',
    status: [200],
    expect: ({ json }) => {
      if (!json) {
        return [
          'health did not return JSON — a 500 here usually means required env vars (STELLAR_RECEIVING_ADDRESS, SERPER_API_KEY) are not set on this deployment',
        ]
      }
      const failures = []
      if (json.status !== 'ok') failures.push(`expected status "ok", got ${JSON.stringify(json.status)}`)
      if (json.protocol !== 'x402') failures.push(`expected protocol "x402", got ${JSON.stringify(json.protocol)}`)
      if (!/^stellar:(testnet|mainnet)$/.test(String(json.network))) {
        failures.push(`network must be stellar:testnet|stellar:mainnet, got ${JSON.stringify(json.network)}`)
      }
      if (json.receivingAddressConfigured !== true) failures.push('receivingAddressConfigured is not true')
      failures.push(...checkStatsDeclaration(json))
      return failures
    },
  },
  {
    id: 'cors-preflight',
    name: 'CORS preflight on /api/search advertises the x402 payment headers',
    method: 'OPTIONS',
    path: '/api/search',
    headers: {
      Origin: 'https://example.com',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'payment-signature',
    },
    status: [200, 204],
    expect: ({ headers }) => {
      const failures = []
      if (!headers['access-control-allow-origin']) failures.push('missing Access-Control-Allow-Origin')
      const methods = String(headers['access-control-allow-methods'] || '').toUpperCase()
      if (!methods.includes('GET')) failures.push(`Access-Control-Allow-Methods must include GET, got ${JSON.stringify(headers['access-control-allow-methods'])}`)
      const allowed = String(headers['access-control-allow-headers'] || '').toLowerCase()
      // Without these a browser client can never send the signed payload.
      for (const required of ['payment-signature', 'x-payment']) {
        if (!allowed.includes(required)) {
          failures.push(`Access-Control-Allow-Headers must include ${required}, got ${JSON.stringify(headers['access-control-allow-headers'])}`)
        }
      }
      return failures
    },
  },
  {
    id: 'api-search-method-guard',
    name: 'POST /api/search is rejected with 405',
    method: 'POST',
    path: '/api/search',
    status: [405],
    expect: ({ json }) => (json && json.error ? [] : ['expected a JSON error body']),
  },
  {
    id: 'api-search-missing-q',
    name: 'GET /api/search without `q` is rejected with 400',
    method: 'GET',
    path: '/api/search',
    status: [400],
    expect: ({ json }) =>
      json && /Missing required parameter: q/.test(String(json.error))
        ? []
        : [`expected "Missing required parameter: q", got ${JSON.stringify(json && json.error)}`],
  },
  {
    id: 'api-search-count-out-of-bounds',
    name: 'GET /api/search?count=999 is rejected with 400 before any payment challenge',
    method: 'GET',
    path: () => `/api/search${qs([['q', SAMPLE_QUERY], ['count', '999']])}`,
    status: [400],
    expect: ({ json }) =>
      json && /count/.test(String(json.error))
        ? []
        : [`expected a count validation error (not a 402 challenge), got ${JSON.stringify(json && json.error)}`],
  },
  {
    id: 'api-search-count-repeated',
    name: 'GET /api/search with a repeated `count` is rejected with 400',
    method: 'GET',
    path: () => `/api/search${qs([['q', SAMPLE_QUERY], ['count', '1'], ['count', '2']])}`,
    status: [400],
    expect: ({ json }) =>
      json && /single value/.test(String(json.error))
        ? []
        : [`expected a "single value" error, got ${JSON.stringify(json && json.error)}`],
  },
  {
    id: 'api-search-bad-freshness',
    name: 'GET /api/search with an unknown `freshness` is rejected with 400',
    method: 'GET',
    path: () => `/api/search${qs([['q', SAMPLE_QUERY], ['freshness', 'yesterday']])}`,
    status: [400],
    expect: ({ json }) =>
      json && /freshness/.test(String(json.error))
        ? []
        : [`expected a freshness validation error, got ${JSON.stringify(json && json.error)}`],
  },
  {
    id: 'api-search-x402-challenge',
    name: 'GET /api/search returns a well-formed x402 402 challenge',
    method: 'GET',
    path: () => `/api/search${qs([['q', SAMPLE_QUERY], ['count', '3']])}`,
    status: [402],
    expect: ({ headers }) => {
      const decoded = decodePaymentRequired(headers['payment-required'])
      if (!decoded.ok) return [decoded.error]
      const failures = checkPaymentRequirements(decoded.value)
      const exposed = String(headers['access-control-expose-headers'] || '').toLowerCase()
      if (!exposed.includes('payment-required')) {
        failures.push(
          `Access-Control-Expose-Headers must include PAYMENT-REQUIRED or browser clients cannot read the challenge, got ${JSON.stringify(headers['access-control-expose-headers'])}`,
        )
      }
      return failures
    },
  },
]

/** Copies only the allow-listed headers, dropping anything sensitive. */
function captureHeaders(res) {
  const out = {}
  for (const name of ARTIFACT_HEADERS) {
    if (REDACTED_HEADERS.includes(name)) continue
    const value = res.headers.get(name)
    if (value !== null && value !== undefined) out[name] = value
  }
  return out
}

/**
 * Runs a single check against `baseUrl`.
 *
 * Never throws: a transport failure becomes a failed result so the report can
 * name the endpoint that could not be reached.
 *
 * @param {object} check One entry from `CHECKS`.
 * @param {string} baseUrl Deployment origin, without a trailing slash.
 * @param {typeof fetch} fetchImpl Injected for tests.
 * @returns {Promise<object>} The check result.
 */
export async function runCheck(check, baseUrl, fetchImpl = fetch) {
  const path = typeof check.path === 'function' ? check.path() : check.path
  const url = `${baseUrl}${path}`
  const startedAt = Date.now()

  let res
  try {
    res = await fetchImpl(url, {
      method: check.method,
      headers: { 'User-Agent': 'stellar-search-smoke/1', ...(check.headers || {}) },
      redirect: 'manual',
    })
  } catch (err) {
    return {
      id: check.id,
      name: check.name,
      method: check.method,
      path,
      url,
      ok: false,
      status: null,
      expectedStatus: check.status,
      durationMs: Date.now() - startedAt,
      headers: {},
      bodySnippet: '',
      failures: [`request failed: ${err && err.message ? err.message : String(err)}`],
    }
  }

  const text = await res.text().catch(() => '')
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    // Non-JSON is expected for the static/SPA checks.
  }

  const headers = captureHeaders(res)
  const failures = []
  if (!check.status.includes(res.status)) {
    failures.push(`expected HTTP ${check.status.join(' or ')}, got ${res.status}`)
  }
  // Body assertions still run on a wrong status — they usually explain why.
  failures.push(...check.expect({ status: res.status, headers, text, json }))

  return {
    id: check.id,
    name: check.name,
    method: check.method,
    path,
    url,
    ok: failures.length === 0,
    status: res.status,
    expectedStatus: check.status,
    durationMs: Date.now() - startedAt,
    headers,
    bodySnippet: text.length > MAX_BODY_SNIPPET ? `${text.slice(0, MAX_BODY_SNIPPET)}… [truncated]` : text,
    failures,
  }
}

/**
 * Runs the whole suite sequentially.
 *
 * @param {string} rawBaseUrl Deployment URL (trailing slash tolerated).
 * @param {{fetchImpl?: typeof fetch, checks?: object[]}} [options]
 * @returns {Promise<{ok: boolean, baseUrl: string, startedAt: string, results: object[], passed: number, failed: number}>}
 */
export async function runSmoke(rawBaseUrl, options = {}) {
  const { fetchImpl = fetch, checks = CHECKS } = options
  const baseUrl = normalizeBaseUrl(rawBaseUrl)
  const startedAt = new Date().toISOString()

  const results = []
  for (const check of checks) {
    results.push(await runCheck(check, baseUrl, fetchImpl))
  }

  const failed = results.filter((r) => !r.ok).length
  return {
    ok: failed === 0,
    baseUrl,
    startedAt,
    results,
    passed: results.length - failed,
    failed,
  }
}

/**
 * Validates and normalizes the deployment URL.
 *
 * @param {string} raw Candidate URL; a bare host is assumed to be https.
 * @returns {string} Origin with no trailing slash.
 */
export function normalizeBaseUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error('A deployment URL is required, e.g. node scripts/smoke.mjs https://my-preview.vercel.app')
  }
  const trimmed = raw.trim()
  // Only a scheme-less value gets the https default; anything that already
  // names a scheme is passed through so a bad one is reported, not smuggled
  // into the path of an https URL.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
  const candidate = hasScheme ? trimmed : `https://${trimmed}`
  let parsed
  try {
    parsed = new URL(candidate)
  } catch {
    throw new Error(`Invalid deployment URL: ${raw}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Deployment URL must be http(s), got ${parsed.protocol}`)
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/$/, '')}`
}

/**
 * Renders a GitHub-friendly Markdown report. Failing checks come first and
 * carry the captured response so the summary alone identifies the breakage.
 *
 * @param {object} summary Result of `runSmoke`.
 * @returns {string} Markdown.
 */
export function formatMarkdown(summary) {
  const lines = []
  lines.push(`## Preview smoke ${summary.ok ? '✅ passed' : '❌ failed'}`)
  lines.push('')
  lines.push(`**Deployment:** ${summary.baseUrl}`)
  lines.push('')
  lines.push(`**Result:** ${summary.passed} passed, ${summary.failed} failed, ${summary.results.length} total`)
  lines.push('')

  const failures = summary.results.filter((r) => !r.ok)
  if (failures.length > 0) {
    lines.push('### Failed endpoints')
    lines.push('')
    for (const r of failures) {
      lines.push(`#### \`${r.method} ${r.path}\` — ${r.name}`)
      lines.push('')
      lines.push(`- **URL:** ${r.url}`)
      lines.push(`- **Status:** ${r.status === null ? 'no response' : r.status} (expected ${r.expectedStatus.join(' or ')})`)
      for (const f of r.failures) lines.push(`- ${f}`)
      lines.push('')
      lines.push('<details><summary>Response artifact</summary>')
      lines.push('')
      lines.push('```json')
      lines.push(JSON.stringify({ headers: r.headers, body: r.bodySnippet }, null, 2))
      lines.push('```')
      lines.push('')
      lines.push('</details>')
      lines.push('')
    }
  }

  lines.push('### All checks')
  lines.push('')
  lines.push('| | Check | Endpoint | Status | ms |')
  lines.push('|---|---|---|---:|---:|')
  for (const r of summary.results) {
    lines.push(
      `| ${r.ok ? '✅' : '❌'} | ${r.name} | \`${r.method} ${r.path}\` | ${r.status === null ? '—' : r.status} | ${r.durationMs} |`,
    )
  }
  lines.push('')
  return lines.join('\n')
}

/** Parses `--json <path>` / `--markdown <path>` out of argv. */
export function parseArgs(argv) {
  const positional = []
  const options = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--json' || arg === '--markdown') {
      const value = argv[i + 1]
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a file path`)
      options[arg.slice(2)] = value
      i++
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`)
    } else {
      positional.push(arg)
    }
  }
  return { baseUrl: positional[0], options }
}

/* c8 ignore start — CLI wiring, exercised by CI rather than unit tests */
async function main() {
  const { writeFileSync, mkdirSync } = await import('node:fs')
  const { dirname } = await import('node:path')

  let baseUrl
  let options
  try {
    ;({ baseUrl, options } = parseArgs(process.argv.slice(2)))
    baseUrl = normalizeBaseUrl(baseUrl)
  } catch (err) {
    console.error(`✗ ${err.message}`)
    process.exit(1)
  }

  console.log(`Running ${CHECKS.length} non-secret smoke checks against ${baseUrl}\n`)
  const summary = await runSmoke(baseUrl)

  for (const r of summary.results) {
    console.log(`${r.ok ? '✓' : '✗'} ${r.method} ${r.path} — ${r.name} (${r.status ?? 'no response'}, ${r.durationMs}ms)`)
    for (const f of r.failures) console.log(`    → ${f}`)
  }

  const write = (path, contents) => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, contents)
    console.log(`\nWrote ${path}`)
  }
  if (options.json) write(options.json, `${JSON.stringify(summary, null, 2)}\n`)
  if (options.markdown) write(options.markdown, formatMarkdown(summary))

  if (!summary.ok) {
    const failed = summary.results.filter((r) => !r.ok)
    console.error(`\n✗ ${summary.failed} of ${summary.results.length} checks failed:`)
    for (const r of failed) {
      console.error(`  ${r.method} ${r.url} → ${r.status ?? 'no response'} (expected ${r.expectedStatus.join(' or ')})`)
      for (const f of r.failures) console.error(`      ${f}`)
      if (r.bodySnippet) console.error(`      body: ${r.bodySnippet.slice(0, 400)}`)
    }
    process.exit(1)
  }

  console.log(`\n✓ All ${summary.results.length} checks passed against ${baseUrl}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
/* c8 ignore stop */
