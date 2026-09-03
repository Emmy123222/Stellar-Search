import { Request, Response } from 'express'
import { randomUUID } from 'crypto'

/**
 * Generates a new request ID (UUID v4)
 */
export function generateRequestId(): string {
  return randomUUID()
}

/**
 * Extracts or generates request ID from Express request
 * Accepts: X-Request-ID, X-Correlation-ID, x-request-id headers (case-insensitive)
 */
export function getRequestId(req: Request): string {
  const id =
    (req.headers['x-request-id'] as string) ||
    (req.headers['x-correlation-id'] as string) ||
    generateRequestId()
  return id
}

/**
 * Middleware to attach request ID to all requests and responses
 * Makes requestId available on req.id for downstream handlers
 */
export function requestIdMiddleware(req: Request, res: Response, next: Function) {
  const requestId = getRequestId(req)
  ;(req as any).id = requestId
  res.setHeader('X-Request-ID', requestId)
  next()
}
