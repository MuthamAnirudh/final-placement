const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const project = path.join(root, '..');
const frontend = fs.readFileSync(path.join(project, 'frontend', 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const render = fs.readFileSync(path.join(project, 'render.yaml'), 'utf8');

for (const asset of [
  'react.production.min.js',
  'react-dom.production.min.js',
  'tailwindcss-browser.js',
  'pptxgen.bundle.js',
  'email.min.js',
  'html2canvas.min.js',
  'jspdf.umd.min.js',
  'qrcode.min.js',
  'face-api.js'
]) {
  const file = path.join(project, 'frontend', 'vendor', asset);
  assert(fs.existsSync(file), `Missing production vendor asset: ${asset}`);
  assert(fs.statSync(file).size > 100, `Vendor asset is unexpectedly small: ${asset}`);
}

assert(frontend.includes('./vendor/react.production.min.js'), 'React must load from same-origin vendor assets.');
assert(frontend.includes('./vendor/react-dom.production.min.js'), 'ReactDOM must load from same-origin vendor assets.');
assert(frontend.includes('./app-runtime.js'), 'Application runtime must be loaded as a deferred same-origin asset.');
assert(fs.existsSync(path.join(project, 'frontend', 'app-runtime.js')), 'Missing deferred application runtime asset.');
assert(fs.statSync(path.join(project, 'frontend', 'app-runtime.js')).size > 1000000, 'Deferred application runtime is unexpectedly small.');
assert(!frontend.includes('data-fallback='), 'Critical frontend scripts must not have CDN fallback attributes.');
assert(!frontend.includes('unpkg.com/react@18.3.1'), 'React must not fall back to unpkg.');
assert(!frontend.includes('cdnjs.cloudflare.com/ajax/libs/react/18.3.1'), 'React must not fall back to cdnjs.');
assert(!frontend.includes('unpkg.com and its cdnjs backup'), 'Startup watchdog must not blame a CDN/network without evidence.');
assert(server.includes("app.listen(PORT, '0.0.0.0'"), 'Render server must bind to 0.0.0.0.');
assert(server.includes('process.env.PORT'), 'Render server must use the platform PORT.');
assert(server.includes("app.get('/api/health/live'"), 'Render liveness endpoint is missing.');
assert(server.includes('RENDER_EXTERNAL_URL'), 'Render origin should be supported automatically.');
assert(render.includes('type: web'), 'Render blueprint must deploy a Web Service.');
assert(render.includes('healthCheckPath: /api/health/live'), 'Render health check must use the lightweight liveness endpoint.');

console.log('Render deployment regression checks passed.');
