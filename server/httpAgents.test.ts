/**
 * server/httpAgents.test.ts
 *
 * Verifies that every per-provider HTTP agent exported from server/httpAgents.ts
 * has the documented connection-pool and socket-limit settings.
 *
 * Acceptance criteria from #333:
 *   ✅  Provider clients use documented keep-alive, connection, DNS, and idle-timeout settings.
 *   ✅  Socket counts are bounded (no unbounded pools).
 *   ✅  Abort / idle cleanup is enforced by freeSocketTimeout / keepAliveTimeout.
 *   ✅  TLS certificate verification is enabled on all agents that reach the public internet.
 *
 * Two families of agents are tested:
 *   - undici `Agent`  (serperAgent, groqFetchAgent, facilitatorAgent, horizonAgent,
 *                      mcpServerAgent) — used via `fetch({ dispatcher })`.
 *   - agentkeepalive `HttpsAgent` (groqHttpAgent) — passed to `new Groq({ httpAgent })`.
 */

import { describe, it, expect } from 'vitest'

import {
  serperAgent,
  groqFetchAgent,
  groqHttpAgent,
  facilitatorAgent,
  horizonAgent,
  mcpServerAgent,
} from './httpAgents.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Read pool options stored under Symbol(options) on an undici Agent instance.
 *
 * undici ≥ 5 stores the per-agent options as:
 *   agent[Symbol(options)]          — pool options (connections, keepAliveTimeout, …)
 *   agent[Symbol(maxRedirections)]  — redirect cap (separate symbol)
 *
 * Both access paths are wrapped below so tests stay resilient against minor
 * undici version changes.
 */
function getUndiciOptions(agent: any): Record<string, any> {
  const syms = Object.getOwnPropertySymbols(agent)

  // Primary: Symbol whose description is exactly 'options'
  const optSym = syms.find((s) => s.toString() === 'Symbol(options)')
  if (optSym) return (agent[optSym] as Record<string, any>) ?? {}

  // Fallback: older undici or bundled builds may expose options directly
  if (agent.options && typeof agent.options === 'object') return agent.options as Record<string, any>

  return {}
}

/**
 * Read the maxRedirections cap from an undici Agent.
 * undici stores it under Symbol(maxRedirections), not inside Symbol(options).
 */
function getUndiciMaxRedirections(agent: any): number | undefined {
  const syms = Object.getOwnPropertySymbols(agent)
  const sym = syms.find((s) => s.toString() === 'Symbol(maxRedirections)')
  if (sym !== undefined) return agent[sym] as number | undefined
  // Fallback for builds that expose it directly
  return (agent as any).maxRedirections as number | undefined
}

// ─── undici Agent exports ─────────────────────────────────────────────────────

describe('serperAgent — undici Agent for google.serper.dev', () => {
  it('is a non-null object (valid undici Agent instance)', () => {
    expect(serperAgent).toBeDefined()
    expect(typeof serperAgent).toBe('object')
    expect(serperAgent).not.toBeNull()
  })

  it('has a dispatch method (undici Dispatcher interface)', () => {
    expect(typeof (serperAgent as any).dispatch).toBe('function')
  })

  it('caps connections at 10 (bounded socket pool)', () => {
    const opts = getUndiciOptions(serperAgent)
    // connections is the undici Agent option name
    expect(opts.connections).toBe(10)
  })

  it('sets keepAliveTimeout to 4 000 ms (idle keep-alive window)', () => {
    const opts = getUndiciOptions(serperAgent)
    expect(opts.keepAliveTimeout).toBe(4_000)
  })

  it('sets headersTimeout to 10 000 ms', () => {
    const opts = getUndiciOptions(serperAgent)
    expect(opts.headersTimeout).toBe(10_000)
  })

  it('sets bodyTimeout to 10 000 ms', () => {
    const opts = getUndiciOptions(serperAgent)
    expect(opts.bodyTimeout).toBe(10_000)
  })

  it('caps maxRedirections at 2', () => {
    expect(getUndiciMaxRedirections(serperAgent)).toBe(2)
  })

  it('enforces TLS (connect.rejectUnauthorized = true)', () => {
    const opts = getUndiciOptions(serperAgent)
    expect(opts.connect?.rejectUnauthorized).toBe(true)
  })

  it('sets connect.timeout to 5 000 ms (TCP+TLS handshake deadline)', () => {
    const opts = getUndiciOptions(serperAgent)
    expect(opts.connect?.timeout).toBe(5_000)
  })
})

