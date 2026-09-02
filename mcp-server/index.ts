#!/usr/bin/env node
/**
 * StellarSearch MCP Server
 *
 * Exposes tools for Claude Code (and any MCP client):
 *   - web_search:       pays 0.001 USDC via x402, returns Serper.dev results
 *   - image_search:     pays 0.001 USDC via x402, returns Serper.dev image results
 *   - news_search:      pays 0.001 USDC via x402, returns Serper.dev news results
 *   - ai_summarize:     uses Groq to summarise search results
 *   - check_balance:    reads live USDC balance from Stellar Horizon
 *   - get_search_stats: reads live server stats
 *
 * Additional MCP capabilities (issues #326, #327):
 *   - Resources: capability/schema docs + opted-in recent receipts
 *   - Prompts: research workflows that compose search+summarization without silently initiating payment
 *   - Progress: bounded notifications/progress events for paid searches (challenge→sign→settle→search)
 *   - Cancellation: clean abort without false completion
 *
 * Setup: see README.md → "Claude Code / MCP Integration"
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import Groq from 'groq-sdk'
import dotenv from 'dotenv'
import {
  HORIZON_URL, 
  USDC_ISSUER, 
  STELLAR_NETWORK,
  STELLAR_EXPERT_URL,
  AMOUNT_USDC,
  USDC_CONTRACT,
  AMOUNT_STROOPS,
} from '../src/lib/constants'
import { formatConfigurationError, readMcpConfig } from '../src/lib/config'

dotenv.config()

let config
try {
  config = readMcpConfig()
} catch (error) {
  console.error(formatConfigurationError(error))
  throw error
}
const SERVER_URL = config.searchApiUrl
const GROQ_API_KEY = config.groqApiKey

const groq = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : undefined

/** Clamp a search count to [min, max], falling back to defaultValue on NaN/fractional/negative. */
export function clampCount(
  value: unknown,
  { min, max, defaultValue }: { min: number; max: number; defaultValue: number },
): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < min) return defaultValue
  return Math.floor(Math.min(n, max))
}

// ─── Receipt store (opted-in, in-memory, capped) ──────────────────────────
export interface McpReceipt {
  id: string
  query: string
  txHash: string | null
  amount: string
  currency: string
  network: string
  timestamp: string
  latencyMs: number
  count: number
}

export const MAX_MCP_RECEIPTS = 50
export const mcpReceipts: McpReceipt[] = []
export const MCP_RECEIPTS_OPT_IN = process.env.MCP_ENABLE_RECEIPTS === '1' || process.env.MCP_RECEIPTS_OPT_IN === '1'

export function addMcpReceipt(r: McpReceipt): void {
  if (!MCP_RECEIPTS_OPT_IN) return
  mcpReceipts.unshift(r)
  if (mcpReceipts.length > MAX_MCP_RECEIPTS) mcpReceipts.pop()
}

export function clearMcpReceipts(): void {
  mcpReceipts.length = 0
}

// ─── Capability doc (shared with resources) ───────────────────────────────
export function getCapabilityDoc() {
  return {
    name: 'stellar-search',
    version: '1.0.0',
    network: STELLAR_NETWORK,
    pricePerQuery: `${AMOUNT_USDC} USDC`,
    currency: 'USDC',
    contract: USDC_CONTRACT,
    amountStroops: AMOUNT_STROOPS,
    payTo: process.env.STELLAR_RECEIVING_ADDRESS || 'G... (configure STELLAR_RECEIVING_ADDRESS)',
    facilitator: process.env.FACILITATOR_URL || 'https://www.x402.org/facilitator',
    endpoints: {
      'GET /search?q=<query>': `${AMOUNT_USDC} USDC via x402`,
      'GET /images?q=<query>': `${AMOUNT_USDC} USDC via x402 — images`,
      'GET /news?q=<query>': `${AMOUNT_USDC} USDC via x402 — news`,
      'POST /search/batch': `${AMOUNT_USDC} USDC per query, JSONL streaming (max 10, aggregate ${MAX_BATCH_SIZE * parseFloat(AMOUNT_USDC)} USDC)`,
      'POST /jobs': `${AMOUNT_USDC} USDC via x402, async job + webhook`,
      'GET /jobs/:id': 'job status + verified payment state',
      'POST /ai/chat': 'Groq AI — free',
      'GET /health': 'live stats',
    },
    mcpTools: ['web_search', 'image_search', 'news_search', 'ai_summarize', 'check_balance', 'get_search_stats'],
    mcpResources: ['stellar-search://capabilities', 'stellar-search://schema/search', 'stellar-search://receipts/recent'],
    mcpPrompts: ['research_brief', 'summarize_results', 'compare_sources'],
    x402: {
      scheme: 'exact',
      network: STELLAR_NETWORK,
      amount: AMOUNT_STROOPS,
      asset: USDC_CONTRACT,
    },
    receiptsOptIn: MCP_RECEIPTS_OPT_IN,
    timestamp: new Date().toISOString(),
  }
}

