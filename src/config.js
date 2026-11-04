'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');

// Node 20.12+ can load .env files without an extra dependency.
try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  // .env is optional. Sensible development defaults live below.
}

const DATA_DIR = path.join(ROOT, 'data');
const PUBLIC_DIR = path.join(ROOT, 'public');
const STORAGE_DIR = path.join(ROOT, 'storage');
const FONT_STORAGE_DIR = path.join(STORAGE_DIR, 'fonts');

for (const directory of [DATA_DIR, STORAGE_DIR, FONT_STORAGE_DIR]) {
  fs.mkdirSync(directory, { recursive: true });
}

function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;

  const secretFile = path.join(DATA_DIR, '.session-secret');
  if (fs.existsSync(secretFile)) {
    return fs.readFileSync(secretFile, 'utf8').trim();
  }

  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(secretFile, secret, { mode: 0o600 });
  return secret;
}

module.exports = {
  ROOT,
  DATA_DIR,
  PUBLIC_DIR,
  STORAGE_DIR,
  FONT_STORAGE_DIR,
  PORT: Number(process.env.PORT) || 3000,
  // Listen on both IPv4 and IPv6. Some browsers resolve localhost to ::1
  // first; binding only 0.0.0.0 makes those requests fail.
  HOST: process.env.HOST || '::',
  NODE_ENV: process.env.NODE_ENV || 'development',
  ADMIN_USER: process.env.ADMIN_USER || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'Sanoj@2026',
  SESSION_SECRET: getSessionSecret(),
  SESSION_COOKIE: 'sanoj_studio_session',
  SESSION_TTL_MS: 1000 * 60 * 60 * 8,
  STORE_NAME: process.env.STORE_NAME || 'Sanoj Type Foundry',
};
