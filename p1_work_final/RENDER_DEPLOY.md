# Render production deployment — Campus Portal

This repository is configured as a **Render Web Service**. Do not deploy the complete
Campus Portal as a Render Static Site: the Express backend serves the frontend and all
`/api/*` routes from the same origin.

## Render settings

- Service type: **Web Service**
- Root directory: **empty**
- Runtime: **Node**
- Build command:

```bash
cd backend && npm ci && npm run build
```

- Start command:

```bash
cd backend && npm start
```

- Health check path:

```text
/api/health/live
```

`backend/server.js` binds to `0.0.0.0:$PORT`. Render supplies `PORT`; do not hard-code
the production port.

## Required environment variables

Set these in Render's Environment settings. Never commit real values.

```text
NODE_ENV=production
DATABASE_URL=<PostgreSQL connection string>
DIRECT_URL=<optional direct/non-pooled PostgreSQL connection>
JWT_ACCESS_SECRET=<random 32+ character secret>
JWT_REFRESH_SECRET=<different random 32+ character secret>
PORTAL_SECRETS_ENCRYPTION_KEY=<dedicated random 32+ character secret>
CORS_ORIGIN=https://<your-render-service>.onrender.com
PORTAL_ADMIN_EMAIL=<admin email>
PORTAL_ADMIN_PASSWORD=<admin password>
PORTAL_ADMIN_NAME=Professor-In-Charge (T&P)
AI_ML_SERVICE_TOKEN=<random 32+ character token>
OPERATIONS_TOKEN=<random 32+ character token>
```

Keep the existing AI provider variables (`GROQ_API_KEY`, `GEMINI_API_KEY`, etc.) when
those features are used. Keep the existing EmailJS and GNews variables when those
integrations are configured.

If `CORS_ORIGIN` is not explicitly supplied, the backend can use Render's
`RENDER_EXTERNAL_URL` automatically. For a custom domain, set `CORS_ORIGIN` to the
custom HTTPS origin.

## Critical startup fix

React, ReactDOM, Tailwind compatibility, PptxGenJS, EmailJS, jsPDF, html2canvas, QRCode
and Face API are shipped under:

```text
frontend/vendor/
```

The production build now **verifies the committed browser assets** instead of requiring
unpkg/cdnjs/jsDelivr access during every Render build.

React and ReactDOM have no CDN fallback in the critical boot path. If they are missing,
the build/deployment artifact is considered broken and the browser shows a local asset
diagnostic instead of an incorrect "change networks / unblock unpkg" message.

Optional feature code may still contact third-party services where the feature itself
requires a remote provider. Such failures do not block initial portal startup.

## Deployment verification

After Render deploys, verify:

```text
https://<service>.onrender.com/
https://<service>.onrender.com/api/health/live
https://<service>.onrender.com/api/health
https://<service>.onrender.com/vendor/react.production.min.js
https://<service>.onrender.com/vendor/react-dom.production.min.js
https://<service>.onrender.com/vendor/tailwindcss-browser.js
```

The vendor URLs must return JavaScript with HTTP 200.

Then open the portal in a private/incognito window and confirm the login screen renders.

## Clean rebuild requirement

If Render is showing an older orange boot screen after deploying this version:

1. Confirm Render is connected to the repository/branch containing these changes.
2. Trigger **Manual Deploy -> Clear build cache & deploy**.
3. Confirm the build log contains:

```text
[vendor] production browser asset verification passed; no CDN download was required.
Production build validation passed.
```

4. Confirm the deployed page source contains:

```text
./vendor/react.production.min.js
./vendor/react-dom.production.min.js
```

and does not use an external CDN as the React/ReactDOM startup source.

## Important

Do not solve the problem by disabling an ad blocker or changing Wi-Fi. The production
application is designed to boot from its own deployed runtime assets.
