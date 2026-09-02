/**
 * scripts/smoke.test.ts
 *
 * Covers the preview-deployment smoke suite (`scripts/smoke.mjs`) with a
 * stubbed deployment, so the gate that guards every preview is itself tested:
 *
 *   - primary flow  — a healthy deployment passes all checks;
 *   - boundary      — the x402 challenge validator accepts only real
 *                     settlement semantics (stroops, Soroban C... asset, G...
 *                     payTo) and rejects the near-misses a bad deploy produces;
 *   - failure paths — wrong status, missing SPA rewrite, missing CORS payment
 *                     headers, unreachable host, and malformed input, each
 *                     reported with the exact endpoint and a response artifact.
 */

import { describe, it, expect, vi } from 'vitest'
// @ts-expect-error — plain ESM helper, intentionally dependency-free for CI.
import {
  CHECKS,
  runCheck,
  runSmoke,
  decodePaymentRequired,
  checkPaymentRequirements,
  checkStatsDeclaration,
  normalizeBaseUrl,
  formatMarkdown,
  parseArgs,
} from './smoke.mjs'

const BASE = 'https://stellar-search-preview.vercel.app'

const PAY_TO = 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3'
const USDC_CONTRACT = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA'

const SPA_SHELL = '<!doctype html><html><body><div id="root"></div></body></html>'

function challenge(overrides: Record<string, unknown> = {}) {
  const payload = {
    x402Version: 2,
    error: 'Payment required',
    resource: { url: `${BASE}/api/search`, description: 'StellarSearch', mimeType: 'application/json' },
    accepts: [
      {
        scheme: 'exact',
        network: 'stellar:testnet',
        amount: '10000',
        asset: USDC_CONTRACT,
        payTo: PAY_TO,
        maxTimeoutSeconds: 300,
        extra: { areFeesSponsored: true },
        ...overrides,
      },
    ],
  }
  return Buffer.from(JSON.stringify(payload)).toString('base64')
}

function response(body: string, init: { status?: number; headers?: Record<string, string> } = {}) {
  const headers = new Map(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    status: init.status ?? 200,
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    text: async () => body,
  }
}

