## Description

This change hardens startup configuration for the Stellar x402 payment flow by validating the configured network and receiving address before the paid routes are mounted. The issue was that the app accepted non-null values and warnings instead of failing fast, which allowed invalid wallet configuration to proceed until payment requests failed at runtime. The fix centralizes Stellar config validation, ensures the values match the accepted Stellar network and public-key formats, and keeps the error output non-secret by redacting the address in logs and startup failures.

This update keeps the Express and Vercel runtimes aligned with the browser and MCP boundary so that the project behaves consistently across all execution environments while preserving the existing x402 settlement semantics for paid route requests.

## Type of Change

- [x] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing

- [x] Tested locally
- [x] Added unit tests
- [ ] Tested on Stellar Testnet (for wallet/contract changes)

## Screenshots (if applicable)

N/A

## Related Issues

Closes #928

