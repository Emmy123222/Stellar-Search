# Contributing to StellarSearch

Thanks for contributing to StellarSearch. This guide covers the local setup, the wallet and Stellar testnet requirements, and the conventions used for pull requests.

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

Please keep reviews constructive and update the PR when feedback is addressed.
