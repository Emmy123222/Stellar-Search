import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { load } from 'js-yaml'

const specPath = resolve(__dirname, '../openapi.yaml')
const spec = load(readFileSync(specPath, 'utf8')) as any

describe('openapi.yaml', () => {
  it('parses as valid YAML with a 3.0.x openapi version', () => {
    expect(spec.openapi).toMatch(/^3\.0\./)
  })

  it('documents every public HTTP endpoint (search, images, news, chat, health)', () => {
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining(['/search', '/images', '/news', '/ai/chat', '/health'])
    )
  })

  for (const [path, method] of [
    ['/search', 'get'],
    ['/images', 'get'],
    ['/news', 'get'],
  ] as const) {
    it(`${method.toUpperCase()} ${path} documents 200 and 402 responses with x402 security`, () => {
      const op = spec.paths[path][method]
      expect(op.responses['200']).toBeDefined()
      expect(op.responses['402']).toBeDefined()
      expect(op.responses['200'].content['application/json'].example).toBeDefined()
      expect(op.security).toEqual([{ x402Payment: [] }])
    })
  }

  it('POST /ai/chat and GET /health require no payment (public routes)', () => {
    expect(spec.paths['/ai/chat'].post.security).toEqual([])
    expect(spec.paths['/health'].get.security).toEqual([])
  })

  it('defines the x402Payment security scheme referenced by paid routes', () => {
    expect(spec.components.securitySchemes.x402Payment).toMatchObject({
      type: 'apiKey',
      in: 'header',
      name: 'X-PAYMENT',
    })
  })
})
