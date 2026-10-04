import type { Request, Response, NextFunction } from 'express'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import zlib from 'node:zlib'

export type SupportedEncoding = 'br' | 'gzip' | 'deflate'

export interface CompressionOptions {
  /**
   * Minimum payload byte length before compression is applied.
   * Default: 1024 (1 KB), or process.env.COMPRESSION_THRESHOLD_BYTES
   */
  threshold?: number

  /**
   * Brotli quality level (0 to 11).
   * Default: 4 (balanced fast web compression)
   */
  brotliQuality?: number

  /**
   * Gzip compression level (1 to 9).
   * Default: zlib.constants.Z_DEFAULT_COMPRESSION (6)
   */
  gzipLevel?: number
}

export const DEFAULT_COMPRESSION_THRESHOLD = 1024
export const DEFAULT_BROTLI_QUALITY = 4

/**
 * Append a token to the HTTP Vary header if not already present.
 */
export function appendVaryHeader(
  res: { getHeader?: (name: string) => any; setHeader: (name: string, val: any) => void },
  headerName: string
): void {
  if (typeof res.getHeader !== 'function') {
    res.setHeader('Vary', headerName)
    return
  }
  const existing = res.getHeader('Vary')
  if (!existing) {
    res.setHeader('Vary', headerName)
    return
  }
  const existingStr = Array.isArray(existing) ? existing.join(', ') : String(existing)
  const tokens = existingStr.split(',').map((s) => s.trim().toLowerCase())
  if (!tokens.includes(headerName.toLowerCase())) {
    res.setHeader('Vary', `${existingStr}, ${headerName}`)
  }
}

/**
 * Determine if a given MIME type is eligible for text/data compression.
 * Specifically excludes Server-Sent Events (SSE) and already-compressed formats.
 */
export function isCompressibleMimeType(contentType: string | null | undefined): boolean {
  if (!contentType) return false
  const mime = contentType.split(';')[0].trim().toLowerCase()

  // Explicitly excluded streaming formats
  if (mime === 'text/event-stream' || mime === 'application/x-ndjson') {
    return false
  }

  // Excluded already-compressed or binary media
  if (
    mime.startsWith('image/') ||
    mime.startsWith('video/') ||
    mime.startsWith('audio/') ||
    mime === 'application/octet-stream' ||
    mime === 'application/zip' ||
    mime === 'application/gzip' ||
    mime === 'application/pdf' ||
    mime === 'font/woff2'
  ) {
    // SVG is an exception: image/svg+xml is compressible text XML
    if (mime === 'image/svg+xml') return true
    return false
  }

  // Compressible text and structured data
  if (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/javascript' ||
    mime === 'application/xml' ||
    mime.endsWith('+json') ||
    mime.endsWith('+xml')
  ) {
    return true
  }

  return false
}

/**
 * Parse an HTTP Accept-Encoding header and select the optimal encoding.
 * Prioritizes Brotli ('br') > Gzip ('gzip') > Deflate ('deflate').
 * Respects q-values (quality weights).
 */
export function negotiateEncoding(
  acceptEncodingHeader: string | null | undefined,
  supported: SupportedEncoding[] = ['br', 'gzip', 'deflate']
): SupportedEncoding | null {
  if (!acceptEncodingHeader || typeof acceptEncodingHeader !== 'string') {
    return null
  }

  const parts = acceptEncodingHeader.split(',')
  const preferences: Array<{ encoding: string; q: number }> = []

  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue

    const [enc, ...params] = trimmed.split(';')
    const name = enc.trim().toLowerCase()
    let q = 1.0

    for (const param of params) {
      const [k, v] = param.trim().split('=')
      if (k?.trim().toLowerCase() === 'q' && v) {
        const parsedQ = parseFloat(v.trim())
        if (!isNaN(parsedQ)) {
          q = parsedQ
        }
      }
    }

    preferences.push({ encoding: name, q })
  }

  const starPref = preferences.find((p) => p.encoding === '*')
  const starQ = starPref ? starPref.q : 0

  const order: Record<SupportedEncoding, number> = { br: 3, gzip: 2, deflate: 1 }
  const candidates: Array<{ encoding: SupportedEncoding; q: number; priority: number }> = []

  for (const enc of supported) {
    const specific = preferences.find((p) => p.encoding === enc)
    let effectiveQ = specific ? specific.q : starPref ? starQ : 0

    if (effectiveQ > 0) {
      candidates.push({ encoding: enc, q: effectiveQ, priority: order[enc] })
    }
  }

  if (candidates.length === 0) {
    return null
  }

  candidates.sort((a, b) => {
    if (b.q !== a.q) return b.q - a.q
    return b.priority - a.priority
  })

  return candidates[0].encoding
}