export function getSearchSchemaDoc() {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'StellarSearch SearchResponse',
    type: 'object',
    required: ['query', 'results', 'count', 'network', 'paidAmount', 'currency', 'latencyMs'],
    properties: {
      query: { type: 'string', description: 'Executed search query' },
      originalQuery: { type: 'string', description: 'Original user input query' },
      executedQuery: { type: 'string', description: 'Actual query executed against search index' },
      suggestedQuery: { type: 'string', description: 'Spelling correction or Did You Mean suggestion' },
      isCorrected: { type: 'boolean', description: 'True if executed query differs from original query' },
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            url: { type: 'string', format: 'uri' },
            description: { type: 'string' },
            source: { type: 'string' },
            relevanceScore: { type: 'number' },
          },
        },
      },
      count: { type: 'integer' },
      network: { type: 'string', enum: ['stellar:testnet', 'stellar:mainnet'] },
      paidAmount: { type: 'string', example: '0.001' },
      currency: { type: 'string', example: 'USDC' },
      txHash: { type: ['string', 'null'] },
      latencyMs: { type: 'integer' },
      suggestions: { type: 'array', items: { type: 'string' } },
    },
    batchJsonl: {
      version: 1,
      contentType: 'application/x-ndjson',
      events: ['quote', 'settlement', 'result', 'error', 'done'],
      limits: { maxBatchSize: 10, maxTotalUsdc: '0.01', idempotencyKey: 'header Idempotency-Key or body.idempotencyKey, 24h window' },
    },
    jobs: {
      create: 'POST /jobs { query, count, freshness, webhookUrl, webhookSecret, idempotencyKey } → 202 { jobId, statusUrl, paymentVerified }',
      status: 'GET /jobs/:id → { job, paymentVerified, statusUrl }',
      webhook: 'HMAC-SHA256 signature X-Webhook-Signature over timestamp.payload, retry with backoff, SSRF blocked (private IPs, http), replay protection via nonce+timestamp',
    },
  }
}

// ─── Progress helpers (issue #327) ────────────────────────────────────────
export const PROGRESS_TOTAL = 4
export type ProgressPhase = 'challenge' | 'signing' | 'settlement' | 'search'

const phaseToProgress: Record<ProgressPhase, number> = {
  challenge: 1,
  signing: 2,
  settlement: 3,
  search: 4,
}

async function sendProgress(
  serverInst: Server,
  progressToken: string | number | undefined,
  phase: ProgressPhase,
  message: string,
): Promise<void> {
  if (progressToken === undefined || progressToken === null) return
  const progress = phaseToProgress[phase]
  try {
    // MCP SDK supports server.notification for progress; fallback to sendNotification
    const srv: any = serverInst as any
    if (typeof srv.notification === 'function') {
      await srv.notification({
        method: 'notifications/progress',
        params: { progressToken, progress, total: PROGRESS_TOTAL, message },
      })
    } else if (typeof srv.sendNotification === 'function') {
      await srv.sendNotification({
        method: 'notifications/progress',
        params: { progressToken, progress, total: PROGRESS_TOTAL, message },
      })
    }
  } catch {
    // bounded: ignore progress delivery failures, never throw
  }
}

// Track abort controllers per tool call for cancellation
const pendingRequests = new Map<string | number, AbortController>()

