# stellar-search-client

Typed Python client SDK for paid search using the **x402 payment protocol** on **Stellar**.

Enables autonomous AI agents, backend services, and Python applications to search the web, images, and news with verified micropayments in **USDC**.

---

## Features

- 🌐 **Web, Image & News Search**: Typed synchronous (`StellarSearchClient`) and asynchronous (`AsyncStellarSearchClient`) methods for `/search`, `/images`, and `/news` with automatic 402 challenge negotiation and payment retry.
- 🔐 **Pluggable Signers**:
  - **Server Signer**: Resolves signing credentials from environment variables (`STELLAR_PRIVATE_KEY` / `SEARCH_PRIVATE_KEY`), secrets managers (AWS Secrets Manager, HashiCorp Vault), or secure prompts.
  - **Mock Signer**: In-memory signer for testing and offline simulations.
  - **Custom Signers**: Implement the `ClientSigner` interface to support hardware wallets, multisig, or agent wallets.
- 🛡️ **Explicit User Approval**: Built-in `on_payment_required` confirmation hook (sync and async/coroutine) to prevent silent or unauthorized fund transfers.
- 🔍 **On-Chain Receipt Verification**: Verifies settlement proofs against the Stellar Horizon ledger directly (`verify_receipt` & `verify_receipts`).
- 🩺 **Health & Price Discovery**: First-class support for `/health` and `/.well-known/x402` machine-readable price discovery.
- 🔒 **Zero-Leakage Security**: Built-in secret redaction ensures private keys are never echoed into logs, error messages, or shell outputs.
- 🪶 **Zero Mandatory Dependencies**: Built entirely with Python's standard library (`urllib`, `dataclasses`, `asyncio`, `json`). Optional `stellar-sdk` support for cryptographic keypair derivation.

---

## Installation

```bash
pip install stellar-search-client
```

Or install with optional `stellar-sdk` keypair support:

```bash
pip install "stellar-search-client[stellar]"
```

---

## Quickstart

### 1. Synchronous AI Agent with Server Signer

```python
import os
from stellar_search import (
    StellarSearchClient,
    create_server_signer,
    PaymentChallenge,
)

# 1. Create a server signer using an environment variable
signer = create_server_signer(
    get_secret_key=lambda: os.environ["STELLAR_PRIVATE_KEY"]
)

# 2. Define an approval hook (e.g. budget guard)
def budget_guard(challenge: PaymentChallenge) -> bool:
    price_stroops = int(challenge.accepts[0].amount) if challenge.accepts else 0
    return price_stroops <= 50_000  # Approve if <= 0.005 USDC

# 3. Initialize the client
client = StellarSearchClient(
    base_url=os.environ.get("SEARCH_API_URL", "http://localhost:3001"),
    signer=signer,
    network="stellar:testnet",  # or "stellar:mainnet"
    on_payment_required=budget_guard,
)

# 4. Perform a paid web search
response = client.search(
    "Stellar smart contracts",
    count=5,
    freshness="pw",  # past week
    suggestions=True,
)

print(f"Received {response.count} results (Latency: {response.latency_ms}ms):")
for item in response.results:
    print(f"- {item.title}: {item.url}")

# 5. Verify the settlement receipt on Horizon
if response.tx_hash:
    verification = client.verify_receipt(
        receipt={
            "txHash": response.tx_hash,
            "query": response.query,
            "amount": response.paid_amount,
            "network": response.network,
            "timestamp": "2026-09-01T12:00:00Z",
        }
    )
    print(f"Receipt Status: {verification.status}")  # 'confirmed'
```

---

### 2. Asynchronous AI Agent (`AsyncStellarSearchClient`)

```python
import asyncio
import os
from stellar_search import AsyncStellarSearchClient, create_server_signer, PaymentChallenge

async def main():
    signer = create_server_signer(secret_key=os.environ["STELLAR_PRIVATE_KEY"])

    async def approve_payment(challenge: PaymentChallenge) -> bool:
        # Prompt user or verify agent budget asynchronously
        return True

    async with AsyncStellarSearchClient(
        base_url="http://localhost:3001",
        signer=signer,
        on_payment_required=approve_payment,
    ) as client:
        # Paid web search
        response = await client.search("Stellar Soroban tutorial", count=3)
        for r in response.results:
            print(f"[{r.relevance_score}] {r.title} -> {r.url}")

        # Paid image search
        images = await client.search_images("Stellar blockchain logo", count=5)
        for img in images.results:
            print(f"Image: {img.title} ({img.image_url})")

        # Health & Price Discovery
        health = await client.get_health()
        print(f"Server Health: {health.status} on {health.network}")

        discovery = await client.get_x402_discovery()
        print(f"x402 Discovery: {len(discovery.resource_templates)} resource templates")

asyncio.run(main())
```

---

### 3. Price Quoting Without Paying

To inspect current pricing and payment challenge parameters without settling a transaction, use `quote()`:

```python
client = StellarSearchClient()
challenge = client.quote("search", "stellar consensus protocol")

if challenge.accepts:
    option = challenge.accepts[0]
    print(f"Price: {option.amount} stroops ({option.asset or 'USDC'})")
    print(f"Pay to: {option.pay_to}")
```

---

### 4. On-Chain Receipt Verification

Verify any settlement receipt against the Stellar Horizon ledger:

```python
from stellar_search import verify_receipt_against_horizon, SearchReceipt

receipt = SearchReceipt(
    tx_hash="3389e9f0f1a65f19736cacf544c2e825db1f9f6e",
    query="stellar smart contracts",
    amount="0.001",
    network="stellar:testnet",
    timestamp="2026-09-01T12:00:00Z",
)

detail = verify_receipt_against_horizon(receipt)
if detail.status == "confirmed":
    print(f"Verified on ledger sequence #{detail.ledger_sequence} at {detail.verified_at}")
elif detail.status == "mismatched":
    print(f"Verification mismatch: {detail.mismatches}")
else:
    print(f"Unverified: {detail.error}")
```

---

## Error Handling

All SDK exceptions inherit from `StellarSearchError`:

| Exception | Status Code | Description |
|-----------|-------------|-------------|
| `ValidationError` | 400 | Raised when a parameter fails validation (e.g. empty query or length > 256). |
| `PaymentRequiredError` | 402 | Raised when an endpoint requires payment and no signer is provided. Contains `error.challenge`. |
| `PaymentApprovalRejectedError` | 402 | Raised when `on_payment_required` rejects payment authorization. |
| `PaymentFailedError` | 402 / HTTP | Raised when a paid request retry fails after presenting payment credentials. |
| `VerificationError` | None | Raised during settlement receipt verification issues. |

---

## Running Tests

Run the test suite using standard Python `unittest`:

```bash
cd packages/python-client
python3 -m unittest discover tests
```

Or run with `pytest` if installed:

```bash
pytest packages/python-client/tests
```

---

## License

MIT
