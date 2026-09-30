#!/usr/bin/env node
'use strict';

// Generates the static CSP hash allow-list for every inline <script> in frontend/index.html.
// Express still adds a per-response nonce, but the hashes make the exact same artifact safe on
// Vercel/static hosting where no runtime HTML rewriting occurs. This removes the historic split
// behavior where Express worked while static deployment could block the main React application.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const file = path.join(__dirname, '..', '..', 'frontend', 'index.html');
let html = fs.readFileSync(file, 'utf8');
const hashes = [];
const { scanInlineScripts } = require('../src/utils/htmlScripts');
// Hash only the REAL inline scripts (comments that merely mention "<script>" are not scripts).
for (const sc of scanInlineScripts(html)) {
  const digest = crypto.createHash('sha256').update(sc.body, 'utf8').digest('base64');
  hashes.push(`'sha256-${digest}'`);
}
const unique = [...new Set(hashes)];
const meta = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*\/>/i;
const match = html.match(meta);
if (!match) throw new Error('CSP meta tag not found in frontend/index.html');
let csp = match[1]
  .replace(/\s*'sha256-[^']+'/g, '')
  .replace(/\s+/g, ' ')
  .trim();
const marker = "script-src 'self'";
if (!csp.includes(marker)) throw new Error('CSP script-src self directive is missing');
const scriptDirectiveEnd = csp.indexOf(';', csp.indexOf(marker));
if (scriptDirectiveEnd < 0) throw new Error('CSP script-src directive is malformed');
const before = csp.slice(0, scriptDirectiveEnd);
const after = csp.slice(scriptDirectiveEnd);
const newScript = before + ' ' + unique.join(' ') + after;
csp = newScript;
html = html.replace(meta, `<meta http-equiv="Content-Security-Policy" content="${csp}" />`);
if (csp.includes("'unsafe-eval'")) throw new Error('CSP must not contain unsafe-eval');
if (/script-src[^;]*'unsafe-inline'/.test(csp)) throw new Error('JavaScript script-src must not contain unsafe-inline');
fs.writeFileSync(file, html);
console.log(`CSP synchronized: ${unique.length} inline script hashes.`);
