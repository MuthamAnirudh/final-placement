'use strict';
// Cold-start regression test (no real database / network needed):
//  1. the first DB read fails twice (Neon still waking up)  -> the FIRST /api/ai/stream must still work
//  2. an empty Groq answer is not reported as success
//  3. the AI/ML gateway waits for a sleeping remote service (Render free tier) instead of failing
//  4. /api/ai-ml-status answers fast while the service is asleep and reports waking -> available
const assert = require('assert');
const http = require('http');
const Module = require('module');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'a'.repeat(40);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(40);
process.env.VERCEL = '1';                                   // behave like a serverless instance (lazy config reload)
process.env.CORS_ORIGIN = 'http://localhost';
const ML_HOST = '127.0.0.2';                                 // not in the "local host" list -> treated as a REMOTE service
const ML_PORT = 18000 + Math.floor(Math.random() * 1000);
process.env.AI_ML_SERVICE_URL = `http://${ML_HOST}:${ML_PORT}`;
process.env.AI_ML_SERVICE_TOKEN = 'x'.repeat(40);

// ---- stub @prisma/client (its engine cannot be downloaded in CI sandboxes) ----
let kvCalls = 0;
const fakePrisma = new Proxy({}, { get: (_t, name) => {
  if (name === 'portalKV') return {
    findFirst: async () => { kvCalls++; if (kvCalls <= 2) throw new Error("Can't reach database server (Neon is waking up)"); return { value: { groqKey: 'gsk_test_key_1234567890' } }; },
    upsert: async () => ({}),
  };
  if (name === '$queryRaw' || name === '$connect' || name === '$disconnect') return async () => [];
  return new Proxy(function () {}, { get: () => async () => null, apply: async () => null });
} });
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@prisma/client') return { PrismaClient: function () { return fakePrisma; }, Prisma: {} };
  return origLoad.apply(this, arguments);
};

// ---- fake Groq (intercept global fetch for api.groq.com only) ----
let groqMode = 'ok';
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  if (String(url).startsWith('https://api.groq.com/')) {
    if (groqMode === 'empty') {
      return new Response('data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    const body = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Hello ' } }] }) + '\n\n' +
      'data: ' + JSON.stringify({ choices: [{ delta: { content: 'student!' } }] }) + '\n\ndata: [DONE]\n\n';
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }
  return realFetch(url, opts);
};

const { signAccessToken } = require('../src/auth');
const app = require('../server.js');

// ---- fake "Render" AI/ML service: only starts listening after 6 s (asleep before that) ----
const mlServer = http.createServer((req, res) => {
  if (req.url === '/health') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ status: 'ok', llm_configured: true })); }
  if (req.headers['x-service-token'] !== 'x'.repeat(40)) { res.statusCode = 401; return res.end('{"error":"Unauthorized."}'); }
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ topics: ['Algorithms'], sawGroqKey: !!req.headers['x-groq-key'] }));
});
const WAKE_MS = 6000;
const t0 = Date.now();
setTimeout(() => mlServer.listen(ML_PORT, ML_HOST), WAKE_MS);

(async () => {
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const token = signAccessToken({ id: 'stu1', email: '2571A47090@animail.com', role: 'STUDENT', name: 'Test' });
  try {
    // 4a) status while the service is asleep: fast answer, "waking"
    let t = Date.now();
    let r = await fetch(`${base}/api/ai-ml-status`); let j = await r.json();
    assert(Date.now() - t < 9000, 'status must answer quickly even when the service is asleep');
    assert.strictEqual(j.available, false); assert.strictEqual(j.state, 'waking');
    console.log('ok  status while asleep ->', JSON.stringify(j), `(${Date.now() - t} ms)`);

    // 1) FIRST AI message right after a cold start: DB fails twice, must still stream an answer
    r = await fetch(`${base}/api/ai/stream`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ systemPrompt: 's', userPrompt: 'hi', opts: {} }) });
    let text = await r.text();
    assert(text.includes('Hello ') && text.includes('student!') && !text.includes('"type":"error"'), 'first stream must succeed, got: ' + text.slice(0, 200));
    assert(kvCalls >= 3, 'the DB read must have been retried');
    console.log('ok  first AI message works after DB failed twice (DB calls:', kvCalls + ')');

    // 2) empty Groq answer is an error (not a silent empty success)
    groqMode = 'empty';
    r = await fetch(`${base}/api/ai/stream`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ systemPrompt: 's', userPrompt: 'hi', opts: {} }) });
    text = await r.text();
    assert(text.includes('"type":"error"') && text.includes('"retryable":true'), 'empty answer must be reported as a retryable error: ' + text.slice(0, 200));
    console.log('ok  empty provider answer -> retryable error event');
    groqMode = 'ok';

    // 3) gateway call issued while the service is still asleep: must wait for the wake-up and then succeed
    t = Date.now();
    r = await fetch(`${base}/api/ai-ml/adaptive/topics`, { headers: { authorization: `Bearer ${token}` } });
    j = await r.json();
    const waited = Date.now() - t0;
    assert.strictEqual(r.status, 200, 'gateway must succeed after the wake-up, got ' + r.status + ' ' + JSON.stringify(j));
    assert.deepStrictEqual(j.topics, ['Algorithms']); assert.strictEqual(j.sawGroqKey, true);
    assert(waited >= WAKE_MS - 300, 'must have waited for the service (' + waited + ' ms)');
    console.log(`ok  gateway waited for the sleeping service and answered 200 (${Date.now() - t} ms)`);

    // 4b) status afterwards: available
    r = await fetch(`${base}/api/ai-ml-status`); j = await r.json();
    assert.strictEqual(j.available, true); assert.strictEqual(j.state, 'external');
    console.log('ok  status after wake ->', JSON.stringify(j));

    // 5) wrong service token is reported as 401 (not swallowed)
    console.log('Cold start / AI-ML gateway tests passed.');
    process.exitCode = 0;
  } catch (e) { console.error('FAILED:', e && e.stack || e); process.exitCode = 1; }
  finally { srv.close(); mlServer.close(); setTimeout(() => process.exit(process.exitCode), 200); }
})();
