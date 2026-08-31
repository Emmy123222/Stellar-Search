import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('vercel.json — Deployment manifest, rewrites, and security headers', () => {
  const vercelJsonPath = path.resolve(__dirname, '../vercel.json')
  let config: any

  it('vercel.json exists and is valid JSON', () => {
    expect(fs.existsSync(vercelJsonPath)).toBe(true)
    const raw = fs.readFileSync(vercelJsonPath, 'utf8')
    config = JSON.parse(raw)
    expect(config).toBeDefined()
    expect(config.framework).toBe('vite')
    expect(config.buildCommand).toBe('npm run build')
    expect(config.outputDirectory).toBe('dist')
  })

  it('defines SPA fallback rewrite that does not shadow /api routes', () => {
    expect(Array.isArray(config.rewrites)).toBe(true)
    const spaRewrite = config.rewrites.find((r: any) => r.destination === '/index.html')
    expect(spaRewrite).toBeDefined()

    // Test rewrite regex behavior
    const rewriteRegex = new RegExp(`^${spaRewrite.source}$`)

    // Should rewrite SPA frontend routes to index.html
    expect(rewriteRegex.test('/')).toBe(true)
    expect(rewriteRegex.test('/docs')).toBe(true)
    expect(rewriteRegex.test('/dashboard')).toBe(true)
    expect(rewriteRegex.test('/search')).toBe(true)
    expect(rewriteRegex.test('/about')).toBe(true)

    // Should NOT rewrite /api endpoints (serverless functions take over)
    expect(rewriteRegex.test('/api')).toBe(false)
    expect(rewriteRegex.test('/api/')).toBe(false)
    expect(rewriteRegex.test('/api/search')).toBe(false)
    expect(rewriteRegex.test('/api/health')).toBe(false)
    expect(rewriteRegex.test('/api/ai/chat')).toBe(false)
  })

  it('configures explicit global security headers', () => {
    expect(Array.isArray(config.headers)).toBe(true)
    const globalHeaderGroup = config.headers.find((h: any) => h.source === '/(.*)')
    expect(globalHeaderGroup).toBeDefined()

    const headersMap = Object.fromEntries(
      globalHeaderGroup.headers.map((h: any) => [h.key, h.value])
    )

    expect(headersMap['X-Content-Type-Options']).toBe('nosniff')
    expect(headersMap['X-Frame-Options']).toBe('DENY')
    expect(headersMap['X-XSS-Protection']).toBe('1; mode=block')
    expect(headersMap['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(headersMap['Permissions-Policy']).toBe('camera=(), microphone=(), geolocation=()')
    expect(headersMap['Strict-Transport-Security']).toContain('max-age=31536000')
    expect(headersMap['Content-Security-Policy']).toContain("default-src 'self'")
    expect(headersMap['Content-Security-Policy']).toContain('https://horizon-testnet.stellar.org')
    expect(headersMap['Content-Security-Policy']).toContain('https://www.x402.org')
  })

  it('configures immutable cache headers for static assets', () => {
    const assetHeaderGroup = config.headers.find((h: any) => h.source === '/assets/(.*)')
    expect(assetHeaderGroup).toBeDefined()

    const headersMap = Object.fromEntries(
      assetHeaderGroup.headers.map((h: any) => [h.key, h.value])
    )
    expect(headersMap['Cache-Control']).toContain('immutable')
    expect(headersMap['Cache-Control']).toContain('max-age=31536000')
  })

  it('configures no-cache and CORS security headers for /api routes (preserving x402 settlement semantics)', () => {
    const apiHeaderGroup = config.headers.find((h: any) => h.source === '/api/(.*)')
    expect(apiHeaderGroup).toBeDefined()

    const headersMap = Object.fromEntries(
      apiHeaderGroup.headers.map((h: any) => [h.key, h.value])
    )

    expect(headersMap['Cache-Control']).toContain('no-store')
    expect(headersMap['Access-Control-Allow-Origin']).toBe('*')
    expect(headersMap['Access-Control-Allow-Methods']).toContain('GET')
    expect(headersMap['Access-Control-Allow-Methods']).toContain('POST')
    expect(headersMap['Access-Control-Allow-Methods']).toContain('OPTIONS')
    expect(headersMap['Access-Control-Allow-Headers']).toContain('X-Payment')
    expect(headersMap['Access-Control-Allow-Headers']).toContain('payment-signature')
    expect(headersMap['Access-Control-Expose-Headers']).toContain('PAYMENT-REQUIRED')
    expect(headersMap['Access-Control-Expose-Headers']).toContain('X-Payment-Response')
  })
})
