# Campus Portal — Final Production Hardening

## Scope

This release hardens the existing application without removing existing portal features and without changing the implementation of the protected Resume Builder/Resume-JD panel source.

## Security architecture

```text
Browser
  │
  ├── /api/ai ────────────────┐
  ├── /api/ai/stream ─────────┤
  ├── /api/ai/image ──────────┤── Express secure gateway ── Provider APIs
  └── /api/news/headlines ────┘              │
                                             └── FastAPI AI/ML gateway
```

Provider credentials remain server-side. The frontend contains no LLM provider URLs or API-key storage paths.

## Cache privacy

The AI cache is bounded by entry count and response size. Sensitive prompts and all image/explicit no-cache requests bypass caching.

## CSP

The frontend no longer permits JavaScript `unsafe-eval` or `unsafe-inline`. Static deployment uses SHA-256 hashes for the existing inline application scripts; backend-served HTML receives a per-request nonce.

## Frontend runtime

Pinned browser dependencies are self-hosted-first. `backend/scripts/vendor-frontend-assets.js` downloads the required runtime assets into `frontend/vendor/` during a network-enabled production build. CDN fallback remains only as disaster recovery.

## ML quality transparency

When transformer embeddings are unavailable, the matcher uses an offline hybrid hashed TF-IDF-style representation with word bigrams and signed hashing. Results include `embedding_engine`, `confidence`, and `fallback_mode` so the lightweight deployment is explicit about its quality tier.

## Resume protection

The Resume ATS component source fingerprint before and after hardening is identical:

`a77ea4e67366e3155ecf230a0f5bb75eb87609f5fd19795352c62cb1cd676570`

The changes around it are infrastructure-level AI gateway/security changes; the Resume component source itself was not modified.
