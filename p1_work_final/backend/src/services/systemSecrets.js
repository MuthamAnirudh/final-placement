'use strict';
const prisma = require('../db');
const { isEncrypted, encryptObject, decryptObject } = require('./secretVault');

async function read(scope, key, ownerId = 'SYSTEM') {
  const row = await prisma.portalKV.findFirst({ where: { scope, key, ownerId } });
  if (!row) return {};
  const value = row.value && typeof row.value === 'object' ? row.value : {};
  const decoded = decryptObject(value);
  // Transparent one-time migration for existing plaintext rows. If the deployment secret is
  // configured, the next read upgrades the old row without changing any application contract.
  if (Object.keys(value).length && !isEncrypted(value)) {
    try {
      await prisma.portalKV.update({ where: { id: row.id }, data: { value: encryptObject(decoded) } });
    } catch (_) { /* migration failure must not make an otherwise valid read fail */ }
  }
  return decoded;
}

async function write(scope, key, value, ownerId = 'SYSTEM') {
  const encrypted = encryptObject(value && typeof value === 'object' ? value : {});
  return prisma.portalKV.upsert({
    where: { scope_key_ownerId: { scope, key, ownerId } },
    create: { scope, key, ownerId, value: encrypted },
    update: { value: encrypted },
  });
}

module.exports = { read, write };
