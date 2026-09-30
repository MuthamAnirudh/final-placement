/* Campus Portal production React runtime guard.
   React is a required local/same-origin asset. There is deliberately NO CDN fallback here.
   A missing vendor file is a deployment-artifact error and must never make production startup
   depend on unpkg/cdnjs or another third-party host. */
(function () {
  'use strict';
  if (window.React) {
    window.__TNP_REACT_RUNTIME_OK__ = true;
    return;
  }
  window.__TNP_REACT_RUNTIME_OK__ = false;
  window.__TNP_BOOT_ASSET_ERROR__ = './vendor/react.production.min.js';
  console.error('[Campus Portal] Required React runtime failed to load from the same origin.');
}());
