/**
 * MCP Streamable HTTP Transport
 *
 * Implements an authenticated Streamable HTTP transport for the StellarSearch MCP server:
 *   - Shares identical tool implementation, resources, and prompts as stdio
 *   - Bearer token / X-MCP-Token authentication via crypto.timingSafeEqual
 *   - Origin policy & CORS enforcement (MCP_ALLOWED_ORIGINS)
 *   - Session lifecycle management (McpSessionManager, MCP_MAX_SESSIONS, 429 on exhaustion)
 *   - Timeouts and idle session pruning (MCP_SESSION_TIMEOUT_MS, MCP_REQUEST_TIMEOUT_MS)
 *   - Clean session teardown on DELETE /mcp
 */

import crypto, { randomUUID } from 'crypto'
import express, { type Request, type Response, type NextFunction } from 'express'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createMcpServer } from './index.js'

export interface McpHttpConfig {
  enabled: boolean
  port: number
  authToken?: string
  allowedOrigins: string[]
  maxSessions: number
  sessionTimeoutMs: number
  requestTimeoutMs: number
}

/**
 * Reads and parses MCP Streamable HTTP configuration from environment variables.
 */
export function readMcpHttpConfig(): McpHttpConfig {
  const enabled =
    process.env.MCP_HTTP_ENABLED === 'true' || process.env.MCP_HTTP_ENABLED === '1'
  const port = process.env.MCP_HTTP_PORT
    ? parseInt(process.env.MCP_HTTP_PORT, 10)
    : 3005
  const authToken = process.env.MCP_AUTH_TOKEN
    ? process.env.MCP_AUTH_TOKEN.trim()
    : undefined
  const allowedOrigins = process.env.MCP_ALLOWED_ORIGINS
    ? process.env.MCP_ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
    : ['*']
  const maxSessions = process.env.MCP_MAX_SESSIONS
    ? parseInt(process.env.MCP_MAX_SESSIONS, 10)
    : 50
  const sessionTimeoutMs = process.env.MCP_SESSION_TIMEOUT_MS
    ? parseInt(process.env.MCP_SESSION_TIMEOUT_MS, 10)
    : 30 * 60 * 1000
  const requestTimeoutMs = process.env.MCP_REQUEST_TIMEOUT_MS
    ? parseInt(process.env.MCP_REQUEST_TIMEOUT_MS, 10)
    : 60 * 1000

  return {
    enabled,
    port,
    authToken,
    allowedOrigins,
    maxSessions,
    sessionTimeoutMs,
    requestTimeoutMs,
  }
}

export interface McpSession {
  sessionId: string
  transport: StreamableHTTPServerTransport
  server: Server
  createdAt: number
  lastAccessedAt: number
}

/**
 * Manages active MCP sessions for Streamable HTTP transport.
 */
export class McpSessionManager {
  private sessions = new Map<string, McpSession>()
  private config: {
    maxSessions: number
    sessionTimeoutMs: number
    requestTimeoutMs: number
  }
  private pruneInterval?: NodeJS.Timeout

  constructor(config?: Partial<McpHttpConfig>) {
    this.config = {
      maxSessions: config?.maxSessions ?? 50,
      sessionTimeoutMs: config?.sessionTimeoutMs ?? 30 * 60 * 1000,
      requestTimeoutMs: config?.requestTimeoutMs ?? 60 * 1000,
    }

    if (this.config.sessionTimeoutMs > 0) {
      const intervalMs = Math.max(100, Math.min(this.config.sessionTimeoutMs, 60000))
      this.pruneInterval = setInterval(() => {
        void this.pruneExpiredSessions()
      }, intervalMs)
      this.pruneInterval.unref?.()
    }
  }

  activeSessionCount(): number {
    return this.sessions.size
  }

  getSession(sessionId: string): McpSession | undefined {
    return this.sessions.get(sessionId)
  }

  async createSession(options?: { sessionId?: string }): Promise<McpSession> {
    if (this.sessions.size >= this.config.maxSessions) {
      throw new Error('MCP session limit reached')
    }

    const sessionId = options?.sessionId || randomUUID()
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId,
      enableJsonResponse: true,
      onsessionclosed: (closedId) => {
        void this.deleteSession(closedId)
      },
    })

    const serverInstance = createMcpServer()
    await serverInstance.connect(transport)

    const session: McpSession = {
      sessionId,
      transport,
      server: serverInstance,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    }
    this.sessions.set(sessionId, session)
    return session
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    this.sessions.delete(sessionId)
    try {
      await session.transport.close()
    } catch {
      // ignore transport close errors
    }
    return true
  }

  async pruneExpiredSessions(): Promise<number> {
    const now = Date.now()
    let pruned = 0
    for (const [id, session] of Array.from(this.sessions.entries())) {
      if (now - session.lastAccessedAt > this.config.sessionTimeoutMs) {
        await this.deleteSession(id)
        pruned++
      }
    }
    return pruned
  }

  async closeAll(): Promise<void> {
    if (this.pruneInterval) {
      clearInterval(this.pruneInterval)
      this.pruneInterval = undefined
    }
    for (const id of Array.from(this.sessions.keys())) {
      await this.deleteSession(id)
    }
  }
}

