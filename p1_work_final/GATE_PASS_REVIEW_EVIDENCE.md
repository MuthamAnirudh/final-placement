
## QR timing evidence — 3-hour out-pass window

For review, demonstrate the following exact sequence:

1. Submit an out-pass with a clearly visible **Out Date** and **Out Time**.
2. Complete the existing approval workflow or use the existing HOD/Admin final override.
3. Show the generated QR slip displaying its **Use by** deadline, which is exactly 3 hours after the mentioned out time.
4. Scan the QR within that window and show **VALID — PASS ACCEPTED**.
5. For the expiry case, use a test pass whose mentioned out time is at least 3 hours in the past, scan it, and show **TIME LIMIT COMPLETED**. The server must return this result; the client must not manufacture the expiry locally.
6. For the verification-timeout case, separately demonstrate that a scan whose server verification does not complete within 30 seconds stops verification and does not admit the student. This 30-second timeout is independent of the 3-hour QR validity window.
7. Scan a successfully used QR a second time and show the existing **ALREADY USED** response.

Evidence should include: the request showing the mentioned out time, the approved QR slip/deadline, the successful VALID result, the post-3-hour TIME LIMIT COMPLETED result, and the second-scan ALREADY USED result.

# Gate Pass Verification — Review Evidence & Acceptance Checklist

This build keeps the existing gate-pass request, teacher/mentor, guardian, HOD/Admin, QR-letter, notification, scan and single-use behavior. The targeted fix adds a 30-second server-authoritative QR lifetime and a final HOD/Admin override path.

## What changed

1. **30-second QR lifetime**
   - A QR is issued only after HOD/Admin approval.
   - The server sets `expiresAt` to 30 seconds after that approval.
   - The database redemption query checks `expiresAt` server-side, so changing the phone clock cannot extend the QR.
   - The existing `qrUsed` atomic update still makes the first successful scan consume the QR immediately.
2. **No endless verification spinner**
   - The standalone verifier has a 30-second request timeout.
   - The in-app legacy verification path also has a 30-second timeout.
   - A timed-out verification is shown as expired/do-not-admit instead of spinning forever.
3. **HOD/Admin final override**
   - The normal teacher/mentor/guardian workflow remains available.
   - HOD/Admin can make the final decision while a pending request is in `teacher_mentor`, `guardian`, or `hod` stage.
   - When HOD/Admin approves an earlier-stage request, the pass records the stage that was bypassed and becomes `approved` with a fresh QR.
   - Teacher availability is therefore not a prerequisite for a final HOD/Admin decision.

## Evidence to show a reviewer

### A. Static/code evidence
Provide these files from the submitted build:

- `backend/src/routes/gatePasses.js` — 30-second TTL, atomic redemption, HOD override.
- `frontend/gate-pass-verify.html` — standalone verifier and 30-second timeout.
- `mainapp.js` — in-app verification timeout and HOD/Admin queue behavior.
- `frontend/app-runtime.js` — deployed frontend runtime contains the same fix.
- `backend/tests/gatePassExpiryAndHodOverride.test.js` — regression coverage for the requested behavior.

### B. Runtime evidence
Use one fresh test gate-pass request and capture these screenshots/video frames:

1. **Pending request:** show the student request and its current pipeline stage.
2. **HOD/Admin without teacher:** leave the request in an earlier stage or use a test branch with no mapped teacher; open HOD/Admin Mode and show that the request is still available for final action.
3. **HOD approval:** show the HOD/Admin signature and click **Approve & Stamp**.
4. **Approved result:** show `Approved` and the generated QR/permission letter. Capture the displayed `expiresAt`/30-second validity if visible in the UI or the server/database log.
5. **Successful first scan:** scan the QR from a separate device. The verifier must show `VALID — PASS ACCEPTED` only after the server responds.
6. **Second scan:** scan the same QR again. It must show `ALREADY USED — EXPIRED` (the first successful scan consumes it atomically).
7. **Old QR after 30 seconds:** generate another approved test pass, wait at least 31 seconds without scanning, then scan it. It must show `EXPIRED`.
8. **Verification timeout:** if the verifier cannot reach the server, leave it open. At 30 seconds it must stop loading and show a do-not-admit/expired result rather than spinning indefinitely.

### C. Project Reviewer evidence
The Project Reviewer is a separate academic-review feature from gate-pass authorization. To demonstrate it independently, provide:

- Project title and problem statement.
- Architecture/system diagram.
- Technology stack and why each major technology is used.
- Module-by-module implementation evidence.
- Database/API evidence for important workflows.
- Test cases with expected vs actual results.
- Performance/security evidence where relevant.
- Screenshots of the working application.
- Repository/commit or source-file references for each important claim.
- Demo/deployed URL when available.
- A short limitations/future-scope section.
- Viva answers/cross-question evidence produced by the Project Reviewer.

For every important claim, use the pattern **Claim → Evidence → Source/file → Test/result**. Do not rely on a screenshot alone when a source file or test can substantiate the claim.

## Automated checks run on this build

- `node backend/tests/gatePassExpiryAndHodOverride.test.js`
- `node backend/tests/gatePassRouteRegression.test.js`
- `node backend/tests/gatePassSanitize.test.js`
- `node backend/tests/projectReviewAdvanced.test.js`
- `node backend/tests/advancedFrontend.test.js`
- `node --check backend/src/routes/gatePasses.js`
- `node --check mainapp.js`
- `node --check frontend/app-runtime.js`

The full backend test suite may require the project's installed dependencies/database/AI services; the targeted regression and syntax checks above do not require those external services.
