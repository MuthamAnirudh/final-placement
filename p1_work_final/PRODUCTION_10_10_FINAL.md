# Campus Portal — Final 10/10 Hardening

## Scope

This release is an additive production-hardening upgrade of `campus-portal-v3-analysis.zip`. Existing placement, AI/ML, adaptive-learning, gate-pass, coding/Striver, Project Review, Viva and Analysis functionality is preserved. The Resume ATS component is protected by a stable regression fingerprint and is not edited by this release.

## Security

- Browser provider API keys removed from the AI path; frontend calls the same-origin `/api/ai`, `/api/ai/stream` and `/api/ai/image` gateways.
- Provider, GNews and EmailJS server-side credentials saved through the Admin configuration screens are stored as AES-256-GCM encrypted envelopes in PostgreSQL.
- `PORTAL_SECRETS_ENCRYPTION_KEY` is required in production and must remain outside PostgreSQL.
- Existing plaintext system-secret rows are transparently migrated on read when the production encryption key is configured.
- Sensitive prompts bypass AI response caching.
- Authenticated AI requests bypass shared response caching even when their text does not match a sensitivity keyword.
- CSP contains no `unsafe-eval` and no JavaScript `unsafe-inline`.
- Static HTML carries SHA-256 hashes for every inline script; Express additionally applies a per-response nonce.

## Deployment

- Critical browser runtimes are vendored during the production build.
- Production build fails closed if required vendor assets are missing or suspiciously small.
- React/ReactDOM are pinned to 18.3.1 in the vendor builder.
- Static-host fallback guards remain for direct uploads where a deployment skipped the vendor build.
- Vercel security headers and cache policies are included.

## Analysis

The existing Analysis & Insights workspace now includes:

- Evidence Quality Index
- sample-size maturity state
- approximate 95% mean interval when sufficient observations exist
- IQR/spread reporting
- explicit separation of data quality from performance score
- retained legacy evidence-confidence compatibility field
- deterministic metrics before optional AI interpretation

The system does not present the quality index or statistical interval as a placement prediction.

## Resume protection

Resume ATS component fingerprint:

`51139bac837395f0ef3fbf300a68c970cd1eceefaef2fc425e20e2dc356c7892`

## Validation

Passed in the isolated environment:

- Advanced frontend hardening
- Secret vault tests
- Advanced Analysis hardening
- Security hardening
- Final hardening
- Frontend regression
- Python AI/ML test suite: 63 passed
- Node syntax checks for modified backend files
- Python compilation checks

The complete npm suite requires installed backend dependencies. In this isolated environment `node_modules` is intentionally absent, so dependency-backed tests stop when `express` cannot be loaded. No dependency-backed result is represented as passed without actually running it.
