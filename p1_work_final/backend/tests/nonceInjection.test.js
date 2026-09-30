'use strict';
// Regression: the server's CSP-nonce injection must never alter inline script TEXT.
// (It used to regex-match "<script>" inside JS comments, which changed the hash of the 3.6MB app script,
// so the meta-CSP silently blocked the whole app on Render: React loaded, nothing mounted.)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { scanInlineScripts, addNonceToInlineScripts } = require('../src/utils/htmlScripts');

// Unit cases
const tricky = '<!-- a <script> in a comment -->\n<script>var a = "<script>"; // see <script> tag\n</script>\n<script src="x.js"></script>\n<script type="module">1</script>';
const out = addNonceToInlineScripts(tricky, 'N');
assert.strictEqual((out.match(/nonce="N"/g) || []).length, 2, 'only the two real inline scripts get a nonce');
assert(out.includes('<!-- a <script> in a comment -->'), 'comments untouched');
assert(out.includes('var a = "<script>"; // see <script> tag'), 'script text untouched');
assert(out.includes('<script src="x.js"></script>'), 'external scripts untouched');

// Real artifact
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'index.html'), 'utf8');
const before = scanInlineScripts(html);
const after = scanInlineScripts(addNonceToInlineScripts(html, 'TESTNONCE'));
assert.strictEqual(after.length, before.length, 'same number of inline scripts');
before.forEach((s, i) => assert.strictEqual(after[i].body, s.body, `inline script #${i} text must be unchanged by nonce injection`));
const csp = (html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i) || [, ''])[1];
for (const s of after) {
  const h = `'sha256-${crypto.createHash('sha256').update(s.body, 'utf8').digest('base64')}'`;
  assert(csp.includes(h), 'served inline script hash must be in the static CSP');
}
assert(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8').includes('addNonceToInlineScripts('), 'server must use the safe injector');
console.log('Nonce injection regression checks passed.');
