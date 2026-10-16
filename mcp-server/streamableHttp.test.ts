import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import {
  readMcpHttpConfig,
  createMcpHttpHandler,
  McpSessionManager,
  type McpHttpConfig,
} from './streamableHttp.js'
import { createMcpServer, server as stdioServer } from './index.js'

describe('MCP Streamable HTTP Transport (Issue #328)', () => {
  const origEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...origEnv }
    vi.restoreAllMocks()
  })

  afterEach(() => {
    process.env = { ...origEnv }
  })

  describe('1. Configuration & defaults', () => {
    it('defaults to disabled when MCP_HTTP_ENABLED is not set', () => {
      delete process.env.MCP_HTTP_ENABLED
      const config = readMcpHttpConfig()
      expect(config.enabled).toBe(false)
      expect(config.maxSessions).toBe(50)
      expect(config.sessionTimeoutMs).toBe(30 * 60 * 1000)
      expect(config.requestTimeoutMs).toBe(60 * 1000)
    })

    it('enables transport when MCP_HTTP_ENABLED=true', () => {
      process.env.MCP_HTTP_ENABLED = 'true'
      process.env.MCP_AUTH_TOKEN = 'secret-token-123'
      process.env.MCP_ALLOWED_ORIGINS = 'http://localhost:5173,https://agent.example.com'
      process.env.MCP_MAX_SESSIONS = '10'
      process.env.MCP_SESSION_TIMEOUT_MS = '60000'
      process.env.MCP_REQUEST_TIMEOUT_MS = '5000'

      const config = readMcpHttpConfig()
      expect(config.enabled).toBe(true)
      expect(config.authToken).toBe('secret-token-123')
      expect(config.allowedOrigins).toEqual(['http://localhost:5173', 'https://agent.example.com'])
      expect(config.maxSessions).toBe(10)
      expect(config.sessionTimeoutMs).toBe(60000)
      expect(config.requestTimeoutMs).toBe(5000)
    })
  })

  describe('2. Authentication', () => {
    const config: McpHttpConfig = {
      enabled: true,
      port: 3005,
      authToken: 'test-secure-token-999',
      allowedOrigins: ['*'],
      maxSessions: 10,
      sessionTimeoutMs: 60000,
      requestTimeoutMs: 5000,
    }

    const app = express()
    app.use(express.json())
    app.use('/mcp', createMcpHttpHandler(config))

    it('rejects request with 401 when authentication token is missing', async () => {
      const res = await request(app)
        .post('/mcp')
        .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })

      expect(res.status).toBe(401)
      expect(res.body.error).toMatch(/Missing MCP authentication token/i)
    })

    it('rejects request with 401 when token is invalid', async () => {
      const res = await request(app)
        .post('/mcp')
        .set('Authorization', 'Bearer wrong-token')
        .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })

      expect(res.status).toBe(401)
      expect(res.body.error).toMatch(/Invalid MCP authentication token/i)
    })

    it('accepts request with valid Authorization Bearer token', async () => {
      const res = await request(app)
        .post('/mcp')
        .set('Authorization', 'Bearer test-secure-token-999')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0' },
          },
        })

      expect(res.status).toBe(200)
      expect(res.headers['mcp-session-id']).toBeDefined()
    })

    it('accepts request with valid X-MCP-Token header', async () => {
      const res = await request(app)
        .post('/mcp')
        .set('X-MCP-Token', 'test-secure-token-999')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0' },
          },
        })

      expect(res.status).toBe(200)
      expect(res.headers['mcp-session-id']).toBeDefined()
    })
  })

  describe('3. Origin policy & CORS', () => {
    const config: McpHttpConfig = {
      enabled: true,
      port: 3005,
      authToken: 'token-abc',
      allowedOrigins: ['https://trusted-agent.com', 'http://localhost:5173'],
      maxSessions: 10,
      sessionTimeoutMs: 60000,
      requestTimeoutMs: 5000,
    }

    const app = express()
    app.use(express.json())
    app.use('/mcp', createMcpHttpHandler(config))

    it('rejects request with 403 when Origin is not allowed', async () => {
      const res = await request(app)
        .post('/mcp')
        .set('Origin', 'https://malicious-site.com')
        .set('Authorization', 'Bearer token-abc')
        .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })

      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/Origin not allowed by MCP origin policy/i)
    })

    it('allows request when Origin is in allowed list and sets CORS headers', async () => {
      const res = await request(app)
        .post('/mcp')
        .set('Origin', 'https://trusted-agent.com')
        .set('Authorization', 'Bearer token-abc')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test', version: '1.0' },
          },
        })

      expect(res.status).toBe(200)
      expect(res.headers['access-control-allow-origin']).toBe('https://trusted-agent.com')
      expect(res.headers['access-control-expose-headers']).toContain('Mcp-Session-Id')
    })

    it('handles OPTIONS preflight for allowed origin with 204 No Content', async () => {
      const res = await request(app)
        .options('/mcp')
        .set('Origin', 'https://trusted-agent.com')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'Authorization, Content-Type, Mcp-Session-Id')

      expect(res.status).toBe(204)
      expect(res.headers['access-control-allow-origin']).toBe('https://trusted-agent.com')
      expect(res.headers['access-control-allow-methods']).toContain('POST')
    })

    it('rejects OPTIONS preflight for disallowed origin with 403 Forbidden', async () => {
      const res = await request(app)
        .options('/mcp')
        .set('Origin', 'https://attacker.com')

      expect(res.status).toBe(403)
    })
  })

  describe('4. Session limits, lifecycle & timeouts', () => {
    it('enforces maxSessions limit with 429 Too Many Requests', async () => {
      const config: McpHttpConfig = {
        enabled: true,
        port: 3005,
        authToken: 'token-test',
        allowedOrigins: ['*'],
        maxSessions: 2, // limit to 2
        sessionTimeoutMs: 60000,
        requestTimeoutMs: 5000,
      }

      const app = express()
      app.use(express.json())
      app.use('/mcp', createMcpHttpHandler(config))

      // Session 1
      const res1 = await request(app)
        .post('/mcp')
        .set('Authorization', 'Bearer token-test')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'c1', version: '1' } },
        })
      expect(res1.status).toBe(200)
      expect(res1.headers['mcp-session-id']).toBeDefined()

      // Session 2
      const res2 = await request(app)
        .post('/mcp')
        .set('Authorization', 'Bearer token-test')
        .send({
          jsonrpc: '2.0',
          id: 2,
          method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'c2', version: '1' } },
        })
      expect(res2.status).toBe(200)
      expect(res2.headers['mcp-session-id']).toBeDefined()

      // Session 3 -> should exceed limit
      const res3 = await request(app)
        .post('/mcp')
        .set('Authorization', 'Bearer token-test')
        .send({
          jsonrpc: '2.0',
          id: 3,
          method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'c3', version: '1' } },
        })
      expect(res3.status).toBe(429)
      expect(res3.body.error).toMatch(/session limit reached/i)
    })

    it('cleans up session via DELETE /mcp and rejects subsequent requests with 404', async () => {
      const config: McpHttpConfig = {
        enabled: true,
        port: 3005,
        authToken: 'token-test',
        allowedOrigins: ['*'],
        maxSessions: 10,
        sessionTimeoutMs: 60000,
        requestTimeoutMs: 5000,
      }

      const app = express()
      app.use(express.json())
      app.use('/mcp', createMcpHttpHandler(config))

      // Init
      const initRes = await request(app)
        .post('/mcp')
        .set('Authorization', 'Bearer token-test')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'c1', version: '1' } },
        })
      const sessionId = initRes.headers['mcp-session-id']
      expect(sessionId).toBeDefined()

      // Teardown with DELETE
      const deleteRes = await request(app)
        .delete('/mcp')
        .set('Authorization', 'Bearer token-test')
        .set('Mcp-Session-Id', sessionId)

      expect(deleteRes.status).toBe(204)

      // Next request with that session ID should return 404
      const nextRes = await request(app)
        .post('/mcp')
        .set('Authorization', 'Bearer token-test')
        .set('Mcp-Session-Id', sessionId)
        .send({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        })

      expect(nextRes.status).toBe(404)
    })

    it('prunes idle sessions exceeding sessionTimeoutMs', async () => {
      const manager = new McpSessionManager({
        maxSessions: 5,
        sessionTimeoutMs: 100, // 100ms timeout
        requestTimeoutMs: 5000,
      })

      const session = await manager.createSession()
      expect(manager.activeSessionCount()).toBe(1)

      // Wait 150ms to exceed sessionTimeoutMs
      await new Promise(r => setTimeout(r, 150))

      const pruned = await manager.pruneExpiredSessions()
      expect(pruned).toBe(1)
      expect(manager.activeSessionCount()).toBe(0)
      expect(manager.getSession(session.sessionId)).toBeUndefined()
    })
  })

  describe('5. Tool implementation parity with stdio', async () => {
    it('creates an MCP server sharing identical tools, resources, and prompts as stdio', async () => {
      const httpMcpServer = createMcpServer()
      expect(httpMcpServer).toBeDefined()
      expect(stdioServer).toBeDefined()

      // Both must share the capability doc and tool names
      const { getCapabilityDoc } = await import('./index.js')
      const doc = getCapabilityDoc()
      expect(doc.mcpTools).toContain('web_search')
      expect(doc.mcpTools).toContain('image_search')
      expect(doc.mcpTools).toContain('news_search')
      expect(doc.mcpTools).toContain('ai_summarize')
      expect(doc.mcpTools).toContain('check_balance')
      expect(doc.mcpTools).toContain('get_search_stats')
    })
  })

  describe('6. Express server mount (/mcp)', () => {
    it('returns 404 with guidance when MCP_HTTP_ENABLED is not enabled on Express server', async () => {
      const { default: serverApp } = await import('../server/index.js')
      const res = await request(serverApp).post('/mcp').send({ jsonrpc: '2.0', id: 1, method: 'initialize' })
      expect(res.status).toBe(404)
      expect(res.body.error).toMatch(/MCP Streamable HTTP transport is disabled/i)
    })
  })
})