// ─── MCP server ───────────────────────────────────────────────────────────
const server = new Server(
  { name: 'stellar-search', version: '1.0.0' },
  { capabilities: { tools: {}, resources: {}, prompts: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'web_search',
      description: `Search the web via StellarSearch. Automatically pays ${AMOUNT_USDC} USDC on Stellar (x402 protocol).
The server handles the full payment flow: HTTP 402 → sign Soroban auth → settle → return results.
Use for current events, documentation, research, or anything needing up-to-date web information.`,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          count: { type: 'number', description: 'Results count (1–10, default 5)', default: 5 },
          freshness: { type: 'string', enum: ['pd', 'pw', 'pm'], description: 'Age: pd=day, pw=week, pm=month' },
        },
        required: ['query'],
      },
    },
    {
      name: 'image_search',
      description: `Search the web for images via StellarSearch. Automatically pays ${AMOUNT_USDC} USDC on Stellar (x402 protocol).
Returns image URLs, titles, and source domains via the Serper.dev images API.
Use for visual references, photos, diagrams, or anything where you need image results.`,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Image search query' },
          count: { type: 'number', description: 'Results count (1–10, default 5)', default: 5 },
        },
        required: ['query'],
      },
    },
    {
      name: 'news_search',
      description: `Search recent news articles via StellarSearch. Automatically pays ${AMOUNT_USDC} USDC on Stellar (x402 protocol).
Returns articles with title, URL, snippet, publication date, and source via the Serper.dev news API.
Use for breaking stories, current events, and time-sensitive reporting.`,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'News search query' },
          count: { type: 'number', description: 'Results count (1–20, default 10)', default: 10 },
          freshness: { type: 'string', enum: ['pd', 'pw', 'pm'], description: 'Age: pd=day, pw=week, pm=month' },
        },
        required: ['query'],
      },
    },
    {
      name: 'ai_summarize',
      description: 'Use Groq (Llama 3) to summarise or analyse text. Free — no payment required.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to summarise or analyse' },
          instruction: { type: 'string', description: 'What to do with the text (e.g. "summarise", "extract key points")', default: 'summarise' },
        },
        required: ['text'],
      },
    },
    {
      name: 'check_balance',
      description: 'Check live USDC and XLM balance for a Stellar address from Horizon.',
      inputSchema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Stellar public key (G...)' },
        },
        required: ['address'],
      },
    },
    {
      name: 'get_search_stats',
      description: 'Get live statistics from the StellarSearch server (total queries, USDC settled, uptime, latencies).',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
  ],
}))

// ─── Resources (issue #326) ───────────────────────────────────────────────
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: 'stellar-search://capabilities',
      name: 'StellarSearch Capabilities',
      description: 'Server capabilities, network, price, x402 scheme, and endpoint map (no payment required)',
      mimeType: 'application/json',
    },
    {
      uri: 'stellar-search://schema/search',
      name: 'StellarSearch Search Schema',
      description: 'JSON schema for SearchResponse and batch/job contracts (no payment required)',
      mimeType: 'application/json',
    },
    {
      uri: 'stellar-search://receipts/recent',
      name: 'Recent Search Receipts (opted-in)',
      description: MCP_RECEIPTS_OPT_IN
        ? 'Recent paid search receipts (opted-in via MCP_ENABLE_RECEIPTS=1, capped at 50, no secrets)'
        : 'Receipts disabled — set MCP_ENABLE_RECEIPTS=1 to opt in',
      mimeType: 'application/json',
    },
  ],
}))

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params
  if (uri === 'stellar-search://capabilities') {
    return {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(getCapabilityDoc(), null, 2) }],
    }
  }
  if (uri === 'stellar-search://schema/search') {
    return {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(getSearchSchemaDoc(), null, 2) }],
    }
  }
  if (uri === 'stellar-search://receipts/recent') {
    if (!MCP_RECEIPTS_OPT_IN) {
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                error: 'Receipts not opted-in. Set MCP_ENABLE_RECEIPTS=1 and restart the MCP server to enable local receipt storage.',
                receipts: [],
                optIn: false,
              },
              null,
              2,
            ),
          },
        ],
      }
    }
    return {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ receipts: mcpReceipts, count: mcpReceipts.length, optIn: true }, null, 2) }],
    }
  }
  throw new Error(`Unknown resource: ${uri}`)
})

