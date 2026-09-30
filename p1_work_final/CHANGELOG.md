
### Audit pass — 2026-10-01 (additive, no feature removed)
- `backend/server.js`: `/gate-pass-verify.html` is now served with a per-request CSP nonce. Under the production CSP
  (nonce-only, no `unsafe-inline`) the verifier's inline script was blocked, so guards were stuck on "Verifying…".
- `frontend/gate-pass-verify.html`: inline `onclick` on "Verify Again" replaced with an event listener (also CSP-blocked).
- `backend/src/routes/gatePasses.js`: if a pass has no valid out date/time the QR now expires 3 hours after approval instead of
  never; `qrValidUntil`, `hodOverride*`, `*Remarks`, `guardianNotifiedVia` are server-controlled so a student edit cannot alter them;
  restored a truncated comment above `/public/redeem`.
- `frontend/index.html`: removed one stale inline-script CSP hash (`node backend/scripts/sync-frontend-csp.js`).
- New test `backend/tests/gatePassVerifyCsp.test.js`, added to `npm test`.
- Verified: `node --check` on all JS, Python compile, 22 backend test suites and 63 Python tests pass.

### Gate-pass QR timing correction — 2026-09-30
- QR validity is now tied to the student's mentioned **out date + out time**.
- A newly HOD-approved QR remains usable until **3 hours after the mentioned out time**.
- If it is first scanned after that deadline, the server returns **TIME LIMIT COMPLETED** and the QR is not admitted.
- The **30-second** limit remains only the maximum time allowed for the verification request to complete after scanning; it is not the QR lifetime.
- Successful scans remain atomic and one-time: the first successful scan immediately marks the QR used globally.
- HOD/Admin final override and the existing teacher/mentor/guardian workflow are unchanged.

# v14.1 - Audit pass (additive, nothing removed)
- `backend/tests/frontendRegression.test.js`: the test still demanded the old browser-side retry loop for password recovery,
  which v14 intentionally removed (one click = one delivery request; the server retries EmailJS 429/5xx). Test now checks the
  current design: no client retry, client calls `/api/portal-auth/recovery/start`, and `recoveryMailer.js` retries transient errors.
- `frontend/index.html`: login asset links bumped `?v=13` -> `?v=14` so browsers drop the cached CSS/JS that still showed the
  Alt+1..4 badges. Inline-script CSP hashes re-synced (unchanged, 4 hashes).
- Verified: `node --check` passes on every JS file, all Python files compile, and every test suite that runs without
  `npm install` passes. (aptitudeProgress, coldStartAndAiMl, recoveryAndSync, signupAndAiConfig need `npm install` first.)

# v13 - Login audit: bug fixes + more interactive login (additive, nothing removed)
**Bugs fixed**
- `frontend/app-runtime.js` (Forgot password): the recovery request lost its transient-error retry and the clear
  "check the Email Delivery configuration" fallback message, so `backend/tests/frontendRegression.test.js` failed.
  Restored: up to 3 attempts on 429/502/503/504 with a short back-off, and the clear fallback message.
- `frontend/app-runtime.js` (Forgot password, step 3): the new-password box said "At least 4 characters" while the
  code and the server both require 8. Placeholder now says 8, `minLength=8` and `autocomplete="new-password"` added.
- `frontend/login-interactive.css`: entrance animations used `animation-fill-mode: both`, which kept the last
  keyframe (`transform:none`) applied forever and silently overrode the card's 3D tilt and the feature-card
  highlight/hover. Now `backwards`, so the entrance still plays and the effects work afterwards.
- `frontend/login-interactive.css`: `font:800 8px/1.3 inherit` (invalid shorthand, whole rule dropped) on the
  Alt+1..4 role badges - fixed.
- `frontend/login-interactive.js`: ripple was drawn in the wrong place on static text buttons ("Forgot password?")
  and spilled out of role tiles. Now only positioned buttons ripple, role tiles clip it.
- Floating helpers (Caps Lock tip, strength label, e-mail ghost) now follow their field on scroll/resize/layout
  changes instead of being left behind; the 400 ms housekeeping tick pauses in background tabs.
- Login asset links carry `?v=13` so browsers pick up the new files immediately. (`mainapp.js`, the unused legacy
  copy, got the placeholder fix too.)

