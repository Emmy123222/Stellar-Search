# 🔍 StellarSearch — Pay-Per-Query Web Search for AI Agents

[![CI](https://github.com/Emmy123222/Stellar-Search/actions/workflows/ci.yml/badge.svg)](https://github.com/Emmy123222/Stellar-Search/actions/workflows/ci.yml)

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
| `SERPER_API_KEY` | [serper.dev](https://serper.dev/) — free tier: 2.5k queries/month |
| `GROQ_API_KEY` | [console.groq.com/keys](https://console.groq.com/keys) — free |

### 3. Configure

```bash
cp .env.example .env
# Fill in the 3 keys above (plus optional variables — see Environment Variables table below)
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

## Environment Variables

All environment variables are read from `.env` (see `.env.example` for a template). Variables prefixed with `VITE_` are exposed to the browser by Vite; all others are server-side only.

| Variable | Required | Default | Description | Example |
|---|---|---|---|---|
| `SERPER_API_KEY` | **Yes** | — | API key for [Serper.dev](https://serper.dev/) web search. Without this, all search, image, and news endpoints return `500`. | `your_serper_api_key_here` |
| `GROQ_API_KEY` | **Yes** | — | API key for [Groq](https://console.groq.com/keys) AI (Llama 3). Without this, the AI assistant and search suggestions fail with an auth error. Server prints `GROQ: ✗ MISSING` on startup. | `gsk_xxxxxxxxxxxxxxxxxxxxxxxx` |
| `STELLAR_RECEIVING_ADDRESS` | **Yes** | — | Stellar public key that receives 0.001 USDC per query. Without this, the x402 payment middleware has no `payTo` address and payments fail. Server prints `Receiving: ✗ MISSING` on startup. | `GDXA3V2LI3VN3GBH5BMOF25QSFJV7S7ZOWMHHQMJRPP4BVORDDRTIIMU` |
| `STELLAR_NETWORK` | No | `stellar:testnet` | Stellar network for the server-side x402 middleware. Accepts `stellar:testnet` or `stellar:mainnet`. Falls back to testnet if missing. | `stellar:testnet` |
| `VITE_STELLAR_NETWORK` | No | `stellar:testnet` | Frontend copy of `STELLAR_NETWORK` (must be prefixed `VITE_` for browser access). Falls back to testnet if missing. | `stellar:testnet` |
| `FACILITATOR_URL` | No | `https://www.x402.org/facilitator` | x402 facilitator endpoint for payment settlement. Falls back to the public OpenZeppelin facilitator if missing. | `https://www.x402.org/facilitator` |
| `PORT` | No | `3001` | Express server listen port. Falls back to `3001` if missing. | `3001` |
| `VITE_SERVER_URL` | No | `http://localhost:3001` | Frontend URL for AI chat backend calls. On Vercel deployments auto-detects `${origin}/api`; locally falls back to `http://localhost:3001`. | `http://localhost:3001` |
| `PUBLIC_BASE_URL` | No | Request origin | Canonical public origin used in x402 discovery metadata. Set this when a proxy or serverless platform cannot provide the public host reliably. | `https://search.example.com` |

---

## x402 service discovery

Autonomous clients can fetch [`/.well-known/x402`](http://localhost:3001/.well-known/x402) without payment to discover the paid resources before making a request. Express and Vercel serve the same runtime-generated document; Vercel rewrites the stable root path to its serverless handler.

The document includes `resourceTemplates` for `/search`, `/images`, and `/news`, plus the active `networks`, Soroban USDC `assets`, supported payment `schemes`, and a `priceDiscoveryUrl`. Each template carries the exact x402 payment option, including the configured receiving address, network, asset, and `10000` stroop (`0.001 USDC`) price. The metadata is intentionally public and does not bypass payment, approval, signature verification, replay protection, or settlement on paid routes.

The response is cacheable for five minutes. Set `PUBLIC_BASE_URL` to keep `priceDiscoveryUrl` canonical behind a reverse proxy.

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
6. Server enforces payment integrity (`src/lib/paymentIntegrity.ts`), rejecting replayed or duplicate payloads within the 300-second validity window, and returns search results

### Payment Integrity & Replay Protection

To guarantee that each payment identifier authorizes **exactly one provider call**, StellarSearch tracks consumed payment identifiers across Express (`server/index.ts`) and Vercel (`api/search.ts`) runtimes:
- **Payload Invalidation:** Extracts transaction hashes (or SHA-256 fallback hashes of payment headers) and invalidates consumed payloads for a 300-second window.
- **Concurrency Throttling:** Rapid parallel requests using identical payment payloads are throttled so only one search query proceeds; concurrent duplicates immediately receive HTTP 402 (`Payment payload already consumed`).

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

## Testing & Coverage

Coverage is enforced via **Vitest + @vitest/coverage-v8** with thresholds for **statements, branches, functions, and lines** (see `vite.config.ts:6`).

```bash
npm run test              # unit tests without coverage
npm run test:coverage     # run with coverage + thresholds (CI gate)
```

Reports are generated to `coverage/` (`text`, `json`, `html`, `lcov`). CI uploads the `coverage/` artifact and fails if thresholds are not met.

### Current thresholds (ratchet upward)

Global thresholds are deliberately modest initially and ratchet upward as payment/wallet/API/MCP/UI tests land:

| Scope | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| **Global** | 35% | 30% | 28% | 35% |
| `src/lib/constants.ts` | 90% | 60% | 100% | 90% |
| `src/lib/stellar.ts` | 85% | 75% | 85% | 85% |
| `src/lib/paymentIntegrity.ts` | 90% | 85% | 95% | 90% |
| `server/corsConfig.ts` | 90% | 85% | 95% | 90% |
| `src/components/search/SearchBar.tsx` | 80% | 80% | 90% | 80% |
| `server/index.ts` | 65% | 60% | 65% | 65% |
| `api/search.ts` | 90% | 75% | 80% | 90% |
| `api/health.ts` | 80% | 50% | 100% | 80% |
| `mcp-server/index.ts` | 30% | 20% | 20% | 30% |
| `src/hooks/useFreighterWallet.ts` | 85% | 65% | 90% | 85% |

> **Ratchet policy:** When a module's real coverage exceeds its threshold, bump the threshold in `vite.config.ts` in the same PR. Global thresholds ratchet `15 → 25 → 35` as payment, wallet, API, MCP, and UI behavior moves from untested to tested. Keep Express (`server/`), Vercel (`api/`), browser (`src/`), and MCP (`mcp-server/`) constants aligned (`STELLAR_NETWORK`, `USDC_CONTRACT`, `AMOUNT_STROOPS=10000` → `0.001 USDC`).

Coverage verifies the **x402 settlement semantics** for paid routes (`/search`, `/images`, `/news`): `scheme=exact`, `network=stellar:testnet|mainnet`, `amount=10000 stroops`, `asset=C...` (Soroban USDC contract, not `USDC:ISSUER`), `payTo=G...`. See `server/index.ts:104`, `api/search.ts:48`, and `mcp-server/index.ts:19`.

---

## Hackathon requirements

| Requirement | ✓ |
|---|---|
| Open-source repo + README | ✅ |
| 2–3 min video demo | Record showing: connect Freighter → search → see 402 → payment settles → results |
| Real Stellar testnet transactions | ✅ Every search settles 0.001 USDC via OpenZeppelin facilitator |
| x402 protocol | ✅ `@x402/express` + `@x402/stellar` |
| Addresses explicit demand signal | ✅ "pay-per-query web search instead of monthly subscriptions" |
