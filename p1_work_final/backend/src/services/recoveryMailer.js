// Password-recovery e-mail delivery (EmailJS REST API, called from the server).
//
// Configuration is resolved in this order:
//   1. Environment variables (Vercel -> Settings -> Environment Variables):
//        RECOVERY_EMAILJS_SERVICE_ID / _TEMPLATE_ID / _PUBLIC_KEY / _PRIVATE_KEY
//      (the shorter EMAILJS_SERVICE_ID / EMAILJS_TEMPLATE_ID / EMAILJS_PUBLIC_KEY /
//       EMAILJS_PRIVATE_KEY names are accepted too)
//   2. The values an Admin saved from the portal's Settings screen. Those are stored in the
//      Neon database (PortalKV scope "system", never readable through /api/storage).
//
// IMPORTANT (EmailJS rule): the REST API is only accepted from a server when
//   - "Allow EmailJS API for non-browser applications" is ON  (EmailJS -> Account -> Security)
//   - the request carries the account PRIVATE key (accessToken)
// Without those two, EmailJS answers 403 and no mail is sent. Errors are therefore surfaced
// (server log + admin test endpoint) instead of being silently swallowed.
const prisma = require('../db');
const { read: readSecretConfig, write: writeSecretConfig } = require('./systemSecrets');

const SYSTEM_SCOPE = 'system';
const SYSTEM_OWNER = 'SYSTEM';
const CONFIG_KEY = 'emailjs-config';

const clean = (v) => String(v == null ? '' : v).trim();
const pick = (...names) => { for (const n of names) { const v = clean(process.env[n]); if (v) return v; } return ''; };

async function loadStoredConfig() {
  try { return await readSecretConfig(SYSTEM_SCOPE, CONFIG_KEY, SYSTEM_OWNER); } catch (_) { return {}; }
}

async function resolveConfig() {
  const stored = await loadStoredConfig();
  const cfg = {
    serviceId: pick('RECOVERY_EMAILJS_SERVICE_ID', 'EMAILJS_SERVICE_ID') || clean(stored.serviceId),
    templateId: pick('RECOVERY_EMAILJS_TEMPLATE_ID', 'EMAILJS_TEMPLATE_ID') || clean(stored.templateId),
    publicKey: pick('RECOVERY_EMAILJS_PUBLIC_KEY', 'EMAILJS_PUBLIC_KEY') || clean(stored.publicKey),
    privateKey: pick('RECOVERY_EMAILJS_PRIVATE_KEY', 'EMAILJS_PRIVATE_KEY') || clean(stored.privateKey),
  };
  const missing = [];
  if (!cfg.serviceId) missing.push('service id');
  if (!cfg.templateId) missing.push('template id');
  if (!cfg.publicKey) missing.push('public key');
  if (!cfg.privateKey) missing.push('private key (required for server-side sending)');
  cfg.missing = missing;
  // Server-side EmailJS delivery requires the account private key as well as the public key.
  // Treat a partial config as NOT configured so recovery never advances to the OTP step
  // when the server cannot actually send the message.
  cfg.configured = missing.length === 0;
  return cfg;
}

async function saveStoredConfig(input) {
  const old = await loadStoredConfig();
  const next = { ...old };
  for (const f of ['serviceId', 'templateId', 'publicKey', 'privateKey']) {
    if (input[f] !== undefined) {
      const v = clean(input[f]).slice(0, 300);
      // An empty private key in the form means "keep the one already saved".
      if (f === 'privateKey' && !v) continue;
      if (v) next[f] = v; else delete next[f];
    }
  }
  await writeSecretConfig(SYSTEM_SCOPE, CONFIG_KEY, next, SYSTEM_OWNER);
  return next;
}