**Added to the login page (all existing login features untouched)**
- Live password checklist (8+ chars / upper+lower / number / symbol) beside every "create password" field.
- "Did you mean ...?" e-mail typo fixer (gmial.com, gmail.con, ... and near-misses of the campus domain); tap to fix.
- Magnetic sign-in button, animated "signing in" shimmer bar on the card, refocus + select of the password after a
  wrong password (never steals focus from a field being edited), `role="alert"` on sign-in errors.
- A revealed password re-hides itself after 15 s using the app's own eye toggle.
- Welcome overlay ("Welcome back, <first name>") after a successful sign-in; never blocks clicks.
- Input focus lift + icon pop, ticker pauses on hover. All new effects honour `prefers-reduced-motion`.

**Verification**: all `npm test` suites pass; every JS file passes `node --check`; inline-script CSP hashes are in sync;
the login layer was exercised against the real rendered login and register forms in a DOM test (roles, hotkeys,
typo fixer, checklist, strength, confirm match, busy bar, refocus, auto-hide, welcome overlay, clean-up).

# v10 – Login bug fix + interactive login layer
**Bug fixed**
- `frontend/index.html`: the startup fallback login script had a broken regex
  (`.replace(/\\\\/+$/, '')`) that threw `SyntaxError: Unexpected token ','` on every page load, so the
  fallback sign-in handler never attached. Corrected to `.replace(/\\/+$/, '')`; CSP hashes re-synced
  (`node backend/scripts/sync-frontend-csp.js`).
- Register form: the icon in "Personal Gmail (for password recovery)" sat on its own line above the text
  (a global `label{display:block!important}` overrode `flex`). Fixed in `login-interactive.css`.

**Added (additive only; no existing login feature changed)** - `frontend/login-interactive.css` and
`frontend/login-interactive.js`, linked from `index.html`:
- live particle-network background reacting to the pointer, card spotlight + gentle 3D tilt, orb parallax
- progress line on the card that fills as the form is completed; shake on a sign-in error; button ripple/shine
- Caps Lock warning on password fields; password-strength bar and match indicator when creating a password
- ghost e-mail domain completion (Tab / right-arrow / tap), live e-mail validity ring
- role hotkeys Alt+1..4 (with badges) and remembering the last chosen role (`cp:login:lastRole`, not synced)
- auto-highlighting feature list, greeting + online/offline status pill
- respects `prefers-reduced-motion`; stops all work once the login page is gone; touch devices skip tilt.

# Fixes in this revision (v8)

1. vercel.json: Vercel rejects a config that has both `routes` and `headers`. Security headers, the
   no-store cache header on index.html and the immutable cache header on /vendor are now attached to
   `routes` entries. Routing behaviour is unchanged.
2. Removed the wrong `/frontend/...` prefix from the header sources (requests arrive as `/vendor/...`).
3. .vercelignore: extracted.js (a corrupt, unreferenced fragment that fails `node --check`) and the
   unreferenced mainapp.js copy are no longer uploaded. Files are kept in the project, nothing deleted.
4. backend/package.json `npm test` now also runs frontendRegression, analysisAdvanced,
   cookieSessionHardening, secretVault and secureGatewayHardening (they existed but were never run).
5. No features were removed. All existing modules, routes, migrations and the frontend are unchanged.