// ─── Prompts (issue #326, no silent payment) ──────────────────────────────
server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [
    {
      name: 'research_brief',
      description: 'Compose a research brief: outline queries, then (with explicit user approval) search and summarize. Does NOT silently pay.',
      arguments: [
        { name: 'topic', description: 'Research topic', required: true },
        { name: 'depth', description: 'Brief depth: quick | standard | deep', required: false },
      ],
    },
    {
      name: 'summarize_results',
      description: 'Summarize provided search results via Groq. Free — no payment. Expects results text pasted by user/agent.',
      arguments: [
        { name: 'results', description: 'Search results text to summarize', required: true },
        { name: 'instruction', description: 'Summarization instruction', required: false },
      ],
    },
    {
      name: 'compare_sources',
      description: 'Compare two or more sources/results and highlight agreements/disagreements. Free — no payment.',
      arguments: [
        { name: 'sources', description: 'Sources or results to compare', required: true },
        { name: 'question', description: 'Comparison question', required: false },
      ],
    },
  ],
}))

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  if (name === 'research_brief') {
    const topic = (args as any)?.topic || '[topic]'
    const depth = (args as any)?.depth || 'standard'
    return {
      description: 'Research brief workflow — requires explicit user approval before any paid search',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `You are a research assistant for topic: "${topic}" (depth: ${depth}).\n\nSteps (do NOT silently pay):\n1. Propose 3-5 search queries that would cover "${topic}".\n2. Ask the user to explicitly approve which queries to run (remind them each query costs ${AMOUNT_USDC} USDC via x402 on ${STELLAR_NETWORK}).\n3. ONLY after approval, call web_search for each approved query, then ai_summarize to synthesize a brief with citations.\n4. Present a concise brief with sources and next steps.\n\nAwait user approval before calling any paid tool.`,
          },
        },
      ],
    }
  }
  if (name === 'summarize_results') {
    const results = (args as any)?.results || '[paste results]'
    const instruction = (args as any)?.instruction || 'summarise with key points and citations'
    return {
      description: 'Summarize results via Groq (free)',
      messages: [
        { role: 'user', content: { type: 'text', text: `Please ${instruction} the following search results:\n\n${results}\n\nCall ai_summarize with the results and instruction. No payment is triggered by this prompt itself.` } },
      ],
    }
  }
  if (name === 'compare_sources') {
    const sources = (args as any)?.sources || '[paste sources]'
    const question = (args as any)?.question || 'What do they agree/disagree on?'
    return {
      description: 'Compare sources (free)',
      messages: [
        { role: 'user', content: { type: 'text', text: `Compare the following sources:\n\n${sources}\n\nQuestion: ${question}\n\nHighlight agreements, disagreements, and citations. Call ai_summarize (free) — do not initiate paid search without explicit user approval.` } },
      ],
    }
  }
  throw new Error(`Unknown prompt: ${name}`)
})

