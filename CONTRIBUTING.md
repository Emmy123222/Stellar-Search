# Contributing to StellarSearch

<<<<<<< HEAD
Thanks for contributing to StellarSearch. This guide covers the local setup, the wallet and Stellar testnet requirements, and the conventions used for pull requests.
=======
Thank you for taking the time to contribute! StellarSearch is an open-source, pay-per-query web search API built on the Stellar blockchain using the x402 payment protocol. Every improvement — from a one-line typo fix to a full feature implementation — is welcome.

This document covers everything you need to go from zero to a merged pull request.

---

## Table of Contents

1. [Code of Conduct](#code-of-conduct)
2. [Project Overview](#project-overview)
3. [Prerequisites](#prerequisites)
4. [Local Development Setup](#local-development-setup)
5. [Project Structure](#project-structure)
6. [Development Workflow](#development-workflow)
7. [Submitting a Pull Request](#submitting-a-pull-request)
8. [Issue Guidelines](#issue-guidelines)
9. [Coding Standards](#coding-standards)
10. [Testing](#testing)
11. [Supply-Chain Security](#supply-chain-security)
12. [Common Pitfalls](#common-pitfalls)
13. [Getting Help](#getting-help)
14. [Recognition](#recognition)

---

## Code of Conduct

By participating in this project you agree to treat all contributors with respect. Harassment, discrimination, or hostile behaviour of any kind will not be tolerated. Be constructive, be kind, assume good intent.

---

## Project Overview

```
Browser (Freighter wallet)
    │
    │  1. GET /search?q=...
    ▼
Express Server  ──── @x402/express middleware ────►  HTTP 402 + payment requirements
    │                                                        │
    │  3. Retry with X-Payment header                        │ 2. User signs via Freighter
    ▼                                                        ▼
x402 Facilitator (x402.org)  ──── verify + settle ────►  Stellar Testnet (0.001 USDC)
    │
    ▼
Serper.dev  ──── real Google results ────►  Browser
```

**Core packages:**

| Package | Role |
|---|---|
| `@x402/express` | HTTP 402 payment middleware |
| `@x402/stellar` | Stellar-specific x402 scheme |
| `@x402/fetch` | Client-side x402 fetch wrapper |
| `@stellar/freighter-api` | Browser wallet signing |
| `@stellar/stellar-sdk` | Horizon API client |
| `groq-sdk` | Groq AI (Llama 3.3 70B) |
| `serper.dev` | Real-time Google search results |

---
>>>>>>> 7804e9c (feat(ci): generate CycloneDX SBOM and gate dependency vulnerabilities)

## Prerequisites

Install or prepare the following before you begin:

- **Node.js** (an active LTS release is recommended) and npm.
- **Freighter**, the browser wallet extension, installed from [freighter.app](https://www.freighter.app/).
- A Freighter account configured for the **Stellar Testnet**. Do not use a mainnet account for local development.
- Testnet XLM to pay transaction fees. Create and fund a testnet account through [Stellar Laboratory](https://laboratory.stellar.org/#account-creator?network=test).
- A testnet USDC balance for exercising the paid search flow. See [Getting free testnet USDC](#getting-free-testnet-usdc).
- API keys for Serper.dev and Groq if you want to run the backend search and AI features. Their free tiers are sufficient for development.

## Local development setup

1. Clone the repository and enter the project directory:

   ```bash
   git clone <repository-url>
   cd stellar-search
   ```

2. Install the locked dependency set:

   ```bash
   npm ci
   ```

3. Create your local environment file:

   ```bash
   cp .env.example .env
   ```

   Fill in the values in `.env`. At minimum, configure `STELLAR_RECEIVING_ADDRESS`, `SERPER_API_KEY`, and `GROQ_API_KEY` for the complete application. Keep `.env` local and never commit secrets.

4. In Freighter, switch the network to **Testnet**, unlock the wallet, and allow the local application to connect when prompted.

5. Start the backend and frontend in separate terminals:

   ```bash
   # Terminal 1
   npm run server

   # Terminal 2
   npm run dev
   ```

6. Open [http://localhost:5173](http://localhost:5173) in your browser. The backend runs at [http://localhost:3001](http://localhost:3001). Check its health endpoint at [http://localhost:3001/health](http://localhost:3001/health).

You can also start both processes together with:

```bash
npm run dev:all
```

To exercise the search flow from the command line, run:

```bash
npm run test:search "Stellar blockchain"
```

## Running the frontend without a real wallet

You can work on the visual interface without Freighter, a funded account, or real payments:

```bash
npm run dev
```

Visit [http://localhost:5173](http://localhost:5173) and work on components that do not require a completed wallet transaction. Wallet-dependent actions may show a connection or payment error until Freighter is installed and configured. Do not add mock payment or search data to make those flows appear successful; use the real testnet setup when testing them end to end.

## Getting free testnet USDC

1. Create or fund a Stellar Testnet account in [Stellar Laboratory](https://laboratory.stellar.org/#account-creator?network=test). Save the public address in Freighter.
2. Make sure Freighter is set to **Testnet** and the account is unlocked.
3. Add the **USDC trustline** to the account if the faucet requires it. Use the testnet USDC asset issued by the faucet/provider, not a mainnet asset.
4. Request testnet USDC from the [Circle testnet USDC faucet](https://faucet.circle.com/), selecting Stellar Testnet and entering your public address. Follow the faucet's current instructions and limits.
5. Verify the USDC balance in Freighter or on [Stellar Expert Testnet](https://stellar.expert/explorer/testnet/).

Testnet assets have no real-world value. Never share your secret key or seed phrase, and never use production funds while developing.

## Code style

- Keep TypeScript strict and preserve the compiler settings in the repository.
- Use the existing React and TypeScript patterns before introducing a new abstraction.
- Use Tailwind CSS utility classes for styling. **Do not add inline styles.**
- Keep changes focused and avoid unrelated formatting, refactors, or dependency updates.
- Use clear names and handle errors explicitly, especially around wallet, network, and payment operations.
- Run the relevant checks before opening a pull request. At minimum, run `npm run build`; also run the applicable search scripts when changing the backend or search flow.

## Pull requests

### Branches and commits

Create a focused branch from the default branch. Prefer names such as:

```text
fix/issue-123
feat/wallet-history
chore/update-docs
```

Use concise conventional-style commit subjects, for example:

```text
fix: handle rejected Freighter signatures
```

### PR naming convention

Use the same conventional prefix in the pull request title:

```text
<type>: <short imperative description>
```

Common types are `feat`, `fix`, `docs`, `refactor`, `test`, and `chore`. Keep the title specific, concise, and focused on one change.

### PR checklist

Before requesting review:

- Explain what changed and why.
- Link the relevant issue, using `Closes #<number>` when the PR completes it.
- Describe any setup or environment changes required to test the PR.
- Include the exact verification commands you ran and their results.
- Keep secrets, `.env` files, generated output, and unrelated changes out of the PR.
- Confirm that the change works on Stellar Testnet when it touches wallet or payment behavior.

<<<<<<< HEAD
Please keep reviews constructive and update the PR when feedback is addressed.
=======
2. Open a PR against `main` on GitHub.

3. Fill in the PR template:
   - **What does this PR do?** — one paragraph summary.
   - **Which issue does it close?** — link with `Closes #N`.
   - **How was it tested?** — steps you took to verify locally.
   - **Screenshots** — required for any UI change.

4. Make sure:
   - [ ] `npx tsc --noEmit` passes with no errors.
   - [ ] The app starts and the affected feature works manually.
   - [ ] No new `console.log` / debug statements left in.
   - [ ] No secrets or `.env` values committed.

5. A maintainer will review your PR. Please respond to review comments within a reasonable time. If you need more time, just say so — the PR won't be closed.

### PR size guidelines

| Change type | Ideal PR size |
|---|---|
| Bug fix | < 100 lines changed |
| Small feature | < 300 lines changed |
| Large feature | Break into logical sub-PRs |
| Refactor | One file / one abstraction at a time |

---

## Issue Guidelines

### Reporting a bug

Before opening a new issue:

1. Search existing issues — it may already be reported.
2. Try reproducing on the latest `main` branch.
3. Check [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for known x402/Freighter issues.

When you open a bug, include:

- **Steps to reproduce** — numbered, minimal.
- **Expected behaviour** vs **actual behaviour**.
- **Environment:** OS, browser, Node version, Freighter version.
- **Console output / error messages** — paste the full stack trace.
- **Network tab screenshot** (for payment flow issues).

### Requesting a feature

- Explain the **problem** you are solving, not just the solution you have in mind.
- If the feature involves the payment flow or blockchain state, describe how edge cases (network error, wallet rejection, insufficient balance) should behave.
- Check the [open issues](https://github.com/Emmy123222/Stellar-Search/issues) first — the backlog already has 50+ scoped ideas waiting for contributors.

---

## Coding Standards

### TypeScript

- **Strict mode is on** — `"strict": true` in `tsconfig.json`. Do not use `any` unless absolutely necessary and document why.
- Prefer `interface` for object shapes, `type` for unions and mapped types.
- Export types from `src/types/index.ts` if they are used across more than one file.
- No implicit `any` — always type function parameters and return values.

### React

- Functional components only — no class components.
- Co-locate state close to where it is used. Lift only when required.
- Use `useCallback` and `useMemo` when passing callbacks to memoized children or in hook internals, not by default everywhere.
- Clean up side effects in `useEffect` — cancel timers, abort fetch, remove listeners.
- Component files export one default component. Helpers live in the same file or a co-located `utils.ts`.

### Styling

- **Tailwind CSS only** — no inline `style={{}}` props and no external CSS files (except `src/index.css` for global resets).
- Use responsive prefixes (`sm:`, `md:`, `lg:`) for layout breakpoints.
- Animations use Framer Motion — do not add new animation libraries.
- Do not hardcode colour hex values — use Tailwind's colour palette.

### File and folder conventions

- File names: `PascalCase` for components (`SearchBar.tsx`), `camelCase` for hooks and utilities (`useSearch.ts`, `stellar.ts`).
- Each `components/<area>/` folder has an `index.ts` barrel export.
- Hooks live in `src/hooks/`. A hook file exports exactly one hook as its named export.

### Comments

Only write a comment when the **why** is non-obvious — a hidden constraint, a Stellar SDK quirk, or a workaround for a specific bug. Do not comment what the code does; well-named identifiers do that. Do not leave `TODO:` comments in PRs — open an issue instead.

```ts
// Freighter returns a Buffer, not a string — must convert to base64 explicitly.
// Using .toString() gives "[object Buffer]" (9 chars) causing x402 signature length error.
const signedAuthEntry = Buffer.from(raw as unknown as Uint8Array).toString('base64')
```

### Environment variables

- Never commit real secrets. `.env` is in `.gitignore` — keep it that way.
- Frontend env vars must be prefixed `VITE_` to be exposed to the browser by Vite.
- Server env vars go in `.env` and are read via `process.env`. Never import them in `src/`.
- When adding a new env var, add it to `.env.example` with a descriptive comment and a placeholder value.

---

## Testing

Vitest + @vitest/coverage-v8 enforces **coverage thresholds for statements, branches, functions, and lines**. Configuration lives in `vite.config.ts:6` and is documented in `README.md#testing--coverage`.

```bash
npm run test              # run tests without coverage
npm run test:coverage     # run with coverage + thresholds (CI gate)
# reports in coverage/ (text, json, html, lcov)
open coverage/index.html  # view HTML report
```

### Coverage thresholds (ratchet)

Global thresholds start modest and ratchet upward as payment/wallet/API/MCP/UI behavior moves from untested to tested:

| Scope | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| Global | 35% | 30% | 28% | 35% |
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

**Ratchet policy:** If a module's real coverage exceeds its threshold, bump the threshold in `vite.config.ts` in the same PR. CI fails if any threshold drops. Global ratchets `15 → 25 → 35` as new payment, wallet, API, MCP, and UI tests land. Keep Express (`server/`), Vercel (`api/`), browser (`src/`), and MCP (`mcp-server/`) constants aligned — `STELLAR_NETWORK`, `USDC_CONTRACT`, `AMOUNT_STROOPS=10000` → `0.001 USDC` (see `server/index.ts:104`, `api/search.ts:48`, `mcp-server/index.ts:19`). Thresholds verify the **x402 settlement semantics** are preserved for paid routes.

When adding a new hook or server route, include tests. Five utility tests can pass while payment, wallet, API, MCP, and UI remain untested — thresholds prevent that.

### Manual testing checklist

For any change to the search or payment flow, verify:

- [ ] Wallet disconnected → search is blocked with a clear message.
- [ ] Freighter not installed → error message shown, no crash.
- [ ] Freighter on wrong network (Public) → blocked with instructions.
- [ ] USDC balance = 0 → clear message shown.
- [ ] User rejects Freighter popup → session set to `error`, UI recovers.
- [ ] Successful search → results shown, txHash displayed, balance updated.

For UI changes:

- [ ] Test at 375px (mobile), 768px (tablet), 1280px (desktop) widths.
- [ ] No horizontal scroll at any breakpoint.
- [ ] Light and dark mode look acceptable (if theme toggle exists).

### Running the TypeScript compiler

```bash
# Check all TypeScript errors (does not emit files)
npx tsc --noEmit
```

### End-to-end test script

```bash
# Requires all .env keys to be set and server running
npm run test:search "Stellar blockchain"
```

---

## Supply-Chain Security

CI runs dependency supply-chain checks in the `supply-chain` job: it generates and uploads a **CycloneDX SBOM** artifact and runs an **OSV-Scanner vulnerability gate** with a documented **fail / exception policy**.

### What CI does

1. **SBOM** — `npm run sbom` renders `sbom.cyclonedx.json` deterministically from `package-lock.json` (via `@cyclonedx/cyclonedx-npm`). `scripts/verify-sbom.mjs` validates the document and `actions/upload-artifact` ships it as the `cyclonedx-sbom` artifact. The generated file is git-ignored (never committed).
2. **Vulnerability scan** — a pinned `osv-scanner` v1.9.2 binary scans the repo with `--config=osv-scanner.toml`.
3. **Gate** — `scripts/check-vulnerabilities.mjs` fails the build if any **High or Critical** finding is **not** covered by a documented exception.
4. **Code scanning** — the SARIF result is uploaded to Security → Code Scanning (informational; does not gate).

### Fail / exception policy

- **Blocked by default:** any **High/Critical** vulnerability blocks CI unless it is explicitly excused.
- **Reported only:** **Low/Moderate** findings are printed to the log but never fail the pipeline.
- **Exceptions are time-boxed:** approved exceptions live in `osv-scanner.toml` (`[[IgnoredVulns]]`). Each entry must have:
  - `id` — the OSV/GHSA advisory ID,
  - `reason` — the accepted risk and the planned remediation,
  - `ignoreUntil` — a deadline (YYYY-MM-DD). When it passes, the advisory is reported again and CI fails until the dependency is upgraded, the exception is renewed, or the risk is otherwise resolved.

The exception list is intentionally an allowlist of *known, pre-existing* findings on the baseline dependency tree. **New advisories are not automatically excused** — add them to `osv-scanner.toml` only when the risk is genuinely accepted and a remediation is tracked.

### Adding an exception

```toml
[[IgnoredVulns]]
id = "GHSA-xxxx-xxxx-xxxx"
ignoreUntil = 2026-10-15        # choose the shortest practical deadline
reason = "Concrete justification and the planned fix"
```

### Running the checks locally

```bash
npm run sbom                                             # generate sbom.cyclonedx.json
node scripts/verify-sbom.mjs                             # validate the SBOM
osv-scanner --recursive --config=osv-scanner.toml \
  --format json --output=osv-results.json ./             # scan
node scripts/check-vulnerabilities.mjs osv-results.json  # enforce the gate
```

---

## Common Pitfalls

### x402 / Freighter

| Symptom | Likely cause | Fix |
|---|---|---|
| "expected 64 got 9" | `Buffer.toString()` used instead of base64 | Use `Buffer.from(raw).toString('base64')` |
| 402 loop never resolves | Freighter on wrong network | Switch to Testnet in Freighter settings |
| "Failed to parse payment requirements" | Server returning malformed header | Check server logs; decode the `PAYMENT-REQUIRED` header with `base64 -d \| jq .` |
| Freighter popup never appears | `createPaymentPayload()` not awaited | Ensure `await` before the call |
| Balance not updating after payment | `refresh()` not called post-search | Call `refresh()` in the `useSearch` success path |

### Vite / Build

| Symptom | Likely cause | Fix |
|---|---|---|
| `global is not defined` | Stellar SDK needs `globalThis` polyfill | Already handled in `vite.config.ts` — do not remove the `define` block |
| Buffer errors in browser | `buffer` package not aliased | `resolve.alias` in `vite.config.ts` handles this |
| CORS errors in dev | Frontend calling server directly | Use the Vite proxy (`/search`, `/ai`, `/health` already proxied) |

### Stellar / Horizon

| Symptom | Likely cause | Fix |
|---|---|---|
| Account not found | Account not funded on testnet | Fund it at Stellar Lab |
| USDC balance always 0 | Wrong USDC issuer address | Use `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` for testnet |
| Transactions not loading | Horizon rate-limit | Add a 500ms delay between calls; use pagination |

---

## Getting Help

- **Bug or question about the code?** Open a [GitHub Issue](https://github.com/Emmy123222/Stellar-Search/issues/new).
- **Something in this guide is wrong or unclear?** Open a PR fixing it — contributions to docs are just as valuable as code.
- **x402 protocol questions?** See the [official x402 docs](https://x402.org) and the [Stellar agentic payments guide](https://developers.stellar.org/docs/build/agentic-payments/x402/built-on-stellar).
- **Freighter API reference?** [Stellar Freighter docs](https://docs.freighter.app).

---

## Recognition

All contributors are welcome to add themselves to a `CONTRIBUTORS` list. When your PR is merged, feel free to add your name and GitHub handle in a follow-up commit.

---

*StellarSearch — Stellar Hackathon 2026 · Agents on Stellar*
>>>>>>> 7804e9c (feat(ci): generate CycloneDX SBOM and gate dependency vulnerabilities)
