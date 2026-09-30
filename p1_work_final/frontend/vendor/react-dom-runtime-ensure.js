/* Campus Portal production ReactDOM runtime guard.
   ReactDOM is a required local/same-origin asset. There is deliberately NO CDN fallback. */
(function () {
  'use strict';
  if (window.ReactDOM && typeof window.ReactDOM.createRoot === 'function') {
    window.__TNP_REACTDOM_RUNTIME_OK__ = true;
    return;
  }
  window.__TNP_REACTDOM_RUNTIME_OK__ = false;
  window.__TNP_BOOT_ASSET_ERROR__ = './vendor/react-dom.production.min.js';
  console.error('[Campus Portal] Required ReactDOM runtime failed to load from the same origin.');
}());