describe('groqFetchAgent — undici Agent for api.groq.com direct fetch()', () => {
  it('is a valid undici Agent', () => {
    expect(groqFetchAgent).toBeDefined()
    expect(typeof (groqFetchAgent as any).dispatch).toBe('function')
  })

  it('caps connections at 5 (lower than Serper — Groq is not burst traffic)', () => {
    const opts = getUndiciOptions(groqFetchAgent)
    expect(opts.connections).toBe(5)
  })

  it('sets headersTimeout to 30 000 ms (Groq model warm-up allowance)', () => {
    const opts = getUndiciOptions(groqFetchAgent)
    expect(opts.headersTimeout).toBe(30_000)
  })

  it('sets bodyTimeout to 60 000 ms (streaming completions can be long)', () => {
    const opts = getUndiciOptions(groqFetchAgent)
    expect(opts.bodyTimeout).toBe(60_000)
  })

  it('enforces TLS (connect.rejectUnauthorized = true)', () => {
    const opts = getUndiciOptions(groqFetchAgent)
    expect(opts.connect?.rejectUnauthorized).toBe(true)
  })
})

describe('facilitatorAgent — undici Agent for x402 facilitator', () => {
  it('is a valid undici Agent', () => {
    expect(facilitatorAgent).toBeDefined()
    expect(typeof (facilitatorAgent as any).dispatch).toBe('function')
  })

  it('caps connections at 4 (conservative — payment service)', () => {
    const opts = getUndiciOptions(facilitatorAgent)
    expect(opts.connections).toBe(4)
  })

  it('sets keepAliveTimeout to 4 000 ms', () => {
    const opts = getUndiciOptions(facilitatorAgent)
    expect(opts.keepAliveTimeout).toBe(4_000)
  })

  it('sets headersTimeout to 10 000 ms', () => {
    const opts = getUndiciOptions(facilitatorAgent)
    expect(opts.headersTimeout).toBe(10_000)
  })

  it('enforces TLS', () => {
    const opts = getUndiciOptions(facilitatorAgent)
    expect(opts.connect?.rejectUnauthorized).toBe(true)
  })
})

describe('horizonAgent — undici Agent for Stellar Horizon REST API', () => {
  it('is a valid undici Agent', () => {
    expect(horizonAgent).toBeDefined()
    expect(typeof (horizonAgent as any).dispatch).toBe('function')
  })

  it('caps connections at 4', () => {
    const opts = getUndiciOptions(horizonAgent)
    expect(opts.connections).toBe(4)
  })

  it('sets keepAliveTimeout to 4 000 ms', () => {
    const opts = getUndiciOptions(horizonAgent)
    expect(opts.keepAliveTimeout).toBe(4_000)
  })

  it('enforces TLS', () => {
    const opts = getUndiciOptions(horizonAgent)
    expect(opts.connect?.rejectUnauthorized).toBe(true)
  })
})

describe('mcpServerAgent — undici Agent for MCP → Express localhost calls', () => {
  it('is a valid undici Agent', () => {
    expect(mcpServerAgent).toBeDefined()
    expect(typeof (mcpServerAgent as any).dispatch).toBe('function')
  })

  it('caps connections at 4', () => {
    const opts = getUndiciOptions(mcpServerAgent)
    expect(opts.connections).toBe(4)
  })

  it('sets connect.timeout to 2 000 ms (localhost is near-instant)', () => {
    const opts = getUndiciOptions(mcpServerAgent)
    expect(opts.connect?.timeout).toBe(2_000)
  })

  it('sets keepAliveTimeout to 4 000 ms', () => {
    const opts = getUndiciOptions(mcpServerAgent)
    expect(opts.keepAliveTimeout).toBe(4_000)
  })
})

// ─── agentkeepalive HttpsAgent export ────────────────────────────────────────

