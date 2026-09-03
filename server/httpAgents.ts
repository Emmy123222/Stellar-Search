/**
 * server/httpAgents.ts
 *
 * Per-provider connection-pool configurations for StellarSearch.
 *
 * Why this matters
 * ----------------
 * Node.js built-in `fetch` (backed by undici) and the Groq SDK (backed by
 * node-fetch + agentkeepalive) both use a global dispatcher / default agent
 * whose settings are tuned for generic use, not sustained API traffic.
 * Without explicit settings:
 *   - TCP connections are closed after each request (no keep-alive reuse)
 *   - There is no cap on how many sockets can be opened simultaneously
 *   - Idle connections linger until OS timeout (minutes), leaking file
 *     descriptors under burst load
 *
 * This module creates one agent per external provider with documented settings:
 *
 * Connection-pool settings (per provider)
 * ----------------------------------------
 * | Setting                  | Serper | Groq  | Facilitator | Horizon | MCP  |
 * |--------------------------|--------|-------|-------------|---------|------|
 * | maxSockets / connections |     10 |     5 |           4 |       4 |    4 |
 * | keepAlive                |   true |  true |        true |    true | true |
 * | keepAliveMsecs (ms)      |   4000 |  4000 |        4000 |    4000 | 4000 |
 * | freeSocketTimeout (ms)   |   4000 |  4000 |        4000 |    4000 | 4000 |
 * | timeout (ms)             |  10000 | 60000 |       10000 |   10000 | 10000|
 * | connect.timeout (ms)     |   5000 |  5000 |        5000 |    5000 | 2000 |
 * | headersTimeout (ms)      |  10000 | 30000 |       10000 |   10000 | 10000|
 * | bodyTimeout (ms)         |  10000 | 60000 |       10000 |   10000 | 10000|
 * | maxRedirections          |      2 |     2 |           2 |       2 |    2 |
 *
 * Meaning of each setting
 * -----------------------
 * connections / maxSockets
 *     Maximum number of open sockets to the origin.  Caps OS file-descriptor
 *     use; additional requests queue rather than open new connections.
 *
 * keepAlive / keepAliveMsecs
 *     Re-use TCP connections across requests.  keepAliveMsecs is the initial
 *     delay before sending TCP keep-alive probes.
 *
 * freeSocketTimeout
 *     How long (ms) an idle socket is kept in the free-socket pool waiting for
 *     a new request before it is destroyed.  4 s is well under the typical
 *     load-balancer idle timeout (30–60 s) while allowing meaningful reuse.
 *
 * connect.timeout
 *     TCP + TLS handshake deadline.  5 s is generous but prevents stuck
 *     sockets from blocking the request queue indefinitely.
 *
 * headersTimeout
 *     Time to receive the full response status-line and headers after the
 *     request was sent.  Groq gets 30 s to accommodate model warm-up.
 *
 * bodyTimeout
 *     Time to finish reading the response body after headers were received.
 *     Groq gets 60 s for streaming completions; other providers get 10 s.
 *
 * maxRedirections
 *     Follow at most 2 redirects to avoid open-redirect abuse and loops.
 *
 * Two agent flavors
 * -----------------
 * 1. undici `Agent`  — used with `fetch(url, { dispatcher: agent })` for all
 *    direct `fetch()` calls in server/index.ts and mcp-server/index.ts.
 *
 * 2. `HttpsAgent` from agentkeepalive (same library the Groq SDK uses
 *    internally) — passed to `new Groq({ httpAgent })` so that Groq SDK calls
 *    go through the same bounded pool.
 */

import { Agent } from 'undici'
import type { Dispatcher } from 'undici'
import KeepAlive from 'agentkeepalive'

const { HttpsAgent } = KeepAlive

// ─── Serper.dev ───────────────────────────────────────────────────────────────
// Three endpoints: /search, /images, /news — all on google.serper.dev.
// Burst traffic can open many parallel searches; cap at 10 sockets so the
// OS file-descriptor table stays manageable even under load tests.

/**
 * Undici dispatcher for all google.serper.dev fetch() calls.
 * Pass as `{ dispatcher: serperAgent }` in fetch options.
 */
