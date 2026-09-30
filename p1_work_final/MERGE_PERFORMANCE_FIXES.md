{
  "base": "campus-portal-final-combined-direct-login.zip",
  "merge_strategy": "Second archive retained all 471 files from first plus 43 additional files; all common files were compared and the second archive's versions retained unless targeted performance/security fixes were applied.",
  "preserved_features": "All files/features from both archives; first archive had no files absent from second.",
  "fixes": [
    "Removed automatic scroll restoration from DOM-mutation observer to stop tabs/pages jumping.",
    "Throttled DOM accessibility/performance hardening instead of scanning all buttons/images on every mutation.",
    "Raised global API rate-limit defaults and changed misleading portal-busy response while retaining configurable limits and dedicated auth/AI limits.",
    "Optimized unauthenticated account lookup to avoid an unnecessary PortalKV query for normal User records.",
    "Made login-attempt/audit persistence local-first and background so sign-in is not blocked by remote KV latency.",
    "Kept role/account healing asynchronous so successful login can complete immediately.",
    "Reduced recovery-mail provider timeout/retry defaults while retaining delivery diagnostics and retry handling.",
    "Ran Node syntax checks over the merged JavaScript tree."
  ],
  "note": "Actual recovery email delivery still requires valid EmailJS credentials/private key and provider settings; code now surfaces configuration/delivery errors rather than hanging silently."
}