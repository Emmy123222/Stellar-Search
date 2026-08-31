#!/usr/bin/env node
/**
 * StellarSearch MCP Server
 *
 * Exposes tools for Claude Code (and any MCP client):
 *   - web_search:       pays 0.001 USDC via x402, returns Serper.dev results
 *   - ai_summarize:     uses Groq to summarise search results
 *   - check_balance:    reads live USDC balance from Stellar Horizon
 *
 * Setup: see README.md → "Claude Code / MCP Integration"
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import Groq from 'groq-sdk'
import dotenv from 'dotenv'
import { 
  HORIZON_URL, 
  USDC_ISSUER, 
  STELLAR_NETWORK,
  STELLAR_EXPERT_URL,
  AMOUNT_USDC
} from '../src/lib/constants'

dotenv.config()

const SERVER_URL = process.env.SEARCH_API_URL || 'http://localhost:3001'
const GROQ_API_KEY = process.env.GROQ_API_KEY!

const groq = new Groq({ apiKey: GROQ_API_KEY })

// ─── MCP server ───────────────────────────────────────────────────────────
const server = new Server(
  { name: 'stellar-search', version: '1.0.0' },
  { capabilities: { tools: {} } },
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

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  // ── web_search ────────────────────────────────────────────────────────
  if (name === 'web_search') {
    const { query, count = 5, freshness } = args as { query: string; count?: number; freshness?: string }

    try {
      const params = new URLSearchParams({ q: query, count: String(count) })
      if (freshness) params.set('freshness', freshness)

      // The server's x402 middleware handles the full payment flow.
      // In server-to-server mode the server needs a funded Stellar key.
      // For MCP usage we call the server which itself holds the paying wallet.
      const res = await fetch(`${SERVER_URL}/search?${params}`)

      if (!res.ok) {
        const e = await res.json().catch(() => ({}) as any) as any
        throw new Error(e.error || `HTTP ${res.status}`)
      }

      const data = await res.json() as any
      const formatted = data.results
        .map((r: any, i: number) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.description}`)
        .join('\n\n')

      return {
        content: [{
          type: 'text',
          text: [
            `🔍 Results for: "${query}"`,
            `💰 Paid: ${data.paidAmount} ${data.currency} on ${data.network}`,
            `⚡ Latency: ${data.latencyMs}ms`,
            `📊 ${data.count} results\n`,
            formatted,
          ].join('\n'),
        }],
      }
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Search failed: ${err.message}` }], isError: true }
    }
  }

  // ── image_search ──────────────────────────────────────────────────────
  if (name === 'image_search') {
    const { query, count = 5 } = args as { query: string; count?: number }

    try {
      const safeCount = Math.min(Math.max(parseInt(String(count)) || 5, 1), 10)
      const params = new URLSearchParams({ q: query, count: String(safeCount) })

      const res = await fetch(`${SERVER_URL}/images?${params}`)

      if (!res.ok) {
        const e: any = await res.json().catch(() => ({}))
        throw new Error(e.error || `HTTP ${res.status}`)
      }

      const data: any = await res.json()
      const formatted = data.results
        .map((r: any, i: number) => `${i + 1}. **${r.title}**\n   Image: ${r.imageUrl}\n   Source: ${r.sourceUrl} (${r.source})`)
        .join('\n\n')

      return {
        content: [{
          type: 'text',
          text: [
            `🖼️  Image results for: "${query}"`,
            `💰 Paid: ${data.paidAmount} ${data.currency} on ${data.network}`,
            `⚡ Latency: ${data.latencyMs}ms`,
            `📊 ${data.count} results\n`,
            formatted,
          ].join('\n'),
        }],
      }
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Image search failed: ${err.message}` }], isError: true }
    }
  }

  // ── news_search ───────────────────────────────────────────────────────
  if (name === 'news_search') {
    const { query, count = 10, freshness } = args as {
      query: string; count?: number; freshness?: string
    }

    try {
      const safeCount = Math.min(Math.max(parseInt(String(count)) || 10, 1), 20)
      const params = new URLSearchParams({ q: query, count: String(safeCount) })
      if (freshness) params.set('freshness', freshness)

      const res = await fetch(`${SERVER_URL}/news?${params}`)

      if (!res.ok) {
        const e: any = await res.json().catch(() => ({}))
        throw new Error(e.error || `HTTP ${res.status}`)
      }

      const data: any = await res.json()
      const formatted = data.results
        .map((r: any, i: number) => {
          const date = r.publishedAt ? ` · ${r.publishedAt}` : ''
          return `${i + 1}. **${r.title}** (${r.source}${date})\n   ${r.url}\n   ${r.snippet}`
        })
        .join('\n\n')

      return {
        content: [{
          type: 'text',
          text: [
            `📰 News results for: "${query}"`,
            `💰 Paid: ${data.paidAmount} ${data.currency} on ${data.network}`,
            `⚡ Latency: ${data.latencyMs}ms`,
            `📊 ${data.count} results\n`,
            formatted,
          ].join('\n'),
        }],
      }
    } catch (err: any) {
      return { content: [{ type: 'text', text: `News search failed: ${err.message}` }], isError: true }
    }
  }

  // ── ai_summarize ──────────────────────────────────────────────────────
  if (name === 'ai_summarize') {
    const { text, instruction = 'summarise' } = args as { text: string; instruction?: string }

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
      const res = await fetch(`${HORIZON_URL}/accounts/${address}`)
      if (res.status === 404) throw new Error(`Account not found on Stellar ${STELLAR_NETWORK.split(':')[1]}`)
      if (!res.ok) throw new Error(`Horizon returned ${res.status}`)

      const account = await res.json() as any
      let xlm = '0', usdc = '0'

      for (const b of account.balances) {
        if (b.asset_type === 'native') xlm = parseFloat(b.balance).toFixed(4)
        if (b.asset_type === 'credit_alphanum4' && b.asset_code === 'USDC' && b.asset_issuer === USDC_ISSUER) {
          usdc = parseFloat(b.balance).toFixed(6)
        }
      }

      const queries = Math.floor(parseFloat(usdc) / parseFloat(AMOUNT_USDC))
      return {
        content: [{
          type: 'text',
          text: [
            `💳 Stellar Account: ${address}`,
            `   USDC: ${usdc} (~${queries.toLocaleString()} searches remaining)`,
            `   XLM:  ${xlm}`,
            `   Network: ${STELLAR_NETWORK.split(':')[1]}`,
            `   Explorer: ${STELLAR_EXPERT_URL}/account/${address}`,
          ].join('\n'),
        }],
      }
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Balance check failed: ${err.message}` }], isError: true }
    }
  }

  // ── get_search_stats ──────────────────────────────────────────────────
  if (name === 'get_search_stats') {
    try {
      const res = await fetch(`${SERVER_URL}/health`)
      if (!res.ok) throw new Error(`Server health check returned ${res.status}`)

      const stats = await res.json() as any
      
      return {
        content: [{
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
        }],
      }
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Failed to fetch server stats: ${err.message}` }], isError: true }
    }
  }

  return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
})

const transport = new StdioServerTransport()
await server.connect(transport)
console.error('StellarSearch MCP server started')