export const serperAgent: Dispatcher = new Agent({
  connections: 10,
  pipelining: 1,
  keepAliveTimeout: 4_000,       // 4 s  — idle keep-alive window
  keepAliveMaxTimeout: 30_000,   // 30 s — hard ceiling on keep-alive
  connect: {
    timeout: 5_000,              // 5 s  — TCP + TLS handshake
    rejectUnauthorized: true,    // always verify TLS certificates
  },
  headersTimeout: 10_000,        // 10 s — time to receive response headers
  bodyTimeout: 10_000,           // 10 s — time to read response body
  maxRedirections: 2,
})

// ─── Groq API — undici Agent for direct fetch() calls ────────────────────────
// Used when calling Groq endpoints manually via fetch().

/**
 * Undici dispatcher for api.groq.com fetch() calls.
 * Pass as `{ dispatcher: groqFetchAgent }` in fetch options.
 */
export const groqFetchAgent: Dispatcher = new Agent({
  connections: 5,
  pipelining: 1,
  keepAliveTimeout: 4_000,
  keepAliveMaxTimeout: 30_000,
  connect: {
    timeout: 5_000,
    rejectUnauthorized: true,
  },
  headersTimeout: 30_000,        // 30 s — Groq model warm-up can be slow
  bodyTimeout: 60_000,           // 60 s — streaming completions can be long
  maxRedirections: 2,
})

// ─── Groq API — HttpsAgent for the groq-sdk constructor ──────────────────────
// The groq-sdk uses node-fetch internally and accepts a `httpAgent` option that
// must be a node http.Agent-compatible object.  We use agentkeepalive's
// HttpsAgent (already a transitive dependency of groq-sdk) to enforce a bounded
// socket pool on the SDK's own HTTPS requests.

/**
 * HttpsAgent (agentkeepalive) for the Groq SDK constructor.
 *
 * Usage:
 *   import { groqHttpAgent } from './httpAgents.js'
 *   const groq = new Groq({ apiKey, httpAgent: groqHttpAgent })
 */
export const groqHttpAgent = new HttpsAgent({
  maxSockets: 5,
  keepAlive: true,
  keepAliveMsecs: 4_000,
  freeSocketTimeout: 4_000,      // 4 s — destroy idle sockets quickly
  timeout: 60_000,               // 60 s — active-socket read timeout
  rejectUnauthorized: true,
})

// ─── x402 Facilitator ─────────────────────────────────────────────────────────
// Called once per paid request to verify the Soroban auth entry.
// 4 sockets is sufficient; over-subscribing an external payment service is risky.

/**
 * Undici dispatcher for x402 facilitator fetch() calls.
 * Pass as `{ dispatcher: facilitatorAgent }` in fetch options.
 */
export const facilitatorAgent: Dispatcher = new Agent({
  connections: 4,
  pipelining: 1,
  keepAliveTimeout: 4_000,
  keepAliveMaxTimeout: 30_000,
  connect: {
    timeout: 5_000,
    rejectUnauthorized: true,
  },
  headersTimeout: 10_000,
  bodyTimeout: 10_000,
  maxRedirections: 2,
})

// ─── Stellar Horizon ──────────────────────────────────────────────────────────
// Used by the MCP server's check_balance tool (low-frequency, public REST API).

/**
 * Undici dispatcher for Stellar Horizon REST API fetch() calls.
 */
export const horizonAgent: Dispatcher = new Agent({
  connections: 4,
  pipelining: 1,
  keepAliveTimeout: 4_000,
  keepAliveMaxTimeout: 30_000,
  connect: {
    timeout: 5_000,
    rejectUnauthorized: true,
  },
  headersTimeout: 10_000,
  bodyTimeout: 10_000,
  maxRedirections: 2,
})

// ─── MCP → Express server (localhost) ────────────────────────────────────────
// The MCP server calls the StellarSearch Express server over localhost.
// No TLS; very low latency; a 2 s connect timeout is generous.

/**
 * Undici dispatcher for MCP server → Express server fetch() calls.
 */
export const mcpServerAgent: Dispatcher = new Agent({
  connections: 4,
  pipelining: 1,
  keepAliveTimeout: 4_000,
  keepAliveMaxTimeout: 30_000,
  connect: {
    timeout: 2_000,              // 2 s — localhost should be near-instant
  },
  headersTimeout: 10_000,
  bodyTimeout: 10_000,
  maxRedirections: 2,
})
