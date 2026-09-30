'use strict';

// Production build gate for the source-served React application. It deliberately does not rewrite
// the protected Resume component or introduce a bundler that could change runtime behavior. Instead
// it validates the final artifact, synchronizes the static CSP hash allow-list, requires all critical
// browser runtimes to be vendored, and runs the existing production invariants.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const crypto = require('crypto');

const backendRoot = path.join(__dirname, '..');
const projectRoot = path.join(backendRoot, '..');
const frontendRoot = path.join(projectRoot, 'frontend');
const required = [
  path.join(backendRoot, 'server.js'),
  path.join(backendRoot, 'prisma', 'schema.prisma'),
  path.join(frontendRoot, 'index.html'),
  path.join(frontendRoot, 'app-runtime.js'),
  path.join(backendRoot, 'src', 'services', 'secretVault.js'),
];
for (const file of required) if (!fs.existsSync(file)) throw new Error(`Required production artifact is missing: ${file}`);

// Keep CSP synchronized with every inline script before testing/deploying the artifact.
execFileSync(process.execPath, [path.join(__dirname, 'sync-frontend-csp.js')], { stdio: 'inherit', cwd: backendRoot });

const vendorDir = path.join(frontendRoot, 'vendor');
const criticalVendor = [
  ['react.production.min.js', 10000],
  ['react-dom.production.min.js', 10000],
  ['tailwindcss-browser.js', 100],
  ['pptxgen.bundle.js', 50000],
  ['html2canvas.min.js', 50000],
  ['jspdf.umd.min.js', 50000],
  ['qrcode.min.js', 5000],
  ['face-api.js', 50000],
  ['email.min.js', 3000],
];
const missing = criticalVendor.filter(([name, min]) => {
  const p = path.join(vendorDir, name);
  try { return fs.statSync(p).size < min; } catch (_) { return true; }
});
if (missing.length) {
  throw new Error('Production browser assets are not vendored. Run `npm run build:frontend-vendor` with network access before deployment. Missing: ' + missing.map(x => x[0]).join(', '));
}

// The application is shipped as a deferred same-origin runtime file. This keeps the HTML
// authentication shell paintable immediately on slow/mobile devices instead of blocking the
// first frame on a multi-megabyte inline script.
const front = fs.readFileSync(path.join(frontendRoot, 'index.html'), 'utf8');
const appRuntimePath = path.join(frontendRoot, 'app-runtime.js');
if (!fs.existsSync(appRuntimePath)) throw new Error('Deferred application runtime is missing: frontend/app-runtime.js');
const appRuntime = fs.readFileSync(appRuntimePath, 'utf8');
const appMarker = 'const { useState, useEffect, useMemo, useRef } = React;';
if (appRuntime.indexOf(appMarker) < 0) throw new Error('Main precompiled application marker could not be located in frontend/app-runtime.js.');
if (!front.includes('./app-runtime.js')) throw new Error('index.html must load the deferred application runtime.');
const csp = (front.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i) || [,''])[1];
if (csp.includes("'unsafe-eval'")) throw new Error('Production CSP must not contain unsafe-eval.');
if (/script-src[^;]*'unsafe-inline'/.test(csp)) throw new Error('Production script-src must not contain unsafe-inline.');

execFileSync(process.execPath, ['--check', path.join(backendRoot, 'server.js')], { stdio: 'inherit' });
execFileSync(process.execPath, [path.join(__dirname, 'production-audit.js')], { stdio: 'inherit' });
console.log('Production build validation passed.');
