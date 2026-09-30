# Campus Portal v15 — Login & Navigation Performance Fixes

This upgrade preserves the existing login, recovery, Face ID, fingerprint, registration, dashboard and portal feature set while fixing the request storm and layout problems.

## Authentication

- Removed the generic 15-minute portal-auth request limiter from password sign-in.
- `/api/portal-auth/login` is exempt from the global API request-volume limiter; failed-password protection is handled separately.
- Failed-login policy:
  - failures 1–5: normal login attempts
  - failure 6 onward: 30-second cooldown
  - failure 11 onward: 60-second cooldown
  - a successful password login resets the failed-attempt counter
- Cooldowns return `Retry-After` and a dedicated `LOGIN_COOLDOWN` response instead of the old generic connection-level message.
- Successful logins are not rate-limited, so repeated legitimate logins remain available.

## Login speed

- Frontend password authentication has an 8-second hard deadline.
- A timed-out sign-in stops waiting instead of leaving the UI stuck for minutes.
- Login errors are displayed immediately and no automatic retry is performed for password sign-in.
- The login path avoids unnecessary directory/storage lookups before credential verification.
- Last-login update and refresh-token creation are issued concurrently after password verification.

## Root cause of the request storm

The previous `useRemoteRealtime()` hook depended on an inline callback. React recreated that callback on every render, which restarted the polling effect and performed an immediate remote request on every render. State updates could therefore create a request storm and eventually trigger the global 429 response.

The hook now stores the latest callback in a ref and only starts/stops polling when its actual subscription key changes. Normal polling remains at 10 seconds.

## Retry behavior

- The runtime no longer automatically retries non-idempotent POST requests.
- Password login is explicitly excluded from runtime retries.
- Storage requests no longer retry HTTP 429 responses; a server-declared cooldown is respected rather than multiplied.

## Navigation and layout

- Removed the scroll-triggered fixed Quick Access dock that duplicated the sticky navigation and could overlap the portal header.
- Added one stable horizontal feature navigation row below the moving Academic Notice Board.
- The three-dot dashboard menu and full portal header remain in the row below it.
- Header controls are now non-wrapping and horizontally scrollable on small screens.
- Old automatic scroll restoration from advanced runtime layers is disabled so switching/reloading a different tab does not jump to a stale position.

No existing portal feature or tab was intentionally removed.
