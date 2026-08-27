# 🔍 StellarSearch — Pay-Per-Query Web Search for AI Agents

> **Stellar Hackathon 2026 · Agents on Stellar**
> Zero mock data. Real x402 payments. Real Serper.dev Search. Real Groq AI. Real Freighter wallet.

---

## What it is

StellarSearch is a pay-per-query web search API for autonomous AI agents. Every search costs **0.001 USDC**, settled on Stellar in ~5 seconds using the x402 protocol. No subscriptions, no API keys for the end user — agents pay per request and get real web search results back.

---

## Real stack (no mocks)

| Layer | Real package / service |
|---|---|
| Payment protocol | `@x402/express` + `@x402/stellar` + `@x402/core` |
| Blockchain | Stellar Testnet (via Horizon API) |
| Facilitator | OpenZeppelin x402 (`channels.openzeppelin.com`) |
| Wallet connect | `@stellar/freighter-api` (real Freighter extension) |
| Balances / tx | Stellar Horizon REST API (live, not mocked) |
| Search results | Serper.dev API (real Google search results) |
| AI assistant | `groq-sdk` · Llama 3.3 70B (real Groq API) |
| Frontend | React 18, TypeScript, Tailwind CSS, Framer Motion |

---

## Setup

### 1. Clone and install

```bash
git clone <this-repo>
cd stellar-search
npm install
```

### 2. Get your keys (all free)

| Key | Where to get it |
|---|---|
| `STELLAR_RECEIVING_ADDRESS` | [Stellar Lab](https://laboratory.stellar.org/#account-creator?network=test) — generate + fund testnet keypair |
| `OPENZEPPELIN_API_KEY` | [channels.openzeppelin.com/testnet/gen](https://channels.openzeppelin.com/testnet/gen) |
| `SERPER_API_KEY` | [serper.dev](https://serper.dev/) — free tier: 2.5k queries/month |
| `GROQ_API_KEY` | [console.groq.com/keys](https://console.groq.com/keys) — free |

### 3. Configure

```bash
cp .env.example .env
# Fill in the 5 keys above
```

### 4. Install Freighter

Install the [Freighter browser extension](https://freighter.app), create a testnet wallet, and fund it with USDC at [Stellar Lab](https://laboratory.stellar.org).

### 5. Run

```bash
# Terminal 1 — backend
npm run server

# Terminal 2 — frontend
npm run dev
# → http://localhost:5173
```

### 6. Test the x402 flow

```bash
npm run test:search "Stellar blockchain"
```

---

## How the x402 payment flow works

```
Browser (Freighter) → GET /search?q=...
                     ← HTTP 402 + payment requirements
                     → Sign Soroban auth entry (Freighter prompt)
                     → GET /search + X-Payment: <signature>
                     ← OpenZeppelin facilitator verifies + settles 0.001 USDC
                     ← 200 OK + Search results
```

1. Agent hits `/search` — the `@x402/express` middleware intercepts
2. Returns `HTTP 402 Payment Required` with price + network + payTo address
3. The x402 client signs a Soroban authorization entry via Freighter wallet
4. Retries with `X-Payment` header containing the signed entry
5. OpenZeppelin facilitator at `channels.openzeppelin.com/x402/testnet` verifies the signature and settles 0.001 USDC on Stellar testnet
6. Server receives confirmation and returns search results

### Sequence diagram

```mermaid
sequenceDiagram
    autonumber
    actor User as User / Agent
    participant Browser as Browser
    participant Freighter as Freighter Wallet
    participant Server as StellarSearch Server
    participant Facilitator as x402 Facilitator
    participant Horizon as Stellar Horizon
    participant Serper as Serper.dev

    User->>Browser: Enter search query
    Browser->>Server: GET /search?q=...
    Server-->>Browser: 402 Payment Required<br/>(price, network, payTo)
    Browser->>Freighter: Request signature of<br/>Soroban auth entry
    Freighter-->>Browser: Signed payment payload
    Browser->>Server: GET /search?q=...<br/>+ X-Payment header
    Server->>Facilitator: Verify X-Payment (HTTPFacilitatorClient)
    Facilitator->>Horizon: Submit & settle 0.001 USDC tx
    Horizon-->>Facilitator: Transaction confirmed (tx hash)
    Facilitator-->>Server: Verification + X-Payment-Response
    Server->>Serper: POST https://google.serper.dev/search
    Serper-->>Server: Real Google search results
    Server-->>Browser: 200 OK + results + txHash
    Browser-->>User: Display paid search results
```

---

## Project structure

```
stellar-search/
├── src/                        # React frontend
│   ├── hooks/
│   │   ├── useFreighterWallet.ts   # Real Freighter + Horizon integration
│   │   └── useSearch.ts            # Calls real server endpoint
│   ├── components/
│   │   ├── AnimatedBackground.tsx  # Canvas animation
│   │   ├── WalletPanel.tsx         # Real Freighter connect + live balances
│   │   ├── PaymentFlowVisualizer.tsx
│   │   ├── SearchResults.tsx
│   │   ├── StatsGrid.tsx           # Polls real /health endpoint
│   │   └── GroqAssistant.tsx       # Real Groq AI chat
│   ├── pages/
│   │   ├── SearchPage.tsx
│   │   ├── DocsPage.tsx
│   │   └── DashboardPage.tsx       # Live Horizon tx history
│   └── lib/stellar.ts              # Horizon helpers
├── server/
│   └── index.ts                # Express + @x402/express + Serper.dev + Groq
├── mcp-server/
│   └── index.ts                # MCP tools: web_search, ai_summarize, check_balance
├── scripts/
│   └── test-search.ts          # End-to-end test script
├── .env.example
├── claude_mcp.json
└── README.md
```

---

## Claude Code / MCP integration

```json
// claude_mcp.json
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

Then tell Claude Code: `"Search for the latest Stellar x402 examples"` — it calls `web_search`, the server pays via x402, and Claude gets real results.

---

## Hackathon requirements

| Requirement | ✓ |
|---|---|
| Open-source repo + README | ✅ |
| 2–3 min video demo | Record showing: connect Freighter → search → see 402 → payment settles → results |
| Real Stellar testnet transactions | ✅ Every search settles 0.001 USDC via OpenZeppelin facilitator |
| x402 protocol | ✅ `@x402/express` + `@x402/stellar` |
| Addresses explicit demand signal | ✅ "pay-per-query web search instead of monthly subscriptions" |
