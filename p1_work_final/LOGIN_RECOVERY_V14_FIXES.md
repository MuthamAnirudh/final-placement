# Login / Recovery v14 fixes

- Removed the visible `Alt+1`, `Alt+2`, `Alt+3`, `Alt+4` badges from Student, Class Teacher, Mentor and T&P Admin role cards.
- Kept the existing Alt+1..4 keyboard shortcuts and accessibility metadata.
- Added a cleaner role-card selection check/glow and hover/focus interaction.
- Password-recovery delivery remains server-side; private keys are never sent to the browser.
- EmailJS transient 429/5xx delivery errors are retried once by the server instead of multiplying requests in the browser.
- Increased the EmailJS server request timeout from 5s to 20s.
- Recovery frontend now makes one delivery request per click, preventing duplicate mails and accidental provider rate-limits.
- Error messages now surface the server's actionable EmailJS hint when delivery fails.
- Existing authentication, biometric login, registration, portal features and data files are preserved.