/**
 * Creates an Express RequestHandler that serves the MCP Streamable HTTP protocol.
 */
export function createMcpHttpHandler(
  config: McpHttpConfig,
  manager?: McpSessionManager,
): express.RequestHandler {
  const sessionManager = manager ?? new McpSessionManager(config)

  return async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      // 1. Origin policy & CORS headers
      const origin = req.headers['origin'] as string | undefined
      const allowedOrigins = config.allowedOrigins || ['*']
      const allowsAll = allowedOrigins.includes('*')
      const isAllowed = !origin || allowsAll || allowedOrigins.includes(origin)

      if (origin && !isAllowed) {
        res.status(403).json({ error: 'Origin not allowed by MCP origin policy' })
        return
      }

      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin)
      } else if (allowsAll) {
        res.setHeader('Access-Control-Allow-Origin', '*')
      }

      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-MCP-Token, Mcp-Session-Id, Last-Event-ID',
      )
      res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id')

      // Handle OPTIONS preflight
      if (req.method === 'OPTIONS') {
        res.status(204).end()
        return
      }

      // 2. Authentication check
      if (config.authToken) {
        const authHeader = req.headers['authorization']
        const xTokenHeader = (req.headers['x-mcp-token'] || req.headers['X-MCP-Token']) as
          | string
          | undefined

        let candidateToken: string | undefined
        if (typeof authHeader === 'string') {
          const match = authHeader.match(/^Bearer\s+(.*)$/i)
          if (match) {
            candidateToken = match[1]
          }
        }
        if (!candidateToken && typeof xTokenHeader === 'string') {
          candidateToken = xTokenHeader
        }

        if (!candidateToken) {
          res.status(401).json({ error: 'Missing MCP authentication token' })
          return
        }

        const expectedBuf = Buffer.from(config.authToken, 'utf8')
        const candidateBuf = Buffer.from(candidateToken, 'utf8')

        if (
          expectedBuf.length !== candidateBuf.length ||
          !crypto.timingSafeEqual(expectedBuf, candidateBuf)
        ) {
          res.status(401).json({ error: 'Invalid MCP authentication token' })
          return
        }
      }

      // Configure request timeout
      if (config.requestTimeoutMs > 0) {
        req.setTimeout(config.requestTimeoutMs)
      }

      // Prune idle sessions
      await sessionManager.pruneExpiredSessions()

      const sessionIdHeader = (req.headers['mcp-session-id'] ||
        req.headers['Mcp-Session-Id']) as string | undefined

      // 3. Handle DELETE (session termination)
      if (req.method === 'DELETE') {
        if (sessionIdHeader) {
          await sessionManager.deleteSession(sessionIdHeader)
        }
        res.status(204).end()
        return
      }

      // Ensure Accept header satisfies SDK requirements (application/json and text/event-stream)
      if (!req.headers['accept'] || !req.headers['accept'].includes('text/event-stream')) {
        req.headers['accept'] = req.headers['accept']
          ? `${req.headers['accept']}, text/event-stream`
          : 'application/json, text/event-stream'
      }

      // 4. Session routing
      if (sessionIdHeader) {
        const session = sessionManager.getSession(sessionIdHeader)
        if (!session) {
          res.status(404).json({ error: 'MCP session not found or expired' })
          return
        }
        session.lastAccessedAt = Date.now()
        res.setHeader('Mcp-Session-Id', session.sessionId)
        await session.transport.handleRequest(req, res, req.body)
        return
      }

      // No session ID provided -> only allow initialize request
      const body = req.body
      const isInit =
        req.method === 'POST' &&
        body &&
        (body.method === 'initialize' ||
          (Array.isArray(body) && body.some((msg) => msg?.method === 'initialize')))

      if (!isInit) {
        res.status(400).json({
          error: 'Missing Mcp-Session-Id header for non-initialization request',
        })
        return
      }

      // Enforce session limit
      if (sessionManager.activeSessionCount() >= config.maxSessions) {
        res.status(429).json({ error: 'MCP session limit reached. Try again later.' })
        return
      }

      const session = await sessionManager.createSession()
      res.setHeader('Mcp-Session-Id', session.sessionId)
      await session.transport.handleRequest(req, res, req.body)
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || 'Internal MCP HTTP server error' })
      }
    }
  }
}

/**
 * Starts a standalone MCP Streamable HTTP server.
 */
export async function startMcpHttpServer(
  customConfig?: Partial<McpHttpConfig>,
): Promise<express.Express> {
  const config = { ...readMcpHttpConfig(), ...customConfig }
  const app = express()
  app.use(express.json())
  app.use('/mcp', createMcpHttpHandler(config))

  return new Promise((resolve) => {
    app.listen(config.port, () => {
      console.log(
        `StellarSearch MCP Streamable HTTP server listening on http://localhost:${config.port}/mcp`,
      )
      resolve(app)
    })
  })
}
