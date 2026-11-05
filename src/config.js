'use strict';

const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

// Node 20.12+ can load .env files without an extra dependency.
try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  // .env is optional. Environment variables are required for cloud services.
}

const isProduction = process.env.NODE_ENV === 'production';
const sessionSecretMissing = isProduction && !process.env.SESSION_SECRET;

let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  // Do not throw at module load: Vercel may import the app during the build,
  // before environment variables are available. Admin routes are blocked until
  // the secret is configured (see server.js).
  sessionSecret = sessionSecretMissing ? '' : crypto.randomBytes(48).toString('hex');
  if (sessionSecretMissing) {
    console.error(
      '[config] SESSION_SECRET is required in production. Admin sign-in stays disabled until it is set.'
    );
  } else {
    console.warn(
      '[config] SESSION_SECRET is not set. Using an ephemeral development secret; admin sessions reset when the server restarts.'
    );
  }
}

module.exports = {
  ROOT,
  PUBLIC_DIR,
  PORT: Number(process.env.PORT) || 3000,
  // Listen on both IPv4 and IPv6 locally. Vercel ignores this setting.
  HOST: process.env.HOST || '::',
  NODE_ENV: process.env.NODE_ENV || 'development',
  ADMIN_USER: process.env.ADMIN_USER || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'Sanoj@2026',
  SESSION_SECRET: sessionSecret,
  SESSION_SECRET_MISSING: sessionSecretMissing,
  SESSION_COOKIE: 'sanoj_studio_session',
  SESSION_TTL_MS: 1000 * 60 * 60 * 8,
  STORE_NAME: process.env.STORE_NAME || 'Sanoj Type Foundry',

  // PostgreSQL (Supabase). Use the Supavisor transaction pooler URL on Vercel.
  DATABASE_URL: process.env.DATABASE_URL || '',
  DATABASE_SSL: process.env.DATABASE_SSL !== 'false',

  // Supabase Storage for private font packages.
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  SUPABASE_BUCKET: process.env.SUPABASE_BUCKET || 'sanoj-fonts',
  SUPABASE_SIGNED_URL_TTL: Number(process.env.SUPABASE_SIGNED_URL_TTL) || 60,

  // Vercel Functions reject request bodies above 4.5 MB before Express sees them.
  MAX_FONT_UPLOAD_MB:
    Number(process.env.MAX_FONT_UPLOAD_MB) || (process.env.VERCEL ? 4 : 10),
};