function hintFor(status, text) {
  const t = String(text || '').toLowerCase();
  if (status === 403 && /non-browser|browser/.test(t)) return 'EmailJS blocks server calls. In EmailJS open Account -> Security and switch ON "Allow EmailJS API for non-browser applications", and make sure the Private Key is set.';
  if (status === 403) return 'EmailJS rejected the request (403). Check the Private Key and that "Allow EmailJS API for non-browser applications" is ON in Account -> Security.';
  if (status === 400 && /template/.test(t)) return 'EmailJS could not find the template. Re-check the Template ID (it starts with "template_").';
  if (status === 400 && /service/.test(t)) return 'EmailJS could not find the service. Re-check the Service ID (it starts with "service_").';
  if (status === 400 && /recipient|address|to_email|empty/.test(t)) return 'The recipient is empty. In the EmailJS template set the "To Email" field to {{to_email}}.';
  if (status === 400) return 'EmailJS returned 400. Verify Service ID, Template ID and Public Key belong to the same EmailJS account.';
  if (status === 401 || status === 412) return 'EmailJS authentication failed. Check the Public Key and Private Key, and reconnect the e-mail service in EmailJS if it shows "expired".';
  if (status === 402) return 'EmailJS quota is exhausted. Increase the EmailJS quota or connect a mail service with available capacity.';
  if (status === 429) return 'EmailJS is temporarily busy or rate-limiting the account. The portal already retries this delivery automatically; if it still fails, check the EmailJS account quota/status.';
  return 'EmailJS could not send the mail.';
}

// Sends the 6-digit code. Resolves { ok:true } or throws an Error with .status/.detail/.hint.
async function sendRecoveryCode(toEmail, code, opts = {}) {
  const cfg = opts.config || await resolveConfig();
  if (!cfg.configured) {
    const e = new Error('Password recovery e-mail is not configured on the server.');
    e.code = 'NOT_CONFIGURED'; e.hint = `Missing: ${cfg.missing.join(', ')}.`;
    throw e;
  }
  const params = {
    // Every common variable name is supplied so the template works whichever names it uses.
    to_email: toEmail, email: toEmail, user_email: toEmail, recipient: toEmail, reply_to: toEmail,
    to_name: opts.name || toEmail.split('@')[0], name: opts.name || toEmail.split('@')[0],
    passcode: code, code, otp: code, token: code, verification_code: code,
    purpose: opts.purpose || 'password reset', expires_in: opts.expiresIn || '10 minutes',
    subject: opts.subject || 'Your password reset code',
    message: opts.message || `Your password reset code is ${code}. It expires in ${opts.expiresIn || '10 minutes'}. If you did not request it, ignore this mail.`,
  };
  const body = { service_id: cfg.serviceId, template_id: cfg.templateId, user_id: cfg.publicKey, template_params: params };
  if (cfg.privateKey) body.accessToken = cfg.privateKey;
  // EmailJS can transiently answer 429/5xx while its API or the connected mail service
  // is busy. Retry the SAME code instead of creating a second recovery record or asking the
  // student to restart the flow. A provider quota exhaustion is still surfaced as a real
  // delivery error, but it is never propagated as an Express 429 from this route.
  const maxRetries = Math.max(0, Math.min(2, Number(process.env.RECOVERY_EMAIL_MAX_RETRIES || 1)));
  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response = null;
    try {
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), Number(process.env.RECOVERY_EMAIL_TIMEOUT_MS || 20000)) : null;
      try {
        response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined,
        });
      } finally {
        if (timer) clearTimeout(timer);
      }
    } catch (err) {
      lastError = new Error('Could not reach EmailJS.');
      lastError.code = 'NETWORK'; lastError.detail = String(err && err.message || err);
      lastError.hint = 'The server could not connect to api.emailjs.com.';
      if (attempt < maxRetries) { await new Promise(r => setTimeout(r, 700 * (attempt + 1))); continue; }
      throw lastError;
    }

    if (response.ok) return { ok: true };

    const text = await response.text().catch(() => '');
    let providerMessage = text;
    try {
      const parsed = JSON.parse(text);
      providerMessage = parsed?.error || parsed?.message || parsed?.detail || text;
    } catch (_) {}
    const retryable = response.status === 429 || response.status >= 500;
    lastError = new Error(`EmailJS responded HTTP ${response.status}`);
    lastError.code = 'PROVIDER'; lastError.status = response.status;
    lastError.detail = String(providerMessage).slice(0, 500);
    lastError.hint = hintFor(response.status, providerMessage);
    if (retryable && attempt < maxRetries) {
      const retryAfter = Number(response.headers?.get?.('Retry-After')) || 0;
      const delay = Math.min(8000, Math.max(900 * (attempt + 1), retryAfter * 1000));
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    throw lastError;
  }
  throw lastError || new Error('EmailJS could not send the recovery e-mail.');
}

module.exports = { resolveConfig, saveStoredConfig, sendRecoveryCode };