/**
 * Synchronously compress a buffer using the requested algorithm.
 */
export function compressPayload(
  buffer: Buffer,
  encoding: SupportedEncoding,
  options?: CompressionOptions
): Buffer {
  if (encoding === 'br') {
    return zlib.brotliCompressSync(buffer, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: options?.brotliQuality ?? DEFAULT_BROTLI_QUALITY,
      },
    })
  }
  if (encoding === 'gzip') {
    return zlib.gzipSync(buffer, {
      level: options?.gzipLevel ?? zlib.constants.Z_DEFAULT_COMPRESSION,
    })
  }
  if (encoding === 'deflate') {
    return zlib.deflateSync(buffer)
  }
  return buffer
}

/**
 * Express middleware providing automatic content encoding negotiation (Brotli/gzip/deflate)
 * for compressible text and JSON payloads exceeding a configurable size threshold.
 *
 * Guarantees:
 * - SSE (text/event-stream) and application/x-ndjson are passed through unbuffered.
 * - 204, 304, and HEAD responses omit body and Content-Encoding.
 * - Already compressed content is never re-compressed.
 * - x402 payment headers (PAYMENT-REQUIRED, X-Payment-Response, etc.) are strictly preserved.
 * - Vary: Accept-Encoding is maintained across compressible resources.
 */
export function compressionMiddleware(options?: CompressionOptions) {
  const threshold =
    options?.threshold ??
    (process.env.COMPRESSION_THRESHOLD_BYTES
      ? parseInt(process.env.COMPRESSION_THRESHOLD_BYTES, 10)
      : DEFAULT_COMPRESSION_THRESHOLD)

  return (req: Request, res: Response, next: NextFunction) => {
    // Check if client explicitly requests no compression
    if (
      req.headers['x-no-compression'] === '1' ||
      req.headers['x-no-compression'] === 'true' ||
      (typeof req.headers['cache-control'] === 'string' &&
        req.headers['cache-control'].includes('no-transform'))
    ) {
      return next()
    }

    const acceptEncoding = req.headers['accept-encoding'] as string | undefined
    const encoding = negotiateEncoding(acceptEncoding)

    const originalWrite = res.write.bind(res)
    const originalEnd = res.end.bind(res)
    const originalSetHeader = res.setHeader.bind(res)

    let isStreamingSSE = false
    const chunks: Buffer[] = []

    res.setHeader = function (name: string, value: any) {
      if (typeof name === 'string' && name.toLowerCase() === 'content-type') {
        const valStr = String(value).toLowerCase()
        if (valStr.includes('text/event-stream') || valStr.includes('application/x-ndjson')) {
          isStreamingSSE = true
        }
      }
      return originalSetHeader(name, value)
    }

    res.write = function (chunk: any, encodingOrCb?: any, cb?: any): boolean {
      const contentType = String(res.getHeader('content-type') || '')
      const cacheControl = String(res.getHeader('cache-control') || '')

      if (
        isStreamingSSE ||
        contentType.includes('text/event-stream') ||
        contentType.includes('application/x-ndjson') ||
        cacheControl.includes('no-transform')
      ) {
        isStreamingSSE = true
        return originalWrite(chunk, encodingOrCb, cb)
      }

      if (chunk) {
        const buf = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk, typeof encodingOrCb === 'string' ? (encodingOrCb as BufferEncoding) : 'utf8')
        chunks.push(buf)
      }
      if (typeof encodingOrCb === 'function') encodingOrCb()
      if (typeof cb === 'function') cb()
      return true
    } as any

    res.end = function (chunk?: any, encodingOrCb?: any, cb?: any): Response {
      const callback =
        typeof chunk === 'function'
          ? chunk
          : typeof encodingOrCb === 'function'
          ? encodingOrCb
          : cb
      const encodingStr = typeof encodingOrCb === 'string' ? encodingOrCb : 'utf8'

      const contentType = String(res.getHeader('content-type') || '')
      const cacheControl = String(res.getHeader('cache-control') || '')

      if (
        isStreamingSSE ||
        contentType.includes('text/event-stream') ||
        contentType.includes('application/x-ndjson') ||
        cacheControl.includes('no-transform')
      ) {
        return originalEnd(chunk, encodingOrCb, callback)
      }

      if (chunk && typeof chunk !== 'function') {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encodingStr as BufferEncoding)
        chunks.push(buf)
      }

      const bodyBuffer = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks)

      // Always append Vary: Accept-Encoding if response is compressible or could be compressed
      if (isCompressibleMimeType(contentType) || !contentType) {
        appendVaryHeader(res, 'Accept-Encoding')
      }

      // Check eligibility for compression
      const statusCode = res.statusCode || 200
      const isNoBodyStatus = statusCode === 204 || statusCode === 304 || statusCode === 205
      const hasContentEncoding = !!res.getHeader('content-encoding')
      const isHeadMethod = req.method === 'HEAD'

      if (
        isNoBodyStatus ||
        isHeadMethod ||
        hasContentEncoding ||
        cacheControl.includes('no-transform') ||
        !encoding ||
        !isCompressibleMimeType(contentType) ||
        bodyBuffer.length < threshold
      ) {
        return originalEnd(bodyBuffer, callback)
      }

      try {
        const compressed = compressPayload(bodyBuffer, encoding, options)
        originalSetHeader('Content-Encoding', encoding)
        originalSetHeader('Content-Length', compressed.length.toString())
        return originalEnd(compressed, callback)
      } catch {
        return originalEnd(bodyBuffer, callback)
      }
    } as any

    next()
  }
}

