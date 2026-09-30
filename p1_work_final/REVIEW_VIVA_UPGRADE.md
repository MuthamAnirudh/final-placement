# Advanced Project Review + Viva Upgrade

## Boot reliability fix

The frontend now has synchronous runtime guards for React and ReactDOM. The local vendor assets are attempted first; when a static host did not materialize them, a pinned React 18.3.1 CDN fallback is synchronously inserted before the precompiled application executes. This prevents `React is not defined` at the first React hook reference.

## Project Review

The existing Project Reviewer mode now includes an evidence-first Defense Command Center with:

- evidence readiness calculation
- claim traceability matrix
- examiner challenge queue
- problem/architecture/ownership/validation/production defense pillars
- five-minute defense protocol
- recent defense trajectory
- secure AI gateway status
- deterministic offline guardrails

## Viva

The existing Viva mode now includes a Viva Readiness Lab with:

- project-grounding readiness
- technical-evidence readiness
- ownership clarity
- defense maturity
- historical weakest-topic analysis
- adaptive drill/review/stable topic signals
- answer architecture guidance
- cross-question recovery guidance
- direct launch into adaptive viva and existing insights

No new top-level tab was created. Existing Project Review, Viva, Mock Interview Studio, and all prior flows remain in place.

## Resume protection

The Resume ATS component remains byte-identical to the previous hardened build.
