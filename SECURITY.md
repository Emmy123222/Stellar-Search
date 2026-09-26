# Security Policy

## Overview

StellarSearch is a pay-per-query search platform combining browser wallet interactions (Freighter), an Express server, serverless Vercel endpoints, and an MCP (Model Context Protocol) server over the Stellar blockchain using the x402 payment protocol.

Because StellarSearch handles cryptographic transaction handshakes, wallet signatures, on-chain USDC settlements, and upstream search provider credentials, security is critical across all runtime boundaries.

---

## Supported Versions

Only the latest release on the primary development branch (`main`) receives security patches and vulnerability assessments.

| Version / Branch        | Supported          | Runtime Environments             |
| ----------------------- | ------------------ | -------------------------------- |
| `main` (HEAD)           | :white_check_mark: | Express, Vercel, MCP, Browser UI |
| Release tags (< latest) | :x:                | Older releases / snapshots       |

We strongly recommend keeping local and production deployments up to date with the latest commit on `main`.

---

## Reporting a Vulnerability

**DO NOT report security vulnerabilities through public GitHub issues, discussions, pull requests, or public chat channels.**

If you discover or suspect a security vulnerability—especially concerning payment verification, private keys, wallet signing, replay attacks, or credential handling—please report it privately:

1. **GitHub Private Security Advisory (Preferred):**  
   Submit a private advisory report directly via GitHub:  
   [https://github.com/Emmy123222/Stellar-Search/security/advisories/new](https://github.com/Emmy123222/Stellar-Search/security/advisories/new)

2. **Security Contact:**  
   If you cannot use GitHub Advisories, email the maintainer directly at:  
   **`security@stellarsearch.org`** (or contact maintainer `@Emmy123222` via GitHub private contact).

### What to Include in Your Report

To help us triage and resolve the issue quickly, please provide:

- A descriptive summary of the vulnerability.
- The affected component(s) (e.g., Express server, Vercel handler, Browser wallet hook, MCP server).
- Step-by-step instructions or proof-of-concept (PoC) code to reproduce the issue.
- Impact assessment, including potential exploit scenarios (e.g., payment bypass, replay attacks, SSRF, information leakage).
- Any proposed remediation or patches if available.

### Critical Safety Notice Regarding Secrets and Funds

> [!CAUTION]
> **NEVER include real secret keys, live seed phrases, signed mainnet transactions, or live funds in your report or reproduction scripts.**
>
> - Use only Stellar Testnet accounts (`G...` public keys only).
> - Never expose secret seeds (`S...`), API keys (`SERPER_API_KEY`, `GROQ_API_KEY`), or webhook secrets.
> - Redact any personal identifiers, authorization headers, or private credentials before transmitting logs.

---

## Response and Disclosure Process

1. **Initial Response:** We will acknowledge receipt of your vulnerability report within **48 hours**.
2. **Triage & Assessment:** Maintainers will investigate the finding, determine severity, and reproduce the behavior within **5 business days**.
3. **Remediation:** A fix will be developed in a private security fork or branch. We may coordinate with you to validate the fix.
4. **Coordinated Disclosure:** Once the fix is merged and released, a security advisory will be published crediting the reporter (unless anonymity is requested).

---

## Scope and Threat Model

Specific areas of interest and protection include:

- **x402 Payment Protocol & Settlements:** Verification bypasses, signature spoofing, double-spending, replay attacks, and transaction receipt decoding across Express and Vercel endpoints.
- **Wallet Security & Freighter Signing:** Improper transaction envelope construction, unauthorized fee bumps, and key leakage.
- **Upstream & Serverless API Security:** SSRF in webhook notifications, Serper and Groq credential leaks, serverless CORS misconfigurations, and parameter injection.
- **MCP Tool Integrity:** Unauthenticated paid search invocation via AI tools without explicit user approval.
