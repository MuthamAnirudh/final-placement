#!/usr/bin/env node
'use strict';

/*
 * Campus Portal production vendor verification.
 *
 * IMPORTANT:
 * The application ships the browser runtimes in frontend/vendor. Production builds must
 * therefore be deterministic and must NOT require unpkg/cdnjs/jsDelivr access.
 *
 * If a vendor file is missing, fail the build with the exact file name. An explicit
 * VENDOR_FETCH=1 may be used by maintainers to refresh the checked-in assets in a
 * network-enabled environment; normal Render builds never download third-party runtime
 * files.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const root = path.join(__dirname, '..', '..');
const out = path.join(root, 'frontend', 'vendor');
fs.mkdirSync(out, { recursive: true });

const assets = {
  'react.production.min.js': 'https://unpkg.com/react@18.3.1/umd/react.production.min.js',
  'react-dom.production.min.js': 'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js',
  'tailwindcss-browser.js': 'https://cdn.tailwindcss.com',
  'pptxgen.bundle.js': 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js',
  'email.min.js': 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js',
  'html2canvas.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'jspdf.umd.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'qrcode.min.js': 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js',
  'face-api.js': 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/dist/face-api.js'
};

const minimumBytes = {
  'react.production.min.js': 10000,
  'react-dom.production.min.js': 10000,
  'tailwindcss-browser.js': 100,
  'pptxgen.bundle.js': 50000,
  'email.min.js': 3000,
  'html2canvas.min.js': 50000,
  'jspdf.umd.min.js': 50000,
  'qrcode.min.js': 5000,
  'face-api.js': 50000
};

function validate(name) {
  const file = path.join(out, name);
  if (!fs.existsSync(file)) return { ok: false, reason: 'missing' };
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size < (minimumBytes[name] || 1)) {
    return { ok: false, reason: `too-small (${stat.size} bytes)` };
  }
  const sample = fs.readFileSync(file, { encoding: 'utf8' }).slice(0, 1000).trimStart();
  if (/^<!doctype html/i.test(sample) || /^<html/i.test(sample) || /<head[\s>]/i.test(sample)) {
    return { ok: false, reason: 'contains HTML instead of JavaScript' };
  }
  return { ok: true, bytes: stat.size };
}

function get(url, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('Too many redirects'));
    const u = new URL(url);
    const req = https.get(u, { headers: { 'User-Agent': 'campus-portal-vendor-builder' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(get(new URL(res.headers.location, u).href, depth + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`${url} -> HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('download timeout')));
  });
}

async function refreshMissingAssets() {
  for (const [name, url] of Object.entries(assets)) {
    const current = validate(name);
    if (current.ok) {
      console.log(`[vendor] using committed ${name} (${current.bytes} bytes)`);
      continue;
    }
    console.log(`[vendor] ${name} is ${current.reason}; VENDOR_FETCH=1 is enabled, downloading pinned asset...`);
    const data = await get(url);
    if (data.length < (minimumBytes[name] || 1)) {
      throw new Error(`Refusing suspiciously small asset: ${name} (${data.length} bytes)`);
    }
    const sample = data.toString('utf8', 0, Math.min(data.length, 1000)).trimStart();
    if (/^<!doctype html/i.test(sample) || /^<html/i.test(sample)) {
      throw new Error(`Downloaded HTML instead of JavaScript for ${name}`);
    }
    const tmp = path.join(out, `.${name}.tmp`);
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, path.join(out, name));
  }
}

(async () => {
  const fetchEnabled = process.env.VENDOR_FETCH === '1';
  if (fetchEnabled) await refreshMissingAssets();

  const missing = [];
  for (const name of Object.keys(assets)) {
    const result = validate(name);
    if (!result.ok) missing.push(`${name}: ${result.reason}`);
  }

  if (missing.length) {
    throw new Error(
      'Production browser assets are missing or invalid. ' +
      'Commit the required files under frontend/vendor/ or run VENDOR_FETCH=1 npm run build:frontend-vendor ' +
      'once in a network-enabled maintainer environment. Missing/invalid: ' + missing.join(', ')
    );
  }

  fs.writeFileSync(
    path.join(out, 'MANIFEST.json'),
    JSON.stringify({
      version: 1,
      source: 'committed-production-assets',
      assets: Object.fromEntries(Object.keys(assets).map((name) => [name, validate(name).bytes]))
    }, null, 2) + '\n'
  );

  console.log('[vendor] production browser asset verification passed; no CDN download was required.');
})().catch((err) => {
  console.error('[vendor] FATAL:', err.message || err);
  process.exit(1);
});
