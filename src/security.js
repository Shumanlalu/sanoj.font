'use strict';

const crypto = require('node:crypto');

/**
 * Hash a password with scrypt. The format is self-describing so the
 * parameters can be upgraded later without breaking existing records.
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, storedHash) {
  if (typeof storedHash !== 'string') return false;

  const [algorithm, salt, expectedHex] = storedHash.split('$');
  if (algorithm !== 'scrypt' || !salt || !expectedHex) return false;

  try {
    const actual = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHex, 'hex');
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function createSessionToken(username, secret, ttlMs) {
  const expiresAt = Date.now() + ttlMs;
  const payload = `${Buffer.from(username, 'utf8').toString('base64url')}.${expiresAt}`;
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function readSessionToken(token, secret) {
  if (typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedUser, expiresRaw, signature] = parts;
  const payload = `${encodedUser}.${expiresRaw}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (actualBuffer.length !== expectedBuffer.length) return null;
  if (!crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;

  try {
    return {
      username: Buffer.from(encodedUser, 'base64url').toString('utf8'),
      expiresAt,
    };
  } catch {
    return null;
  }
}

function opaqueId(bytes = 18) {
  return crypto.randomBytes(bytes).toString('base64url');
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSessionToken,
  readSessionToken,
  opaqueId,
};
