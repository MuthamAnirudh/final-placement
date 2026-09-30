const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const projectRoot = path.join(root, '..');
const frontPath = path.join(projectRoot, 'frontend', 'index.html');
const front = fs.readFileSync(frontPath, 'utf8');
const appRuntimePath = path.join(projectRoot, 'frontend', 'app-runtime.js');
const appRuntime = fs.readFileSync(appRuntimePath, 'utf8');
assert(fs.existsSync(appRuntimePath), 'Deferred application runtime is missing');
assert(front.includes('./app-runtime.js'), 'index.html must load the deferred application runtime');

assert(front.includes('./vendor/react-runtime-ensure.js'), 'React runtime guard must exist');
assert(front.includes('./vendor/react-dom-runtime-ensure.js'), 'ReactDOM runtime guard must exist');
assert(front.includes('href="./tailwind-static.css"'), 'Self-contained Tailwind static CSS fallback must be linked');
assert(front.includes('cp-auth-page'), 'Premium authentication shell is missing');
assert(front.includes('body:has(.cp-auth-page) #cp-account-widget-root'), 'Duplicate account widget must be hidden on the authentication screen');
assert(fs.existsSync(path.join(projectRoot, 'frontend', 'tailwind-static.css')), 'Tailwind static CSS artifact is missing');
assert(fs.statSync(path.join(projectRoot, 'frontend', 'tailwind-static.css')).size > 100000, 'Tailwind static CSS artifact is unexpectedly small');
assert(front.includes("script-src 'self'"), 'CSP must explicitly allow only same-origin scripts plus listed hashes/origins');
assert(!front.includes("'unsafe-eval'"), 'unsafe-eval must remain disabled');
assert(!/script-src[^;]*'unsafe-inline'/.test(front), 'JavaScript script-src must not use unsafe-inline');
assert(appRuntime.includes('function ProjectReviewCommandCenter'), 'advanced project review command center missing');
assert(appRuntime.includes('Claim traceability matrix'), 'project review evidence matrix missing');
assert(appRuntime.includes('function VivaReadinessCommandCenter'), 'advanced viva readiness lab missing');
assert(appRuntime.includes('Weakest viva topics'), 'viva adaptive weak-topic dashboard missing');
assert(appRuntime.includes('Advanced Analysis Lab'), 'advanced analysis workspace missing');
assert(appRuntime.includes('Evidence Quality Index'), 'analysis evidence-quality layer missing');
assert(appRuntime.includes('/api/ai'), 'frontend must use the secure same-origin AI gateway');
assert(!/https:\/\/(?:api\.)?(?:groq|openai|anthropic)\.com/i.test(appRuntime), 'frontend must not call LLM providers directly');
assert(!/generativelanguage\.googleapis\.com/i.test(appRuntime), 'frontend must not call Gemini directly');
assert(!/(?:localStorage|sessionStorage)\.(?:getItem|setItem)\(\s*['"][^'"]*(?:GROQ|OPENAI|GEMINI|CLAUDE|API_KEY)[^'"]*['"]/i.test(front), 'provider API keys must not be stored in browser storage');

// Protect the Resume ATS component with a stable known-good fingerprint rather than a model/tool
// specific /mnt/data path. This keeps the regression test portable across CI, Vercel and local clones.
const a = appRuntime.indexOf('function ResumeAtsOptimizerPanel(');
assert(a > 0, 'Resume ATS component is missing');
const b = appRuntime.indexOf('\n}\n', a) + 2;
assert(b > a, 'Resume ATS component boundary could not be determined');
const resumeHash = crypto.createHash('sha256').update(appRuntime.slice(a, b)).digest('hex');
assert.strictEqual(resumeHash, '51139bac837395f0ef3fbf300a68c970cd1eceefaef2fc425e20e2dc356c7892', 'Resume ATS component was modified');

// Verify every inline script is represented in the static CSP. This is what makes the exact same
// artifact work on Vercel/static hosting, where Express cannot inject a nonce into index.html.
const hashes = [];
const { scanInlineScripts } = require('../src/utils/htmlScripts');
for (const sc of scanInlineScripts(front)) hashes.push(`'sha256-${crypto.createHash('sha256').update(sc.body, 'utf8').digest('base64')}'`);
const csp = (front.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i) || [,''])[1];
for (const h of hashes) assert(csp.includes(h), `Static CSP is missing inline script hash ${h}`);

console.log('Advanced frontend hardening checks passed.');
