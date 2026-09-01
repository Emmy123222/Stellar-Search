# #205: CI, developer experience & releases

## Context

Version 1.0.0 is duplicated in code and package metadata with no repeatable release process.

This issue targets the release pipeline and developer workflow for the project so that versioning, validation, publishing, and rollback behavior are consistent across the app and deployment surfaces.

## Relevant files

- package.json
- .github/workflows
- CHANGELOG.md

## Acceptance criteria

- [ ] A tag-driven workflow validates, builds, and publishes GitHub release notes
- [ ] Version sources stay synchronized and rollback instructions are documented
- [ ] Automated coverage and documentation are updated where the behavior changes

## Delivery notes

Keep Express, Vercel, browser, and MCP behavior aligned where this concern crosses runtime boundaries. Preserve verified x402 settlement semantics for paid routes.

## Problem summary

The project currently has a version value repeated across metadata and runtime code. Without a single source of truth or a repeatable release pipeline, the team risks drift between package versioning, production deployments, and release notes. A reliable GitHub Actions release flow should validate the build, generate release artifacts or notes, and ensure that version updates remain synchronized.

## Expected release behavior

1. A version tag such as v1.0.1 should trigger a defined release pipeline.
2. The pipeline should validate the app, run tests, and build the project before publication.
3. Release notes should be created or updated automatically in GitHub.
4. Version metadata should remain synchronized across code and package metadata.
5. Rollback instructions must be available in the repo and referenced from release documentation.

## Suggested implementation direction

- Centralize the version source to avoid divergent values between runtime and package metadata.
- Use an automated workflow that runs on a version tag and executes validation plus build checks.
- Publish release notes through the GitHub release system using the tag metadata.
- Document rollback/restore steps in the changelog or release docs.
- Review the affected runtime boundaries (Express API, Vercel/Vite frontend, browser code, and MCP server) to confirm compatibility.
- Retain the verified x402 payment logic and ensure release changes do not alter paid-route settlement semantics.

## Notes for implementation

- Preserve existing Express and MCP runtime behavior where this issue crosses service boundaries.
- Verify that browser and Vercel deploy settings remain aligned with the release flow.
- Update automated tests and documentation whenever release-related or versioning changes impact user-facing or operational behavior.
- Ensure the release process is auditable and reproducible for future hotfixes or rollbacks.
