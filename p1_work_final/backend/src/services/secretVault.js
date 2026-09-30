'use strict';

// Small dependency-free envelope encryption layer for server-side integration secrets.
// Secrets are never returned to the browser. AES-256-GCM provides confidentiality + integrity.
// The master key lives outside PostgreSQL (PORTAL_SECRETS_ENCRYPTION_KEY). JWT_ACCESS_SECRET is
// accepted only as a development/legacy fallback so an existing installation can migrate safely.
const crypto = require('crypto');

const VERSION = 1;
const ALG = 'aes-256-gcm';

function masterKey() {
  const explicit = String(process.env.PORTAL_SECRETS_ENCRYPTION_KEY || '').trim();
  const fallback = String(process.env.JWT_ACCESS_SECRET || '').trim();
  const developmentFallback = process.env.NODE_ENV === 'production' ? '' : 'campus-portal-development-secret-v1-do-not-use-in-production';
  const raw = explicit || fallback || developmentFallback;
  if (!raw || raw.length < 32) {
    const e = new Error('PORTAL_SECRETS_ENCRYPTION_KEY must be at least 32 characters.');
    e.code = 'SECRET_VAULT_KEY_MISSING';
    throw e;
  }
  // Hashing a high-entropy deployment secret into a fixed 32-byte AES key keeps the storage
  // format simple while avoiding provider-specific key length requirements.
  return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

function isEncrypted(value) {
  return !!value && typeof value === 'object' && value.__encrypted === true && value.v === VERSION && value.alg === ALG && typeof value.iv === 'string' && typeof value.tag === 'string' && typeof value.data === 'string';
}

function encryptObject(value) {
  const key = masterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const plaintext = Buffer.from(JSON.stringify(value && typeof value === 'object' ? value : {}), 'utf8');
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { __encrypted: true, v: VERSION, alg: ALG, iv: iv.toString('base64url'), tag: tag.toString('base64url'), data: data.toString('base64url') };
}

function decryptObject(value) {
  if (!isEncrypted(value)) return value && typeof value === 'object' ? value : {};
  const key = masterKey();
  const decipher = crypto.createDecipheriv(ALG, key, Buffer.from(value.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64url'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(value.data, 'base64url')), decipher.final()]);
  const decoded = JSON.parse(plaintext.toString('utf8'));
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('Encrypted configuration is malformed.');
  return decoded;
}

function productionKeyConfigured() {
  return String(process.env.PORTAL_SECRETS_ENCRYPTION_KEY || '').trim().length >= 32;
}

module.exports = { VERSION, ALG, isEncrypted, encryptObject, decryptObject, productionKeyConfigured };