// ─── Tools with bounded progress + cancellation (issue #327) ───────────────
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  const meta: any = (request.params as any)?._meta
  const progressToken: string | number | undefined = meta?.progressToken
  // requestId for cancellation tracking (MCP JSON-RPC id if available)
  const requestId: string | number | undefined = (request as any).id ?? (request as any).params?._meta?.requestId
  const controller = new AbortController()
  const trackKey = requestId ?? progressToken ?? `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  if (progressToken !== undefined) pendingRequests.set(trackKey as any, controller)

  const cleanup = () => {
    if (progressToken !== undefined) pendingRequests.delete(trackKey as any)
  }

  // Helper to handle abort without false completion
  const isAborted = () => controller.signal.aborted

  // ── web_search with progress ──────────────────────────────────────────
  if (name === 'web_search') {
    const { query, count = 5, freshness } = args as { query: string; count?: number; freshness?: string }

    try {
      await sendProgress(server, progressToken, 'challenge', `Requesting payment challenge for "${query}"`)
      if (isAborted()) throw Object.assign(new Error('Request cancelled'), { code: 'CANCELLED' })

      await sendProgress(server, progressToken, 'signing', 'Signing Soroban auth via facilitator')
      if (isAborted()) throw Object.assign(new Error('Request cancelled'), { code: 'CANCELLED' })

      await sendProgress(server, progressToken, 'settlement', 'Settling 0.001 USDC on Stellar')
      if (isAborted()) throw Object.assign(new Error('Request cancelled'), { code: 'CANCELLED' })

      const safeCount = clampCount(count, { min: 1, max: 10, defaultValue: 5 })
      const params = new URLSearchParams({ q: query, count: String(safeCount) })
      if (freshness) params.set('freshness', freshness)
      await sendProgress(server, progressToken, 'search', `Searching Serper for "${query}"`)

      const res = await fetch(`${SERVER_URL}/search?${params}`, { signal: controller.signal })

      if (!res.ok) {
        const e = (await res.json().catch(() => ({ error: '' }))) as any
        throw new Error(e.error || `HTTP ${res.status}`)
      }

      const data = (await res.json()) as any
      // Record receipt (opted-in only, bounded)
      try {
        addMcpReceipt({
          id: data.txHash || `${Date.now()}-${query.slice(0, 8)}`,
          query,
          txHash: data.txHash ?? null,
          amount: data.paidAmount ?? AMOUNT_USDC,
          currency: data.currency ?? 'USDC',
          network: data.network ?? STELLAR_NETWORK,
          timestamp: new Date().toISOString(),
          latencyMs: data.latencyMs ?? 0,
          count: data.count ?? 0,
        })
      } catch {
        // ignore receipt recording failure
      }
      const formatted = (data.results as any[])
        .map((r: any, i: number) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.description}`)
        .join('\n\n')

      const headerLines: string[] = []
      if (data.isCorrected) {
        headerLines.push(`🔍 Results for: "${data.executedQuery}" (auto-corrected from "${data.originalQuery || query}")`)
      } else {
        headerLines.push(`🔍 Results for: "${data.executedQuery || query}"`)
      }
      if (data.suggestedQuery && !data.isCorrected) {
        headerLines.push(`💡 Did you mean: "${data.suggestedQuery}"?`)
      }
      headerLines.push(`💰 Paid: ${data.paidAmount} ${data.currency} on ${data.network}`)
      headerLines.push(`⚡ Latency: ${data.latencyMs}ms`)
      headerLines.push(`📊 ${data.count} results\n`)

      cleanup()
      return {
        content: [
          {
            type: 'text',
            text: [
              ...headerLines,
              formatted,
            ].join('\n'),
          },
        ],
      }
    } catch (err: any) {
      cleanup()
      if (err?.code === 'CANCELLED' || err?.name === 'AbortError' || isAborted()) {
        // Cancellation terminates progress cleanly without false completion
        return { content: [{ type: 'text', text: `Search cancelled: ${err.message}` }], isError: true }
      }
      return { content: [{ type: 'text', text: `Search failed: ${err.message}` }], isError: true }
    }
  }

  // ── image_search ──────────────────────────────────────────────────────
  if (name === 'image_search') {
    const { query, count = 5 } = args as { query: string; count?: number }

    try {
      await sendProgress(server, progressToken, 'challenge', `Requesting payment challenge for image search "${query}"`)
      if (isAborted()) throw Object.assign(new Error('Request cancelled'), { code: 'CANCELLED' })
      await sendProgress(server, progressToken, 'signing', 'Signing auth')
      if (isAborted()) throw Object.assign(new Error('Request cancelled'), { code: 'CANCELLED' })
      await sendProgress(server, progressToken, 'settlement', 'Settling image search payment')
      if (isAborted()) throw Object.assign(new Error('Request cancelled'), { code: 'CANCELLED' })
      await sendProgress(server, progressToken, 'search', `Searching images for "${query}"`)

      const safeCount = clampCount(count, { min: 1, max: 10, defaultValue: 5 })
      const params = new URLSearchParams({ q: query, count: String(safeCount) })

      const res = await fetch(`${SERVER_URL}/images?${params}`, { signal: controller.signal })

      if (!res.ok) {
        const e = (await res.json().catch(() => ({ error: '' }))) as any
        throw new Error(e.error || `HTTP ${res.status}`)
      }

      const data = (await res.json()) as any
      addMcpReceipt({
        id: data.txHash || `${Date.now()}-img-${query.slice(0, 6)}`,
        query,
        txHash: data.txHash ?? null,
        amount: data.paidAmount ?? AMOUNT_USDC,
        currency: data.currency ?? 'USDC',
        network: data.network ?? STELLAR_NETWORK,
        timestamp: new Date().toISOString(),
        latencyMs: data.latencyMs ?? 0,
        count: data.count ?? 0,
      })
      const formatted = (data.results as any[])
        .map((r: any, i: number) => `${i + 1}. **${r.title}**\n   Image: ${r.imageUrl}\n   Source: ${r.sourceUrl} (${r.source})`)
        .join('\n\n')

      cleanup()
      return {
        content: [
          {
            type: 'text',
            text: [
              `🖼️  Image results for: "${query}"`,
              `💰 Paid: ${data.paidAmount} ${data.currency} on ${data.network}`,
              `⚡ Latency: ${data.latencyMs}ms`,
              `📊 ${data.count} results\n`,
              formatted,
            ].join('\n'),
          },
        ],
      }
    } catch (err: any) {
      cleanup()
      if (err?.code === 'CANCELLED' || err?.name === 'AbortError' || isAborted()) {
        return { content: [{ type: 'text', text: `Image search cancelled: ${err.message}` }], isError: true }
      }
      return { content: [{ type: 'text', text: `Image search failed: ${err.message}` }], isError: true }
    }
  }

  // ── news_search ───────────────────────────────────────────────────────
  if (name === 'news_search') {
    const { query, count = 10, freshness } = args as {
      query: string
      count?: number
      freshness?: string
    }

    try {
      await sendProgress(server, progressToken, 'challenge', `Requesting payment challenge for news "${query}"`)
      if (isAborted()) throw Object.assign(new Error('Request cancelled'), { code: 'CANCELLED' })
      await sendProgress(server, progressToken, 'signing', 'Signing auth')
      if (isAborted()) throw Object.assign(new Error('Request cancelled'), { code: 'CANCELLED' })
      await sendProgress(server, progressToken, 'settlement', 'Settling news payment')
      if (isAborted()) throw Object.assign(new Error('Request cancelled'), { code: 'CANCELLED' })
      await sendProgress(server, progressToken, 'search', `Searching news for "${query}"`)

      const safeCount = clampCount(count, { min: 1, max: 20, defaultValue: 10 })
      const params = new URLSearchParams({ q: query, count: String(safeCount) })
      if (freshness) params.set('freshness', freshness)

      const res = await fetch(`${SERVER_URL}/news?${params}`, { signal: controller.signal })

      if (!res.ok) {
        const e = (await res.json().catch(() => ({ error: '' }))) as any
        throw new Error(e.error || `HTTP ${res.status}`)
      }

      const data = (await res.json()) as any
      addMcpReceipt({
        id: data.txHash || `${Date.now()}-news-${query.slice(0, 6)}`,
        query,
        txHash: data.txHash ?? null,
        amount: data.paidAmount ?? AMOUNT_USDC,
        currency: data.currency ?? 'USDC',
        network: data.network ?? STELLAR_NETWORK,
        timestamp: new Date().toISOString(),
        latencyMs: data.latencyMs ?? 0,
        count: data.count ?? 0,
      })
      const formatted = (data.results as any[])
        .map((r: any, i: number) => {
          const date = r.publishedAt ? ` · ${r.publishedAt}` : ''
          return `${i + 1}. **${r.title}** (${r.source}${date})\n   ${r.url}\n   ${r.snippet}`
        })
        .join('\n\n')

      cleanup()
      return {
        content: [
          {
            type: 'text',
            text: [
              `📰 News results for: "${query}"`,
              `💰 Paid: ${data.paidAmount} ${data.currency} on ${data.network}`,
              `⚡ Latency: ${data.latencyMs}ms`,
              `📊 ${data.count} results\n`,
              formatted,
            ].join('\n'),
          },
        ],
      }
    } catch (err: any) {
      cleanup()
      if (err?.code === 'CANCELLED' || err?.name === 'AbortError' || isAborted()) {
        return { content: [{ type: 'text', text: `News search cancelled: ${err.message}` }], isError: true }
      }
      return { content: [{ type: 'text', text: `News search failed: ${err.message}` }], isError: true }
    }
  }

  // ── ai_summarize ──────────────────────────────────────────────────────
  if (name === 'ai_summarize') {
    const { text, instruction = 'summarise' } = args as { text: string; instruction?: string }
    if (!groq) {
      return { content: [{ type: 'text', text: 'AI summarization is not configured.' }], isError: true }
    }

    try {
      const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'You are a concise research assistant. Be brief and accurate.' },
          { role: 'user', content: `Please ${instruction} the following:\n\n${text}` },
        ],
        max_tokens: 512,
        temperature: 0.5,
      })

      const content = completion.choices[0]?.message?.content || 'No response.'
      return { content: [{ type: 'text', text: content }] }
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Groq error: ${err.message}` }], isError: true }
    }
  }

  // ── check_balance ─────────────────────────────────────────────────────
  if (name === 'check_balance') {
    const { address } = args as { address: string }

    try {
      const res = await fetch(`${HORIZON_URL}/accounts/${address}`, { signal: controller.signal })
      if (res.status === 404) throw new Error(`Account not found on Stellar ${STELLAR_NETWORK.split(':')[1]}`)
      if (!res.ok) throw new Error(`Horizon returned ${res.status}`)

      const account = (await res.json()) as any
      let xlm = '0',
        usdc = '0'

      for (const b of account.balances) {
        if (b.asset_type === 'native') xlm = parseFloat(b.balance).toFixed(4)
        if (b.asset_type === 'credit_alphanum4' && b.asset_code === 'USDC' && b.asset_issuer === USDC_ISSUER) {
          usdc = parseFloat(b.balance).toFixed(6)
        }
      }

      const queries = Math.floor(parseFloat(usdc) / parseFloat(AMOUNT_USDC))
      cleanup()
      return {
        content: [
          {
            type: 'text',
            text: [
              `💳 Stellar Account: ${address}`,
              `   USDC: ${usdc} (~${queries.toLocaleString()} searches remaining)`,
              `   XLM:  ${xlm}`,
              `   Network: ${STELLAR_NETWORK.split(':')[1]}`,
              `   Explorer: ${STELLAR_EXPERT_URL}/account/${address}`,
            ].join('\n'),
          },
        ],
      }
    } catch (err: any) {
      cleanup()
      if (err?.name === 'AbortError' || isAborted()) {
        return { content: [{ type: 'text', text: `Balance check cancelled` }], isError: true }
      }
      return { content: [{ type: 'text', text: `Balance check failed: ${err.message}` }], isError: true }
    }
  }

  // ── get_search_stats ──────────────────────────────────────────────────
  if (name === 'get_search_stats') {
    try {
      const res = await fetch(`${SERVER_URL}/health`, { signal: controller.signal })
      if (!res.ok) throw new Error(`Server health check returned ${res.status}`)

      const stats = (await res.json()) as any

      cleanup()
      return {
        content: [
          {
            type: 'text',
            text: [
              `📊 StellarSearch Server Stats`,
              `   Status:           ${stats.status.toUpperCase()}`,
              `   Network:          ${stats.network}`,
              `   Uptime:           ${stats.uptime}`,
              `   Total Queries:    ${stats.totalQueries.toLocaleString()}`,
              `   USDC Settled:     ${stats.totalUsdcSettled} USDC`,
              `   Avg Latency:      ${stats.avgLatencyMs}ms`,
              `   Price per Query:  ${stats.pricePerQuery}`,
              `   Facilitator:      ${stats.facilitator}`,
              `   APIs Configured:  Serper: ${stats.serperApiConfigured ? '✅' : '❌'}, Groq: ${stats.groqApiConfigured ? '✅' : '❌'}`,
            ].join('\n'),
          },
        ],
      }
    } catch (err: any) {
      cleanup()
      if (err?.name === 'AbortError' || isAborted()) {
        return { content: [{ type: 'text', text: `Stats fetch cancelled` }], isError: true }
      }
      return { content: [{ type: 'text', text: `Failed to fetch server stats: ${err.message}` }], isError: true }
    }
  }

  cleanup()
  return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
})

// ─── Handle cancellation notifications gracefully ───────────────────────
try {
  const protoAny: any = server as any
  if (typeof protoAny.setNotificationHandler === 'function') {
    const { CancelledNotificationSchema } = await import('@modelcontextprotocol/sdk/types.js').catch(() => ({ CancelledNotificationSchema: null }))
    if (CancelledNotificationSchema) {
      protoAny.setNotificationHandler(CancelledNotificationSchema, async (notification: any) => {
        const requestId = notification.params?.requestId
        const controller = pendingRequests.get(requestId)
        if (controller) {
          controller.abort()
          pendingRequests.delete(requestId)
        }
      })
    }
  }
} catch {
  // ignore cancellation handler registration error
}

const transport = new StdioServerTransport()
await server.connect(transport)
console.error('StellarSearch MCP server started')

export { server }
