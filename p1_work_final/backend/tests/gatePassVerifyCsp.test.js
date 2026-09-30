'use strict';
// Regression: the standalone gate-pass verifier must run under the production CSP
// (script-src 'self' + nonce, no 'unsafe-inline'). An un-nonced inline script or an inline
// onclick handler is blocked, which leaves the guard stuck on "Verifying...".
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { addNonceToInlineScripts, scanInlineScripts } = require('../src/utils/htmlScripts');

const html = fs.readFileSync(path.join(__dirname, '../../frontend/gate-pass-verify.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const route = fs.readFileSync(path.join(__dirname, '../src/routes/gatePasses.js'), 'utf8');

assert.match(server, /app\.get\('\/gate-pass-verify\.html', sendGatePassVerify\)/);
assert.ok(server.indexOf("app.get('/gate-pass-verify.html'") < server.indexOf('app.use(express.static(frontendRoot'),
  'verify route must be registered before express.static');
assert.doesNotMatch(html, /\sonclick\s*=/i, 'inline event handlers are blocked by the CSP');
assert.equal(scanInlineScripts(html).length, 1);
const out = addNonceToInlineScripts(html, 'TESTNONCE');
assert.match(out, /<script nonce="TESTNONCE">/);
assert.match(route, /fallback\(\)/, 'QR expiry must fall back to +3h when out date/time is missing');
assert.match(route, /'qrValidUntil','hodOverride'/, 'display/audit fields must be server-controlled');
console.log('Gate-pass verifier CSP regression checks passed.');
