# StellarSearch MCP Server

The StellarSearch Model Context Protocol (MCP) server allows AI agents (such as Claude Code, Cursor, Windsurf, or custom MCP clients) to perform real-time, pay-per-query web searches metered on Stellar via the **x402 payment protocol**.

## Tools Overview

| Tool | Type | Cost (Stellar) | Description |
|---|---|---|---|
| `web_search` | Paid | 0.001 USDC | Real-time web search with titles, URLs, descriptions, and AI suggestions |
| `image_search` | Paid | 0.001 USDC | Web image search with image URLs, dimensions, and source domains |
| `news_search` | Paid | 0.001 USDC | Recent news article search with publication timestamps and sources |
| `check_balance` | Free | 0 XLM | Check live USDC and XLM balance for any Stellar account from Horizon |
| `get_search_stats` | Free | 0 XLM | Live operational and financial statistics from the StellarSearch server |
| `ai_summarize` | Free | 0 XLM | Summarize and extract key points using Groq (Llama 3.3) |

---

## Dual Output Format: Text + structuredContent (#171)

All search, balance, and stats tools return **dual output** for maximum compatibility and agent ergonomics:

1. **`content` (Human-Readable Markdown):**
   A concise text block formatted in Markdown for human reading and direct LLM rendering. Backward compatible with all existing MCP consumers.

2. **`structuredContent` (Machine-Readable JSON):**
   A strictly typed JSON object matching the tool's published `outputSchema`. Eliminates the need for agents to parse URLs, titles, payment fields, or balances out of Markdown strings with regex.

---

## Tool Schemas & structuredContent Specifications

### 1. `web_search`
Search the web for current documentation, research, or news. Automatically settled via x402 on Stellar.

- **Inputs:**
  - `query` (`string`, required): Search terms.
  - `count` (`number`, optional, 1–10, default: `5`): Result count.
  - `freshness` (`string`, optional, `pd` \| `pw` \| `pm`): Past day, past week, or past month.

- **`structuredContent` Payload:**
```json
{
  "query": "stellar soroban smart contracts",
  "count": 5,
  "results": [
    {
      "id": "res-1",
      "title": "Soroban Documentation",
      "url": "https://soroban.stellar.org/docs",
      "description": "Smart contracts platform on the Stellar network...",
      "source": "stellar.org",
      "relevanceScore": 0.98
    }
  ],
  "payment": {
    "paidAmount": "0.001",
    "currency": "USDC",
    "network": "stellar:testnet",
    "txHash": "a1b2c3d4e5..."
  },
  "paidAmount": "0.001",
  "currency": "USDC",
  "network": "stellar:testnet",
  "txHash": "a1b2c3d4e5...",
  "latencyMs": 135,
  "suggestions": ["soroban rust sdk", "soroban contract deployment"]
}
```

---

### 2. `image_search`
Search for visual references, photos, and diagrams.

- **Inputs:**
  - `query` (`string`, required): Search terms.
  - `count` (`number`, optional, 1–10, default: `5`): Number of images.

- **`structuredContent` Payload:**
```json
{
  "query": "stellar lumens logo",
  "count": 5,
  "results": [
    {
      "id": "img-1",
      "title": "Stellar Lumens Logo Vector",
      "imageUrl": "https://example.com/logo.png",
      "thumbnailUrl": "https://example.com/thumb.png",
      "sourceUrl": "https://stellar.org/brand",
      "source": "stellar.org",
      "width": 800,
      "height": 600
    }
  ],
  "payment": {
    "paidAmount": "0.001",
    "currency": "USDC",
    "network": "stellar:testnet",
    "txHash": "f6e5d4..."
  },
  "paidAmount": "0.001",
  "currency": "USDC",
  "network": "stellar:testnet",
  "txHash": "f6e5d4...",
  "latencyMs": 95
}
```

---

### 3. `news_search`
Search recent news articles with publication dates and sources.

- **Inputs:**
  - `query` (`string`, required): Search terms.
  - `count` (`number`, optional, 1–20, default: `10`): Article count.
  - `freshness` (`string`, optional, `pd` \| `pw` \| `pm`): Past day, past week, or past month.

- **`structuredContent` Payload:**
```json
{
  "query": "stellar protocol upgrade",
  "count": 10,
  "results": [
    {
      "id": "news-1",
      "title": "Stellar Upgrades to Protocol 21",
      "url": "https://news.stellar.org/protocol-21",
      "snippet": "Validators have successfully upgraded the network...",
      "source": "Stellar Development Foundation",
      "publishedAt": "2 days ago",
      "imageUrl": "https://news.stellar.org/banner.jpg"
    }
  ],
  "payment": {
    "paidAmount": "0.001",
    "currency": "USDC",
    "network": "stellar:testnet",
    "txHash": "c3d2e1..."
  },
  "paidAmount": "0.001",
  "currency": "USDC",
  "network": "stellar:testnet",
  "txHash": "c3d2e1...",
  "latencyMs": 112
}
```

---

### 4. `check_balance`
Check live balances for any Stellar address from Horizon.

- **Inputs:**
  - `address` (`string`, required): Stellar public key (`G...`).

- **`structuredContent` Payload:**
```json
{
  "address": "GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3",
  "usdcBalance": "3.500000",
  "xlmBalance": "45.1234",
  "searchesRemaining": 3500,
  "network": "testnet",
  "issuer": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  "explorerUrl": "https://stellar.expert/explorer/testnet/account/GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3",
  "timestamp": "2026-09-30T11:30:00.000Z"
}
```

---

### 5. `get_search_stats`
Inspect live server operations, latency, and cumulative settlement statistics.

- **Inputs:** None.

- **`structuredContent` Payload:**
```json
{
  "status": "ok",
  "network": "stellar:testnet",
  "pricePerQuery": "0.001 USDC",
  "protocol": "x402",
  "facilitator": "https://www.x402.org/facilitator",
  "totalQueries": 4200,
  "totalUsdcSettled": "4.2000",
  "avgLatencyMs": 95,
  "uptime": "3d 12h",
  "serperApiConfigured": true,
  "groqApiConfigured": true,
  "receivingAddressConfigured": true
}
```

---

## Configuration

Add the server to your MCP configuration (e.g. `~/.claude/claude_desktop_config.json` or `claude_mcp.json`):

```json
{
  "mcpServers": {
    "stellar-search": {
      "command": "npx",
      "args": ["tsx", "./mcp-server/index.ts"],
      "env": {
        "GROQ_API_KEY": "your_groq_api_key",
        "SEARCH_API_URL": "http://localhost:3001"
      }
    }
  }
}
```
