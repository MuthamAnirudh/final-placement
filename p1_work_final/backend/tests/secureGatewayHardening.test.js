const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const frontend = fs.readFileSync(path.join(root, '..', 'frontend', 'index.html'), 'utf8');
const appRuntime = fs.readFileSync(path.join(root, '..', 'frontend', 'app-runtime.js'), 'utf8');
const frontendSource = frontend + '\n' + appRuntime;
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const vendorBuild = fs.readFileSync(path.join(root, 'scripts', 'vendor-frontend-assets.js'), 'utf8');
const matcher = fs.readFileSync(path.join(root, '..', 'ai-ml-service', 'app', 'services', 'matcher.py'), 'utf8');

for (const secret of ['CLAUDE_API_KEY','OPENAI_API_KEY','GEMINI_API_KEY','GROQ_API_KEY']) {
  assert(!frontendSource.includes(secret), `frontend must not reference browser provider secret ${secret}`);
}
for (const url of ['api.groq.com','api.openai.com','api.anthropic.com','generativelanguage.googleapis.com']) {
  assert(!frontendSource.includes(url), `frontend must not call provider ${url} directly`);
}
assert(frontendSource.includes("fetch('/api/ai'"), 'frontend must use secure AI gateway');
assert(frontendSource.includes("fetch('/api/ai/stream'"), 'frontend must use secure AI streaming gateway');
assert(frontendSource.includes("fetch('/api/ai/image'"), 'image generation must use secure server gateway');
assert(frontend.includes("script-src 'self'"), 'frontend CSP must define a strict script policy');
assert(!frontend.includes("'unsafe-eval'"), 'frontend CSP must not allow unsafe-eval');
assert(!frontend.includes("default-src 'self' https:"), 'frontend CSP must not broadly allow every HTTPS origin');
assert(server.includes('containsSensitivePrompt'), 'backend must classify sensitive AI prompts');
assert(server.includes('safe.noCache = true'), 'backend must force no-cache for sensitive prompts');
assert(server.includes('CACHE_MAX_RESPONSE_CHARS'), 'backend AI cache must have a response-size guard');
assert(server.includes("app.post('/api/ai/image'"), 'backend must own image generation');
assert(vendorBuild.includes('frontend/vendor'), 'production build must support self-hosted runtime assets');
assert(matcher.includes('offline-hybrid-hash-tfidf'), 'lightweight ML fallback must expose its quality tier');
assert(matcher.includes('confidence'), 'lightweight ML results must expose confidence');
console.log('Secure gateway hardening static checks passed.');
