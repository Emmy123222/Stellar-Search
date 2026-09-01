# Contributing to StellarSearch

Thanks for contributing to StellarSearch. This guide covers the local setup, the wallet and Stellar testnet requirements, and the conventions used for pull requests.

## Prerequisites

Before you begin, make sure you have:

| Requirement | Version | Notes |
|---|---|---|
| **Node.js** | ≥ 20.19.0 | ESM support required; CI tests Node 20 and 22 |
| **npm** | ≥ 9.0.0 | Comes with Node 18 |
| **Git** | any recent | — |
| **Freighter** | latest | [freighter.app](https://freighter.app) browser extension |
| **Stellar testnet account** | — | Free — see setup below |

### Free API keys you will need
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

### Dependency updates (Dependabot)

Dependabot is configured in `.github/dependabot.yml` to automatically propose weekly updates with sensible open PR limits:
- **Grouped updates:** Minor/patch dependencies for tooling, linting, testing, and UI are grouped into single PRs to reduce notification noise.
- **Deliberate review for payment & runtime:** Major upgrades for `@x402/*`, `@stellar/*`, `@modelcontextprotocol/*`, AI SDKs (`groq-sdk`), and server runtime packages are kept as isolated PRs to ensure deliberate review, preventing regressions across runtime boundaries (Express, Vercel, browser, and MCP) and safeguarding x402 settlement semantics.

---

## Submitting a Pull Request

1. Push your branch:
   ```bash
   git push origin fix/freighter-rejection-loop
   ```

2. Open a PR against `main` on GitHub.

3. Fill in the PR template:
   - **What does this PR do?** — one paragraph summary.
   - **Which issue does it close?** — link with `Closes #N`.
   - **How was it tested?** — steps you took to verify locally.
   - **Screenshots** — required for any UI change.

4. Make sure:
   - [ ] `npx tsc --noEmit` passes with no errors.
   - [ ] `node scripts/check-node-version.js` passes (validates Node version against engines).
   - [ ] `npm run lint` passes with zero errors and zero warnings (`eslint . --max-warnings=0`).
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

## Testing

Vitest + @vitest/coverage-v8 enforces **coverage thresholds for statements, branches, functions, and lines**. Configuration lives in `vite.config.ts:6` and is documented in `README.md#testing--coverage`.

```bash
npm run test              # run tests without coverage
npm run test:coverage     # run with coverage + thresholds (CI gate)
node scripts/check-node-version.js  # validate Node version against engines
# reports in coverage/ (text, json, html, lcov)
open coverage/index.html  # view HTML report
```text
fix: handle rejected Freighter signatures
```

### PR naming convention

### CI Node version matrix

CI runs typecheck, lint, and test jobs across a matrix of Node versions to ensure compatibility:

| Node version | Role |
|---|---|
| **20** | Minimum supported (per `package.json` engines) |
| **22** | Current LTS |

Each job includes a `node scripts/check-node-version.js` step that validates the running version against the `engines` field before any build or test steps run. Unsupported versions fail early with a clear error message.

### Running the TypeScript compiler
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

Please keep reviews constructive and update the PR when feedback is addressed.
