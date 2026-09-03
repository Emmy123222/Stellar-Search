## Description
<!-- Provide a concise summary of your changes and why they are needed. -->

## Change Type
- [ ] Code change (feature, bug fix, refactor)
- [ ] Documentation only change

---

## Change Scope & Verification Checklist

### For Code & Behavior Changes
- [ ] **Tests & Coverage**: Automated unit tests / integration tests added or updated.
- [ ] **API Contract & Parity**: Verified alignment across Express server, Vercel serverless (`api/`), Browser client (`useSearch.ts`), and MCP server (`mcp-server/`).
- [ ] **x402 Protocol & Settlement**: Preserved x402 v2 payment requirements response (`PAYMENT-REQUIRED`) and signature payload (`X-Payment`).
- [ ] **Wallet Integration**: Validated against `@stellar/freighter-api` on Stellar Testnet/Mainnet.
- [ ] **Accessibility (a11y)**: Ensured screen-reader labels (`aria-*`), focus states, and keyboard navigation.
- [ ] **Screenshots / Visual Evidence**: Attached before/after screenshots or recordings (if UI changed).
- [ ] **Rollback Strategy**: Documented fallback or rollback procedure if deployment fails.

### For Documentation-Only Changes
- [ ] **Accuracy & Verification**: Commands, header specifications, and code snippets tested locally.
- [ ] **No Secrets Leak**: Verified no secret keys, seeds, or private credentials included.

---

## Security & Secrets Audit
- [ ] Confirmed no private keys, secret seeds, or real API keys are committed in code or logs.
