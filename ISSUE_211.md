# #211: Observability & reliability

## Context

Logs from HTTP, facilitator, Serper, Groq, and MCP cannot be joined for a single request.

This issue targets request tracing across runtime boundaries so that a single incoming request can be followed end-to-end across the Express server, Vercel/API routes, browser fetches, and MCP interactions. The lack of a consistent request ID breaks operational debugging, auditability, and incident triage when failures occur across multiple services.

## Relevant files

- server/index.ts
- api/
- mcp-server/index.ts
- Any adapters or middleware that emit structured logs or outbound service calls

## Acceptance criteria

- [ ] Incoming valid IDs are accepted or generated and returned to clients
- [ ] Every structured log and adapter call carries the same request ID
- [ ] Automated coverage and documentation are updated where the behavior changes

## Delivery notes

Keep Express, Vercel, browser, and MCP behavior aligned where this concern crosses runtime boundaries. Preserve verified x402 settlement semantics for paid routes.

## Problem summary

A request enters the system through one runtime boundary and may be processed by multiple components before it exits. Today, each layer can create or emit logs independently without a shared identifier, so correlation between HTTP logs, facilitator activity, Serper lookups, Groq responses, and MCP activity is impossible.

This reduces the reliability of debugging especially during distributed failures, slow requests, and errors that involve calls between local and remote services. The result is poor observability, difficult incident diagnosis, and lower confidence in operational behavior.

## Expected request tracing behavior

1. A valid incoming request ID is accepted when present and reused.
2. A new request ID is generated when none is provided.
3. The request ID is returned to the client in a predictable response/header contract.
4. The same request ID is included on every structured log entry and outbound adapter invocation.
5. Cross-runtime behavior stays aligned between Express, API routes, browser behavior, and MCP execution paths.
6. Paid-route x402 settlement semantics remain unchanged and verified.

## Suggested implementation direction

- Define a common request ID utility for generating and validating IDs.
- Apply request ID handling at the earliest ingress boundary, including incoming API/web requests.
- Propagate the ID through middleware, request context, and downstream adapter calls.
- Ensure all structured logs include the same request ID across server, API, and MCP paths.
- Return the ID to clients in a response/header pattern that is consistent and documented.
- Update tests to cover accepted IDs, generated IDs, propagation, and failure/edge cases.
- Document the behavior and any expected header or response conventions in the project docs.
- Review runtime boundary touchpoints to confirm browser, Vercel, Express, and MCP behavior remain aligned.
- Preserve the verified x402 settlement logic and avoid regressions in paid-route flows.

## Notes for implementation

- Keep runtime boundary compatibility in mind when introducing request ID handling across Express, Vercel, browser, and MCP services.
- Prefer a single shared source of truth for request ID generation and propagation rather than per-runtime ad hoc implementations.
- Ensure telemetry remains useful without leaking or mismanaging IDs across request lifecycles.
- Update automated coverage and docs whenever request tracing changes user-visible or operational behavior.
- Verify that no changes to request correlation logic affect the confirmed x402 settlement semantics for paid routes.
