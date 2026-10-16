# Wallet Transactions & USDC Filtering

This document outlines how transactions are fetched and filtered in the Stellar wallet integration.

## Transaction Direction
Transactions are evaluated against the connected account's public key:
- **Outbound**: `op.from === publicKey` (or `op.funder === publicKey`)
- **Inbound**: All other valid transactions directed towards or funded on the account.

## USDC Filtering
Payment operations are filtered to ensure only native assets (XLM) or verified USDC matching the network-specific issuer (`USDC_ISSUER`) are processed.