Before deploying: run `cd backend && npm install && npm run build:frontend-vendor` once with internet
access and commit frontend/vendor/*.js (vercel.json uses the static builder, which does not run
`vercel-build`, so vendor files are not downloaded on Vercel automatically).

# v9 – Login page polish
- Typed email/password text no longer overlaps the mail/lock icons. Cause: a global
  `.cp-auth-card input{padding:10px 12px!important}` rule overrode the `pl-9` left padding.
  Icons are now positioned by CSS and inputs reserve space for them (also for the show/hide eye
  button and the teacher/mentor Gmail check icon).
- "Remember me": removed the stray box outline on click; custom rounded checkbox with a tick and a soft
  ring only for keyboard focus; label restored to a proper aligned row.
- Changes are in frontend/index.html (style#cps-auth-premium) and frontend/cp-auth-premium.css.
  No feature, route or logic was changed; CSP hashes re-synced; all static tests pass.

# v10 – Face ID "library failed to load (network/CDN blocked)"
Cause: frontend/vendor/face-api.js was never committed, and the only fallback was one CDN (jsDelivr),
which is blocked on some mobile networks. The models (frontend/models/face-api) were already bundled.
- New same-origin route GET /api/vendor/face-api.js (served from the @vladmandic/face-api npm package).
- Added @vladmandic/face-api to backend/package.json and to vercel.json `includeFiles`.
- The app now tries, in order: ./vendor/face-api.js -> /api/vendor/face-api.js -> jsDelivr -> unpkg ->
  fastly/gcore jsDelivr, and only then shows a clearer error. Existing Face ID logic is unchanged.
- CSP script-src allows the two extra jsDelivr mirrors; script hashes re-synced.
Deploy: run `cd backend && npm install` (updates package-lock.json) and commit it, then redeploy.
Best long-term: also run `npm run build:frontend-vendor` once and commit frontend/vendor/*.js.

# v11 – "This is taking longer than it should" (blank/stuck start on Render)
Cause: frontend/vendor/ contained only two tiny stubs, so React/ReactDOM were fetched from unpkg.com and
cdnjs on every visit. On networks that block those hosts (school/office Wi-Fi, ad-blockers, some mobile
data) React never loaded and the 14-second boot watchdog showed that message.
- Bundled every browser runtime library into frontend/vendor (React 18.3.1, ReactDOM, pptxgenjs, EmailJS,
  html2canvas, jsPDF, QRCode, face-api) so the app no longer needs any CDN to start.
- vendor/tailwindcss-browser.js is now a tiny shim (styles already come from tailwind-static.css) so the
  inline Tailwind config script stops polling forever.
- Verified by loading the app with every external host blocked: it mounts and shows the landing page.
- (v10 items above are unchanged.) Earlier in this revision: parseAiJson ReferenceError guard in Judge
  Practice, stale aptitudeProgress test fixture, WORD-SEARCH-2.py filled in, backend .env completed.
No features were removed.

# v12 – Frontend/loading audit fixes
1. Render build failure: `backend/package-lock.json` was missing `@vladmandic/face-api`, so `npm ci` (used by
   render.yaml) aborted with EUSAGE. Lock file regenerated; `npm ci` now succeeds.
2. Desktop sign-in layout: Tailwind `lg:col-span-3` on the auth panel forced a 3rd implicit grid column inside the
   2-column `.cp-auth-layout` override, pushing the sign-in card ~900px below the hero. Children of
   `.cp-auth-layout` now use `grid-column:auto` (frontend/cp-auth-premium.css + inline style in index.html).
3. Slow first load: `express.static` streams files and bypassed the res.send gzip middleware, so the 17MB
   aptitude bank, 4.8MB LeetCode bank, CSS and vendor JS were sent uncompressed. Added a cached, async gzip layer
   for static assets (traversal-safe, ETag/304 aware). aptitude-data-full.json: 17.0MB -> 2.3MB over the wire.
4. The 117k-question aptitude bank was downloaded, parsed and de-duplicated on the sign-in screen. It now loads
   only after sign-in, when the browser is idle. The bank still loads in full for signed-in users.
5. Header: decorative "FEATURES" label was hidden behind the logo; now sits under the menu button.
6. CSP script hashes re-synced (10 inline scripts). All `npm test` suites pass. Headless-browser walkthrough of all
   8 modules (buttons clicked in each) produced zero JS errors / crash screens.
No features were removed.

## v16.1 — bug-fix pass (no features removed)
- gatePasses.js: `normalizeBranch` used `/\\s+/` (literal backslash) so branch names with extra spaces never matched; now `/\s+/`. This affects the branch-fallback approval routing.
- gatePasses.js: `facultyCanModifyPass` operator-precedence slip (teacher path stringified `undefined`); parenthesised.
- gatePasses.js: students/coordinators could PUT/bulk a pass with `status:"approved"` or forged approval/QR fields. Approval state is now server-controlled; creation is forced to `pending` with the caller\x27s own email. Faculty/guardian/HOD/redeem endpoints unchanged.
- tests: added `gatePassSanitize.test.js` (also wired into `npm test`).