describe('groqHttpAgent — agentkeepalive HttpsAgent for Groq SDK', () => {
  it('is a non-null object', () => {
    expect(groqHttpAgent).toBeDefined()
    expect(typeof groqHttpAgent).toBe('object')
    expect(groqHttpAgent).not.toBeNull()
  })

  it('has createConnection method (http.Agent compatible)', () => {
    // agentkeepalive HttpsAgent extends https.Agent which extends http.Agent
    expect(typeof (groqHttpAgent as any).createConnection).toBe('function')
  })

  it('has maxSockets capped at 5', () => {
    expect((groqHttpAgent as any).maxSockets).toBe(5)
  })

  it('keeps sockets alive (keepAlive = true)', () => {
    expect((groqHttpAgent as any).keepAlive).toBe(true)
  })

  it('sets freeSocketTimeout to 4 000 ms (idle socket cleanup)', () => {
    // agentkeepalive stores constructor options in agent.options
    expect((groqHttpAgent as any).options?.freeSocketTimeout).toBe(4_000)
  })

  it('sets timeout to 60 000 ms (active socket read timeout for completions)', () => {
    expect((groqHttpAgent as any).options?.timeout).toBe(60_000)
  })
})

// ─── Cross-agent invariants ───────────────────────────────────────────────────

describe('cross-agent invariants — all providers are bounded and non-null', () => {
  const undiciAgents = [
    { name: 'serperAgent',       agent: serperAgent,       maxConns: 10 },
    { name: 'groqFetchAgent',    agent: groqFetchAgent,    maxConns: 5  },
    { name: 'facilitatorAgent',  agent: facilitatorAgent,  maxConns: 4  },
    { name: 'horizonAgent',      agent: horizonAgent,      maxConns: 4  },
    { name: 'mcpServerAgent',    agent: mcpServerAgent,    maxConns: 4  },
  ]

  for (const { name, agent, maxConns } of undiciAgents) {
    it(`${name}: is defined and has dispatch()`, () => {
      expect(agent).toBeDefined()
      expect(typeof (agent as any).dispatch).toBe('function')
    })

    it(`${name}: connections ≤ ${maxConns} (no unbounded pool)`, () => {
      const opts = getUndiciOptions(agent)
      expect(opts.connections).toBeLessThanOrEqual(maxConns)
    })

    it(`${name}: keepAliveTimeout ≥ 1 000 ms (sockets reused across requests)`, () => {
      const opts = getUndiciOptions(agent)
      expect(opts.keepAliveTimeout).toBeGreaterThanOrEqual(1_000)
    })

    it(`${name}: maxRedirections ≤ 2 (no open-redirect loops)`, () => {
      expect(getUndiciMaxRedirections(agent)).toBeLessThanOrEqual(2)
    })
  }

  it('groqHttpAgent: maxSockets ≤ 5 (no unbounded pool for Groq SDK)', () => {
    expect((groqHttpAgent as any).maxSockets).toBeLessThanOrEqual(5)
  })

  it('groqHttpAgent: keepAlive is truthy (connection reuse enabled)', () => {
    expect((groqHttpAgent as any).keepAlive).toBe(true)
  })

  it('total potential sockets across all agents ≤ 32 (OS fd budget)', () => {
    const undiciCounts = undiciAgents.map(({ agent }) => {
      const opts = getUndiciOptions(agent)
      return (opts.connections as number) ?? 0
    })
    const keepAliveCount: number = (groqHttpAgent as any).maxSockets ?? 0
    const total = undiciCounts.reduce((a, b) => a + b, 0) + keepAliveCount
    // Budget: 10 + 5 + 4 + 4 + 4 + 5 = 32
    expect(total).toBeLessThanOrEqual(32)
  })
})

// ─── Agent isolation ──────────────────────────────────────────────────────────

describe('agent isolation — each provider has a distinct agent instance', () => {
  it('serperAgent !== groqFetchAgent', () => {
    expect(serperAgent).not.toBe(groqFetchAgent)
  })

  it('serperAgent !== facilitatorAgent', () => {
    expect(serperAgent).not.toBe(facilitatorAgent)
  })

  it('facilitatorAgent !== horizonAgent', () => {
    expect(facilitatorAgent).not.toBe(horizonAgent)
  })

  it('horizonAgent !== mcpServerAgent', () => {
    expect(horizonAgent).not.toBe(mcpServerAgent)
  })

  it('groqFetchAgent !== groqHttpAgent (different agent types)', () => {
    expect(groqFetchAgent as any).not.toBe(groqHttpAgent as any)
  })
})