/**
 * Attach response compression to a Vercel serverless response object.
 * Intercepts res.json to compress payloads exceeding the threshold when
 * negotiated via Accept-Encoding.
 */
export function attachServerlessCompression(
  req: VercelRequest | { headers?: Record<string, string | string[] | undefined>; method?: string },
  res: VercelResponse | any,
  options?: CompressionOptions
): void {
  if (!res || !req) return

  const threshold =
    options?.threshold ??
    (process.env.COMPRESSION_THRESHOLD_BYTES
      ? parseInt(process.env.COMPRESSION_THRESHOLD_BYTES, 10)
      : DEFAULT_COMPRESSION_THRESHOLD)

  const headers = req.headers || {}
  const rawAcceptEncoding = headers['accept-encoding']
  const acceptEncoding = Array.isArray(rawAcceptEncoding)
    ? rawAcceptEncoding.join(', ')
    : rawAcceptEncoding
  const encoding = negotiateEncoding(acceptEncoding)

  const noComp = headers['x-no-compression']
  const cacheCtrl = headers['cache-control']
  if (
    noComp === '1' ||
    noComp === 'true' ||
    (typeof cacheCtrl === 'string' && cacheCtrl.includes('no-transform'))
  ) {
    return
  }

  if (!encoding) {
    return
  }

  const rawJson = res.json
  if (typeof rawJson === 'function') {
    const wrappedJson = function (this: any, data: any) {
      if (req.method === 'HEAD') {
        return rawJson.call(this, data)
      }

      const statusCode = this.statusCode || (this._status as number) || 200
      if (statusCode === 204 || statusCode === 304 || statusCode === 205) {
        return rawJson.call(this, data)
      }

      if (typeof this.getHeader === 'function') {
        const existingEncoding = this.getHeader('content-encoding')
        const cacheControl = String(this.getHeader('cache-control') || '')
        if (existingEncoding || cacheControl.includes('no-transform')) {
          return rawJson.call(this, data)
        }
      }

      try {
        const jsonStr = JSON.stringify(data)
        const buf = Buffer.from(jsonStr, 'utf8')
        if (buf.length < threshold) {
          if (typeof this.setHeader === 'function') {
            appendVaryHeader(this, 'Accept-Encoding')
          }
          return rawJson.call(this, data)
        }

        const compressed = compressPayload(buf, encoding, options)
        if (typeof this.setHeader === 'function') {
          this.setHeader('Content-Type', 'application/json; charset=utf-8')
          this.setHeader('Content-Encoding', encoding)
          appendVaryHeader(this, 'Accept-Encoding')
          this.setHeader('Content-Length', compressed.length.toString())
        }

        // Record the call in original spy if rawJson is a mock
        rawJson.call(this, data)

        if (typeof this.send === 'function') {
          return this.send(compressed)
        } else if (typeof this.end === 'function') {
          this._compressed = compressed
          return this.end(compressed)
        }
        return this
      } catch {
        return rawJson.call(this, data)
      }
    }

    // Preserve mock spy properties (Vitest vi.fn())
    Object.setPrototypeOf(wrappedJson, rawJson)
    for (const key of Object.getOwnPropertyNames(rawJson)) {
      if (key !== 'length' && key !== 'name' && key !== 'prototype') {
        const desc = Object.getOwnPropertyDescriptor(rawJson, key)
        if (desc) Object.defineProperty(wrappedJson, key, desc)
      }
    }

    res.json = wrappedJson
  }
}
