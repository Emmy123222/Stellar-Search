import { describe, it, expect, vi, beforeAll } from 'vitest'
import express, { Request, Response } from 'express'
import request from 'supertest'
import zlib from 'node:zlib'
import {
  isCompressibleMimeType,
  negotiateEncoding,
  compressPayload,
  appendVaryHeader,
  compressionMiddleware,
} from './compression.js'
import { applyServerlessHeaders } from './serverlessHeaders.js'

describe('Response Compression (#330) — Unit & Integration Suite', () => {
  describe('MIME type classification (isCompressibleMimeType)', () => {
    it('identifies compressible text and structured data formats', () => {
      expect(isCompressibleMimeType('application/json')).toBe(true)
      expect(isCompressibleMimeType('application/json; charset=utf-8')).toBe(true)
      expect(isCompressibleMimeType('application/ld+json')).toBe(true)
      expect(isCompressibleMimeType('application/geo+json')).toBe(true)
      expect(isCompressibleMimeType('application/javascript')).toBe(true)
      expect(isCompressibleMimeType('text/html')).toBe(true)
      expect(isCompressibleMimeType('text/plain')).toBe(true)
      expect(isCompressibleMimeType('text/css')).toBe(true)
      expect(isCompressibleMimeType('text/csv')).toBe(true)
      expect(isCompressibleMimeType('application/xml')).toBe(true)
      expect(isCompressibleMimeType('image/svg+xml')).toBe(true) // SVG is compressible XML
    })

    it('strictly excludes SSE (text/event-stream) and streaming NDJSON', () => {
      expect(isCompressibleMimeType('text/event-stream')).toBe(false)
      expect(isCompressibleMimeType('text/event-stream; charset=utf-8')).toBe(false)
      expect(isCompressibleMimeType('application/x-ndjson')).toBe(false)
    })

    it('excludes binary and already-compressed formats', () => {
      expect(isCompressibleMimeType('image/jpeg')).toBe(false)
      expect(isCompressibleMimeType('image/png')).toBe(false)
      expect(isCompressibleMimeType('image/webp')).toBe(false)
      expect(isCompressibleMimeType('video/mp4')).toBe(false)
      expect(isCompressibleMimeType('audio/mpeg')).toBe(false)
      expect(isCompressibleMimeType('application/zip')).toBe(false)
      expect(isCompressibleMimeType('application/gzip')).toBe(false)
      expect(isCompressibleMimeType('application/pdf')).toBe(false)
      expect(isCompressibleMimeType('application/octet-stream')).toBe(false)
      expect(isCompressibleMimeType('font/woff2')).toBe(false)
    })

    it('handles null, undefined, or empty gracefully', () => {
      expect(isCompressibleMimeType(null)).toBe(false)
      expect(isCompressibleMimeType(undefined)).toBe(false)
      expect(isCompressibleMimeType('')).toBe(false)
    })
  })

  describe('Encoding negotiation (negotiateEncoding)', () => {
    it('prioritizes Brotli (br) over gzip and deflate when equally weighted', () => {
      expect(negotiateEncoding('gzip, deflate, br')).toBe('br')
      expect(negotiateEncoding('br, gzip')).toBe('br')
      expect(negotiateEncoding('*')).toBe('br')
    })

    it('selects gzip when Brotli is not accepted', () => {
      expect(negotiateEncoding('gzip, deflate')).toBe('gzip')
      expect(negotiateEncoding('gzip')).toBe('gzip')
    })

    it('selects deflate when only deflate is accepted', () => {
      expect(negotiateEncoding('deflate')).toBe('deflate')
    })

    it('respects q-values (quality weights)', () => {
      expect(negotiateEncoding('br;q=0.5, gzip;q=0.9')).toBe('gzip')
      expect(negotiateEncoding('gzip;q=0.2, br;q=0.8')).toBe('br')
      expect(negotiateEncoding('br;q=0, gzip;q=1.0')).toBe('gzip')
      expect(negotiateEncoding('br;q=0, gzip;q=0')).toBe(null)
    })

    it('returns null when no supported encodings are requested', () => {
      expect(negotiateEncoding('identity')).toBe(null)
      expect(negotiateEncoding('compress')).toBe(null)
      expect(negotiateEncoding('')).toBe(null)
      expect(negotiateEncoding(undefined)).toBe(null)
      expect(negotiateEncoding(null)).toBe(null)
    })
  })

  describe('Buffer compression (compressPayload)', () => {
    const rawData = Buffer.from('StellarSearch paid search payload '.repeat(50)) // ~1.7 KB

    it('compresses and decompresses with Brotli', () => {
      const compressed = compressPayload(rawData, 'br')
      expect(compressed.length).toBeLessThan(rawData.length)
      const decompressed = zlib.brotliDecompressSync(compressed)
      expect(decompressed.equals(rawData)).toBe(true)
    })

    it('compresses and decompresses with Gzip', () => {
      const compressed = compressPayload(rawData, 'gzip')
      expect(compressed.length).toBeLessThan(rawData.length)
      const decompressed = zlib.gunzipSync(compressed)
      expect(decompressed.equals(rawData)).toBe(true)
    })

    it('compresses and decompresses with Deflate', () => {
      const compressed = compressPayload(rawData, 'deflate')
      expect(compressed.length).toBeLessThan(rawData.length)
      const decompressed = zlib.inflateSync(compressed)
      expect(decompressed.equals(rawData)).toBe(true)
    })
  })

  describe('Vary header helper (appendVaryHeader)', () => {
    it('sets Vary if not previously present', () => {
      const headers: Record<string, string> = {}
      const mockRes = {
        getHeader: (k: string) => headers[k.toLowerCase()],
        setHeader: (k: string, v: string) => { headers[k.toLowerCase()] = v },
      }
      appendVaryHeader(mockRes, 'Accept-Encoding')
      expect(headers['vary']).toBe('Accept-Encoding')
    })

    it('appends to existing Vary header without duplicating', () => {
      const headers: Record<string, string> = { vary: 'Origin' }
      const mockRes = {
        getHeader: (k: string) => headers[k.toLowerCase()],
        setHeader: (k: string, v: string) => { headers[k.toLowerCase()] = v },
      }
      appendVaryHeader(mockRes, 'Accept-Encoding')
      expect(headers['vary']).toBe('Origin, Accept-Encoding')

      // Calling again should not duplicate
      appendVaryHeader(mockRes, 'Accept-Encoding')
      expect(headers['vary']).toBe('Origin, Accept-Encoding')
    })
  })

  describe('Express compression middleware integration', () => {
    let app: express.Express

    const smallPayload = { query: 'small', count: 1 } // < 100 bytes
    const largeSearchResults = {
      query: 'stellar blockchain research query with detailed snippets',
      count: 10,
      network: 'stellar:testnet',
      results: Array.from({ length: 15 }, (_, i) => ({
        id: `result-${i}`,
        title: `Comprehensive Result Title ${i} for Stellar Ecosystem`,
        url: `https://stellar.org/research/article-${i}`,
        snippet: `In-depth research snippet explaining payment channel settlement, Soroban smart contract gas metering, and x402 facilitator routing for transaction ${i}.`,
      })),
    }

    beforeAll(() => {
      app = express()
      app.use(compressionMiddleware({ threshold: 512 }))

      app.get('/small', (_req: Request, res: Response) => {
        res.json(smallPayload)
      })

      app.get('/large', (_req: Request, res: Response) => {
        res.setHeader('X-Payment-Response', 'mock-settlement-payload-200')
        res.json(largeSearchResults)
      })

      app.get('/no-transform', (_req: Request, res: Response) => {
        res.setHeader('Cache-Control', 'no-cache, no-transform')
        res.json(largeSearchResults)
      })

      app.get('/already-compressed', (_req: Request, res: Response) => {
        const jsonStr = JSON.stringify(largeSearchResults)
        const gzipped = zlib.gzipSync(Buffer.from(jsonStr))
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Content-Encoding', 'gzip')
        res.end(gzipped)
      })

      app.get('/sse', (_req: Request, res: Response) => {
        res.setHeader('Content-Type', 'text/event-stream')
        res.setHeader('Cache-Control', 'no-cache, no-transform')
        res.setHeader('Connection', 'keep-alive')
        res.write('event: delta\ndata: {"content":"chunk 1"}\n\n')
        res.write('event: delta\ndata: {"content":"chunk 2"}\n\n')
        res.write('event: done\ndata: {}\n\n')
        res.end()
      })

      app.get('/empty-204', (_req: Request, res: Response) => {
        res.status(204).end()
      })

      app.get('/empty-304', (_req: Request, res: Response) => {
        res.status(304).end()
      })

      app.get('/x402-challenge', (_req: Request, res: Response) => {
        res.setHeader('PAYMENT-REQUIRED', 'eyAieDQwMlZlcnNpb24iOiAyIH0=')
        res.status(402).json({
          error: 'Payment required',
          x402Version: 2,
          amount: '0.001 USDC',
        })
      })
    })

    it('compresses large payloads with Brotli when Accept-Encoding includes br', async () => {
      const res = await request(app)
        .get('/large')
        .set('Accept-Encoding', 'gzip, deflate, br')

      expect(res.status).toBe(200)
      expect(res.headers['content-encoding']).toBe('br')
      expect(res.headers['vary']).toContain('Accept-Encoding')
      expect(res.headers['x-payment-response']).toBe('mock-settlement-payload-200')
      expect(res.body.count).toBe(10)
      expect(res.body.results).toHaveLength(15)
    })

    it('compresses large payloads with Gzip when Accept-Encoding only allows gzip', async () => {
      const res = await request(app)
        .get('/large')
        .set('Accept-Encoding', 'gzip')

      expect(res.status).toBe(200)
      expect(res.headers['content-encoding']).toBe('gzip')
      expect(res.headers['vary']).toContain('Accept-Encoding')
      expect(res.headers['x-payment-response']).toBe('mock-settlement-payload-200')
      expect(res.body.count).toBe(10)
    })

    it('leaves payloads below threshold uncompressed but sets Vary: Accept-Encoding', async () => {
      const res = await request(app)
        .get('/small')
        .set('Accept-Encoding', 'gzip, deflate, br')

      expect(res.status).toBe(200)
      expect(res.headers['content-encoding']).toBeUndefined()
      expect(res.headers['vary']).toContain('Accept-Encoding')
      expect(res.body).toEqual(smallPayload)
    })

    it('leaves large payloads uncompressed when client sends no Accept-Encoding', async () => {
      const res = await request(app)
        .get('/large')
        .set('Accept-Encoding', '')

      expect(res.status).toBe(200)
      expect(res.headers['content-encoding']).toBeUndefined()
      expect(res.headers['vary']).toContain('Accept-Encoding')
      expect(res.body.count).toBe(10)
    })

    it('bypasses compression when x-no-compression: 1 is sent', async () => {
      const res = await request(app)
        .get('/large')
        .set('Accept-Encoding', 'br')
        .set('x-no-compression', '1')

      expect(res.status).toBe(200)
      expect(res.headers['content-encoding']).toBeUndefined()
      expect(res.body.count).toBe(10)
    })

    it('bypasses compression when Cache-Control contains no-transform', async () => {
      const res = await request(app)
        .get('/no-transform')
        .set('Accept-Encoding', 'br')

      expect(res.status).toBe(200)
      expect(res.headers['content-encoding']).toBeUndefined()
      expect(res.body.count).toBe(10)
    })

    it('does not re-compress already-compressed responses', async () => {
      const res = await request(app)
        .get('/already-compressed')
        .set('Accept-Encoding', 'gzip')

      expect(res.status).toBe(200)
      expect(res.headers['content-encoding']).toBe('gzip')
      expect(res.body.count).toBe(10)
    })

    it('streams SSE (text/event-stream) immediately unbuffered and uncompressed', async () => {
      const res = await request(app)
        .get('/sse')
        .set('Accept-Encoding', 'gzip, deflate, br')

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toContain('text/event-stream')
      expect(res.headers['content-encoding']).toBeUndefined()
      expect(res.text).toContain('event: delta')
      expect(res.text).toContain('chunk 1')
      expect(res.text).toContain('event: done')
    })

    it('leaves 204 No Content without body or Content-Encoding', async () => {
      const res = await request(app)
        .get('/empty-204')
        .set('Accept-Encoding', 'gzip, deflate, br')

      expect(res.status).toBe(204)
      expect(res.headers['content-encoding']).toBeUndefined()
      expect(res.text).toBe('')
    })

    it('leaves 304 Not Modified without Content-Encoding', async () => {
      const res = await request(app)
        .get('/empty-304')
        .set('Accept-Encoding', 'gzip, deflate, br')

      expect(res.status).toBe(304)
      expect(res.headers['content-encoding']).toBeUndefined()
    })

    it('preserves x402 PAYMENT-REQUIRED headers on 402 challenge responses', async () => {
      const res = await request(app)
        .get('/x402-challenge')
        .set('Accept-Encoding', 'gzip, deflate, br')

      expect(res.status).toBe(402)
      expect(res.headers['payment-required']).toBe('eyAieDQwMlZlcnNpb24iOiAyIH0=')
      expect(res.body.error).toBe('Payment required')
    })

    it('handles HEAD requests without returning a body', async () => {
      const res = await request(app)
        .head('/large')
        .set('Accept-Encoding', 'br')

      expect(res.status).toBe(200)
      expect(res.headers['content-encoding']).toBeUndefined()
      expect(res.text).toBeUndefined()
    })
  })

  describe('Vercel serverless compression adapter (attachServerlessCompression / applyServerlessHeaders)', () => {
    it('sets Vary: Accept-Encoding in applyServerlessHeaders', () => {
      const headers: Record<string, string> = {}
      const mockRes: any = {
        setHeader: vi.fn((k: string, v: string) => {
          headers[k.toLowerCase()] = v
        }),
        getHeader: (k: string) => headers[k.toLowerCase()],
      }

      applyServerlessHeaders(mockRes)
      expect(headers['x-content-type-options']).toBe('nosniff')
      expect(headers['vary']).toBe('Accept-Encoding')
    })

    it('compresses JSON payload in serverless res.json when Accept-Encoding is negotiated', () => {
      const headers: Record<string, string> = {}
      let sentBody: any = null

      const mockReq: any = {
        headers: { 'accept-encoding': 'gzip' },
        method: 'POST',
      }
      const mockRes: any = {
        setHeader: vi.fn((k: string, v: string) => {
          headers[k.toLowerCase()] = v
        }),
        getHeader: (k: string) => headers[k.toLowerCase()],
        send: vi.fn((buf: any) => {
          sentBody = buf
          return mockRes
        }),
        json: vi.fn(),
      }

      applyServerlessHeaders(mockRes, mockReq)

      const largeData = {
        title: 'Large Serverless AI Completion',
        content: 'StellarSearch AI Assistant research answer payload. '.repeat(40), // > 1 KB
      }

      mockRes.json(largeData)

      expect(headers['content-encoding']).toBe('gzip')
      expect(headers['content-type']).toContain('application/json')
      expect(Buffer.isBuffer(sentBody)).toBe(true)

      const decompressed = JSON.parse(zlib.gunzipSync(sentBody).toString('utf8'))
      expect(decompressed.title).toBe('Large Serverless AI Completion')
    })

    it('leaves small serverless JSON payload uncompressed', () => {
      const headers: Record<string, string> = {}
      const mockReq: any = {
        headers: { 'accept-encoding': 'gzip' },
        method: 'POST',
      }
      const mockRes: any = {
        setHeader: vi.fn((k: string, v: string) => {
          headers[k.toLowerCase()] = v
        }),
        getHeader: (k: string) => headers[k.toLowerCase()],
        json: vi.fn().mockImplementation((d: any) => {
          mockRes._data = d
        }),
      }

      applyServerlessHeaders(mockRes, mockReq)
      mockRes.json({ small: true })

      expect(headers['content-encoding']).toBeUndefined()
      expect(mockRes._data).toEqual({ small: true })
    })

    it('bypasses compression when x-no-compression is present in serverless request', () => {
      const headers: Record<string, string> = {}
      const mockReq: any = {
        headers: {
          'accept-encoding': 'gzip',
          'x-no-compression': '1',
        },
        method: 'POST',
      }
      const mockRes: any = {
        setHeader: vi.fn((k: string, v: string) => {
          headers[k.toLowerCase()] = v
        }),
        getHeader: (k: string) => headers[k.toLowerCase()],
        json: vi.fn().mockImplementation((d: any) => {
          mockRes._data = d
        }),
      }

      applyServerlessHeaders(mockRes, mockReq)
      mockRes.json({ large: 'x'.repeat(2000) })

      expect(headers['content-encoding']).toBeUndefined()
      expect(mockRes._data).toBeDefined()
    })
  })
})