/** A stub of a correctly deployed preview. `overrides` break one route at a time. */
function deployment(overrides: Record<string, ReturnType<typeof response>> = {}) {
  return vi.fn(async (url: string) => {
    const { pathname, searchParams } = new URL(url)
    const key = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`
    if (overrides[key]) return overrides[key]
    if (overrides[pathname]) return overrides[pathname]

    if (pathname === '/' || pathname === '/docs') {
      return response(SPA_SHELL, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    }
    if (pathname === '/favicon.svg') {
      return response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } })
    }
    if (pathname === '/api') {
      return response(JSON.stringify({ name: 'StellarSearch', version: '1.0.0', endpoints: {} }), {
        headers: { 'content-type': 'application/json' },
      })
    }
    if (pathname === '/api/health') {
      return response(
        JSON.stringify({
          status: 'ok',
          network: 'stellar:testnet',
          protocol: 'x402',
          receivingAddressConfigured: true,
          serperApiConfigured: true,
          // Serverless declares that it measures no activity counters (#226).
          statsSupported: false,
          unsupportedFields: ['totalQueries', 'totalUsdcSettled', 'avgLatencyMs', 'uptime'],
          statsUnavailableReason: 'Serverless functions are stateless.',
        }),
        { headers: { 'content-type': 'application/json' } },
      )
    }
    if (pathname === '/api/search') {
      // Parameter validation precedes the payment challenge (#188).
      const counts = searchParams.getAll('count')
      const freshness = searchParams.getAll('freshness')
      const json = (status: number, error: string) =>
        response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json' } })

      if (!searchParams.get('q')) return json(400, 'Missing required parameter: q')
      if (counts.length > 1) return json(400, 'count must be a single value')
      if (counts.length === 1 && Number(counts[0]) > 20) return json(400, 'count must be between 1 and 20')
      if (freshness.length === 1 && !['pd', 'pw', 'pm'].includes(freshness[0])) {
        return json(400, 'freshness must be one of: pd, pw, pm')
      }
      return response('{}', {
        status: 402,
        headers: {
          'content-type': 'application/json',
          'payment-required': challenge(),
          'access-control-expose-headers': 'PAYMENT-REQUIRED, X-Payment-Response',
        },
      })
    }
    return response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } })
  })
}

/** POST and OPTIONS are keyed by method rather than path in the stub above. */
function deploymentWithMethods(overrides: Record<string, ReturnType<typeof response>> = {}) {
  const base = deployment(overrides)
  return vi.fn(async (url: string, init: any) => {
    const { pathname } = new URL(url)
    if (init?.method === 'OPTIONS' && pathname === '/api/search') {
      return (
        overrides['OPTIONS /api/search'] ??
        response('', {
          status: 204,
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-methods': 'GET, POST, OPTIONS',
            'access-control-allow-headers': 'Content-Type, Authorization, X-Payment, payment-signature',
          },
        })
      )
    }
    if (init?.method === 'POST' && pathname === '/api/search') {
      return (
        overrides['POST /api/search'] ??
        response(JSON.stringify({ error: 'Method not allowed' }), {
          status: 405,
          headers: { 'content-type': 'application/json' },
        })
      )
    }
    return base(url)
  })
}

// ─── Primary flow ────────────────────────────────────────────────────────────

describe('smoke suite — primary flow', () => {
  it('passes every check against a correctly wired deployment', async () => {
    const summary = await runSmoke(BASE, { fetchImpl: deploymentWithMethods() })

    expect(summary.ok).toBe(true)
    expect(summary.failed).toBe(0)
    expect(summary.passed).toBe(CHECKS.length)
    expect(summary.results.every((r: any) => r.failures.length === 0)).toBe(true)
  })

  it('covers serverless routing, CORS, env wiring, static assets, and x402 in one run', async () => {
    const summary = await runSmoke(BASE, { fetchImpl: deploymentWithMethods() })
    const ids = summary.results.map((r: any) => r.id)

    expect(ids).toEqual(
      expect.arrayContaining([
        'static-spa-shell',
        'static-favicon',
        'spa-rewrite-deep-link',
        'api-service-descriptor',
        'api-health-env-wiring',
        'cors-preflight',
        'api-search-x402-challenge',
      ]),
    )
  })

  it('never sends a payment payload, so a run settles nothing', async () => {
    const fetchImpl = deploymentWithMethods()
    await runSmoke(BASE, { fetchImpl })

    for (const [, init] of fetchImpl.mock.calls) {
      const sent = Object.keys((init as any)?.headers ?? {}).map((h) => h.toLowerCase())
      expect(sent).not.toContain('payment-signature')
      expect(sent).not.toContain('x-payment')
      expect(sent).not.toContain('authorization')
    }
  })

  it('encodes queries rather than interpolating them raw', async () => {
    const fetchImpl = deploymentWithMethods()
    await runSmoke(BASE, { fetchImpl })

    const searchCall = fetchImpl.mock.calls.map(([u]) => String(u)).find((u) => u.includes('count=3'))
    expect(searchCall).toContain('q=stellar+lumens')
    expect(searchCall).not.toContain('q=stellar lumens')
  })
})

// ─── Boundary: x402 settlement semantics ─────────────────────────────────────

describe('checkPaymentRequirements — x402 settlement semantics', () => {
  const valid = {
    x402Version: 2,
    accepts: [
      { scheme: 'exact', network: 'stellar:testnet', amount: '10000', asset: USDC_CONTRACT, payTo: PAY_TO, maxTimeoutSeconds: 300 },
    ],
  }

  it('accepts a well-formed testnet challenge', () => {
    expect(checkPaymentRequirements(valid)).toEqual([])
  })

  it('accepts mainnet as well as testnet', () => {
    const mainnet = { ...valid, accepts: [{ ...valid.accepts[0], network: 'stellar:mainnet' }] }
    expect(checkPaymentRequirements(mainnet)).toEqual([])
  })

  it('rejects a decimal dollar amount where stroops are required', () => {
    const bad = { ...valid, accepts: [{ ...valid.accepts[0], amount: '0.001' }] }
    expect(checkPaymentRequirements(bad)).toEqual([expect.stringMatching(/integer stroop string/)])
  })

  it('rejects the classic "USDC:ISSUER" asset regression', () => {
    const bad = { ...valid, accepts: [{ ...valid.accepts[0], asset: `USDC:${PAY_TO}` }] }
    expect(checkPaymentRequirements(bad)).toEqual([expect.stringMatching(/Soroban C\.\.\. contract address/)])
  })

  it('rejects a G... address used as the asset', () => {
    const bad = { ...valid, accepts: [{ ...valid.accepts[0], asset: PAY_TO }] }
    expect(checkPaymentRequirements(bad)).toEqual([expect.stringMatching(/Soroban C\.\.\./)])
  })

  it('rejects a non-Stellar payTo', () => {
    const bad = { ...valid, accepts: [{ ...valid.accepts[0], payTo: '0xdeadbeef' }] }
    expect(checkPaymentRequirements(bad)).toEqual([expect.stringMatching(/payTo must be a Stellar G\.\.\./)])
  })

  it('rejects an unexpected network', () => {
    const bad = { ...valid, accepts: [{ ...valid.accepts[0], network: 'base-sepolia' }] }
    expect(checkPaymentRequirements(bad)).toEqual([expect.stringMatching(/network must be stellar:/)])
  })

  it('rejects a non-exact scheme', () => {
    const bad = { ...valid, accepts: [{ ...valid.accepts[0], scheme: 'upto' }] }
    expect(checkPaymentRequirements(bad)).toEqual([expect.stringMatching(/scheme must be "exact"/)])
  })

  it('rejects a v1 challenge and an empty accepts list', () => {
    expect(checkPaymentRequirements({ ...valid, x402Version: 1 })).toEqual([expect.stringMatching(/x402Version 2/)])
    expect(checkPaymentRequirements({ x402Version: 2, accepts: [] })).toEqual([
      expect.stringMatching(/no `accepts` payment options/),
    ])
  })

  it('rejects a missing or non-positive maxTimeoutSeconds', () => {
    const bad = { ...valid, accepts: [{ ...valid.accepts[0], maxTimeoutSeconds: 0 }] }
    expect(checkPaymentRequirements(bad)).toEqual([expect.stringMatching(/maxTimeoutSeconds/)])
  })
})

describe('decodePaymentRequired', () => {
  it('decodes a base64 challenge header', () => {
    const decoded = decodePaymentRequired(challenge())
    expect(decoded.ok).toBe(true)
    expect(decoded.value.x402Version).toBe(2)
  })

  it('reports a missing header instead of throwing', () => {
    expect(decodePaymentRequired(undefined)).toEqual({ ok: false, error: expect.stringMatching(/missing or empty/) })
    expect(decodePaymentRequired('')).toEqual({ ok: false, error: expect.stringMatching(/missing or empty/) })
  })

  it('reports a header that is not JSON', () => {
    const notJson = Buffer.from('definitely not json').toString('base64')
    expect(decodePaymentRequired(notJson)).toEqual({ ok: false, error: expect.stringMatching(/not valid JSON/) })
  })

  it('reports a header that decodes to a bare scalar', () => {
    const scalar = Buffer.from('42').toString('base64')
    expect(decodePaymentRequired(scalar)).toEqual({ ok: false, error: expect.stringMatching(/did not decode to an object/) })
  })
})

// ─── Failure paths ───────────────────────────────────────────────────────────

describe('smoke suite — failure paths', () => {
  it('fails and names the endpoint when the SPA rewrite is missing', async () => {
    const fetchImpl = deploymentWithMethods({
      '/docs': response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } }),
    })
    const summary = await runSmoke(BASE, { fetchImpl })

    expect(summary.ok).toBe(false)
    const failed = summary.results.find((r: any) => !r.ok)
    expect(failed.id).toBe('spa-rewrite-deep-link')
    expect(failed.path).toBe('/docs')
    expect(failed.url).toBe(`${BASE}/docs`)
    expect(failed.failures.join(' ')).toMatch(/expected HTTP 200, got 404/)
    expect(failed.failures.join(' ')).toMatch(/vercel\.json/)
  })

  it('fails when CORS does not advertise the x402 payment headers', async () => {
    const fetchImpl = deploymentWithMethods({
      'OPTIONS /api/search': response('', {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'Content-Type',
        },
      }),
    })
    const summary = await runSmoke(BASE, { fetchImpl })

    const failed = summary.results.find((r: any) => r.id === 'cors-preflight')
    expect(failed.ok).toBe(false)
    expect(failed.failures.join(' ')).toMatch(/payment-signature/)
    expect(failed.failures.join(' ')).toMatch(/x-payment/)
  })

  it('fails with a config hint when /api/health 500s on missing env vars', async () => {
    const fetchImpl = deploymentWithMethods({
      '/api/health': response('A server error has occurred', { status: 500, headers: { 'content-type': 'text/plain' } }),
    })
    const summary = await runSmoke(BASE, { fetchImpl })

    const failed = summary.results.find((r: any) => r.id === 'api-health-env-wiring')
    expect(failed.ok).toBe(false)
    expect(failed.status).toBe(500)
    expect(failed.failures.join(' ')).toMatch(/STELLAR_RECEIVING_ADDRESS/)
    expect(failed.bodySnippet).toBe('A server error has occurred')
  })

  it('fails when validation is bypassed and a 402 challenge is issued for a bad count', async () => {
    const fetchImpl = deploymentWithMethods({
      '/api/search?q=stellar+lumens&count=999': response('{}', {
        status: 402,
        headers: { 'payment-required': challenge() },
      }),
    })
    const summary = await runSmoke(BASE, { fetchImpl })

    const failed = summary.results.find((r: any) => r.id === 'api-search-count-out-of-bounds')
    expect(failed.ok).toBe(false)
    expect(failed.status).toBe(402)
    expect(failed.failures.join(' ')).toMatch(/expected HTTP 400, got 402/)
  })

  it('fails when the x402 challenge carries the wrong asset format', async () => {
    const fetchImpl = deploymentWithMethods({
      '/api/search?q=stellar+lumens&count=3': response('{}', {
        status: 402,
        headers: {
          'payment-required': challenge({ asset: `USDC:${PAY_TO}` }),
          'access-control-expose-headers': 'PAYMENT-REQUIRED',
        },
      }),
    })
    const summary = await runSmoke(BASE, { fetchImpl })

    const failed = summary.results.find((r: any) => r.id === 'api-search-x402-challenge')
    expect(failed.ok).toBe(false)
    expect(failed.failures.join(' ')).toMatch(/Soroban C\.\.\. contract address/)
  })

  it('fails when the challenge header is not exposed to browser clients', async () => {
    const fetchImpl = deploymentWithMethods({
      '/api/search?q=stellar+lumens&count=3': response('{}', {
        status: 402,
        headers: { 'payment-required': challenge() },
      }),
    })
    const summary = await runSmoke(BASE, { fetchImpl })

    const failed = summary.results.find((r: any) => r.id === 'api-search-x402-challenge')
    expect(failed.ok).toBe(false)
    expect(failed.failures.join(' ')).toMatch(/Access-Control-Expose-Headers/)
  })

  it('records a transport failure as a failed check rather than throwing', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND stellar-search-preview.vercel.app')
    })
    const summary = await runSmoke(BASE, { fetchImpl })

    expect(summary.ok).toBe(false)
    expect(summary.failed).toBe(CHECKS.length)
    expect(summary.results[0].status).toBeNull()
    expect(summary.results[0].failures[0]).toMatch(/request failed: getaddrinfo ENOTFOUND/)
  })

  it('keeps a response artifact for every failed check', async () => {
    const fetchImpl = deploymentWithMethods({
      '/api': response('<html>502 Bad Gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }),
    })
    const summary = await runSmoke(BASE, { fetchImpl })

    const failed = summary.results.find((r: any) => r.id === 'api-service-descriptor')
    expect(failed.bodySnippet).toContain('502 Bad Gateway')
    expect(failed.headers['content-type']).toBe('text/html')
    expect(failed.expectedStatus).toEqual([200])
  })

  it('truncates an oversized body in the artifact', async () => {
    const fetchImpl = deploymentWithMethods({
      '/api': response('x'.repeat(5000), { status: 500, headers: { 'content-type': 'text/plain' } }),
    })
    const summary = await runSmoke(BASE, { fetchImpl })

    const failed = summary.results.find((r: any) => r.id === 'api-service-descriptor')
    expect(failed.bodySnippet.length).toBeLessThan(5000)
    expect(failed.bodySnippet).toMatch(/… \[truncated\]$/)
  })

  it('never captures sensitive response headers into an artifact', async () => {
    const fetchImpl = deploymentWithMethods({
      '/api': response('{}', {
        status: 500,
        headers: { 'content-type': 'application/json', authorization: 'Bearer super-secret', 'set-cookie': 'sid=abc' },
      }),
    })
    const summary = await runSmoke(BASE, { fetchImpl })

    const failed = summary.results.find((r: any) => r.id === 'api-service-descriptor')
    expect(Object.keys(failed.headers)).not.toContain('authorization')
    expect(Object.keys(failed.headers)).not.toContain('set-cookie')
    expect(JSON.stringify(failed)).not.toContain('super-secret')
  })
})

// ─── Invalid input & unsupported environments ────────────────────────────────

describe('normalizeBaseUrl', () => {
  it('accepts a full https URL and strips a trailing slash', () => {
    expect(normalizeBaseUrl(`${BASE}/`)).toBe(BASE)
    expect(normalizeBaseUrl(BASE)).toBe(BASE)
  })

  it('assumes https for a bare host, as Vercel deployment URLs are given', () => {
    expect(normalizeBaseUrl('stellar-search-preview.vercel.app')).toBe(BASE)
  })

  it('allows http for a local preview', () => {
    expect(normalizeBaseUrl('http://localhost:3001')).toBe('http://localhost:3001')
  })

  it('rejects a missing, blank, or non-string URL', () => {
    expect(() => normalizeBaseUrl(undefined)).toThrow(/deployment URL is required/)
    expect(() => normalizeBaseUrl('   ')).toThrow(/deployment URL is required/)
  })

  it('rejects a non-http(s) scheme', () => {
    expect(() => normalizeBaseUrl('ftp://example.com')).toThrow(/must be http\(s\)/)
  })
})

describe('parseArgs', () => {
  it('parses the URL with both artifact options', () => {
    expect(parseArgs([BASE, '--json', 'out/s.json', '--markdown', 'out/s.md'])).toEqual({
      baseUrl: BASE,
      options: { json: 'out/s.json', markdown: 'out/s.md' },
    })
  })

  it('rejects an option with no value and an unknown option', () => {
    expect(() => parseArgs([BASE, '--json'])).toThrow(/requires a file path/)
    expect(() => parseArgs([BASE, '--json', '--markdown'])).toThrow(/requires a file path/)
    expect(() => parseArgs([BASE, '--verbose'])).toThrow(/Unknown option/)
  })
})

// ─── Reporting ───────────────────────────────────────────────────────────────

describe('formatMarkdown', () => {
  it('reports success with a full check table', async () => {
    const summary = await runSmoke(BASE, { fetchImpl: deploymentWithMethods() })
    const md = formatMarkdown(summary)

    expect(md).toContain('## Preview smoke ✅ passed')
    expect(md).toContain(BASE)
    expect(md).not.toContain('### Failed endpoints')
    expect(md).toContain('| ✅ |')
  })

  it('names the exact failed endpoint and embeds its response artifact', async () => {
    const fetchImpl = deploymentWithMethods({
      '/api/health': response('{"boom":true}', { status: 503, headers: { 'content-type': 'application/json' } }),
    })
    const md = formatMarkdown(await runSmoke(BASE, { fetchImpl }))

    expect(md).toContain('## Preview smoke ❌ failed')
    expect(md).toContain('### Failed endpoints')
    expect(md).toContain('`GET /api/health`')
    expect(md).toContain(`${BASE}/api/health`)
    expect(md).toContain('**Status:** 503 (expected 200)')
    expect(md).toContain('<details><summary>Response artifact</summary>')
    expect(md).toContain('{\\"boom\\":true}')
  })

  it('renders "no response" for an unreachable deployment', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED')
    })
    const md = formatMarkdown(await runSmoke(BASE, { fetchImpl }))

    expect(md).toContain('**Status:** no response')
    expect(md).toContain('connect ECONNREFUSED')
  })
})

// ─── Single-check contract ───────────────────────────────────────────────────

describe('runCheck', () => {
  it('resolves a function path and reports both status and body failures', async () => {
    const check = CHECKS.find((c: any) => c.id === 'api-search-missing-q')
    const fetchImpl = vi.fn(async () =>
      response(JSON.stringify({ error: 'Payment required' }), { status: 402, headers: { 'content-type': 'application/json' } }),
    )
    const result = await runCheck(check, BASE, fetchImpl)

    expect(result.ok).toBe(false)
    expect(result.failures).toHaveLength(2)
    expect(result.failures[0]).toMatch(/expected HTTP 400, got 402/)
    expect(result.failures[1]).toMatch(/Missing required parameter: q/)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('sends the smoke user agent and does not follow redirects', async () => {
    const check = CHECKS.find((c: any) => c.id === 'static-spa-shell')
    const fetchImpl = vi.fn(async () => response(SPA_SHELL, { headers: { 'content-type': 'text/html' } }))
    await runCheck(check, BASE, fetchImpl)

    const [, init] = fetchImpl.mock.calls[0]
    expect((init as any).headers['User-Agent']).toBe('stellar-search-smoke/1')
    expect((init as any).redirect).toBe('manual')
  })
})

// ─── Health statistics declaration (#226) ────────────────────────────────────

describe('checkStatsDeclaration — health must say what it measures', () => {
  const CONFIG = { status: 'ok', network: 'stellar:testnet', protocol: 'x402' }
  const COUNTERS = { totalQueries: 3, totalUsdcSettled: '0.0030', avgLatencyMs: 210, uptime: '4m' }
  const FIELDS = ['totalQueries', 'totalUsdcSettled', 'avgLatencyMs', 'uptime']

  it('accepts an Express deployment that measures and reports everything', () => {
    expect(checkStatsDeclaration({ ...CONFIG, ...COUNTERS, statsSupported: true, unsupportedFields: [] })).toEqual([])
  })

  it('accepts a serverless deployment that declares the gap with a reason', () => {
    expect(
      checkStatsDeclaration({
        ...CONFIG,
        statsSupported: false,
        unsupportedFields: FIELDS,
        statsUnavailableReason: 'Serverless functions are stateless.',
      }),
    ).toEqual([])
  })

  it('rejects the original bug: counters silently omitted with no declaration', () => {
    expect(checkStatsDeclaration({ ...CONFIG })).toEqual([
      expect.stringMatching(/must declare `statsSupported`/),
    ])
  })

  it('rejects a runtime that claims to measure but omits the values', () => {
    const failures = checkStatsDeclaration({ ...CONFIG, statsSupported: true, unsupportedFields: [] })
    expect(failures).toHaveLength(FIELDS.length)
    for (const field of FIELDS) {
      expect(failures.join(' ')).toContain(field)
    }
  })

  it('rejects an unsupported declaration with no explanation', () => {
    expect(
      checkStatsDeclaration({ ...CONFIG, statsSupported: false, unsupportedFields: FIELDS }),
    ).toEqual([expect.stringMatching(/no statsUnavailableReason/)])
  })

  it('rejects a stale value left behind on a field declared unsupported', () => {
    const failures = checkStatsDeclaration({
      ...CONFIG,
      totalQueries: 0,
      statsSupported: false,
      unsupportedFields: FIELDS,
      statsUnavailableReason: 'Stateless.',
    })
    expect(failures).toEqual([expect.stringMatching(/`totalQueries` is declared unsupported but a value was still reported/)])
  })

  it('rejects contradictory declarations and malformed field lists', () => {
    expect(
      checkStatsDeclaration({ ...CONFIG, ...COUNTERS, statsSupported: true, unsupportedFields: ['uptime'] }),
    ).toEqual([expect.stringMatching(/statsSupported is true but unsupportedFields is not empty/)])

    expect(checkStatsDeclaration({ ...CONFIG, statsSupported: false, unsupportedFields: 'uptime' })).toEqual([
      expect.stringMatching(/must declare `unsupportedFields` as an array/),
    ])
  })
})

describe('smoke suite — health declaration failures', () => {
  it('fails the health check when a deployment omits counters without declaring them', async () => {
    const fetchImpl = deploymentWithMethods({
      '/api/health': response(
        JSON.stringify({
          status: 'ok',
          network: 'stellar:testnet',
          protocol: 'x402',
          receivingAddressConfigured: true,
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    })
    const summary = await runSmoke(BASE, { fetchImpl })

    const failed = summary.results.find((r: any) => r.id === 'api-health-env-wiring')
    expect(failed.ok).toBe(false)
    expect(failed.status).toBe(200)
    expect(failed.failures.join(' ')).toMatch(/must declare `statsSupported`/)
    expect(failed.failures.join(' ')).toMatch(/real zero/)
  })
})
