'use strict';

const config = require('./config');
const { readSessionToken } = require('./security');

function createRateLimiter({ windowMs = 60_000, max = 30, message = 'Too many requests. Please wait a moment.' } = {}) {
  const buckets = new Map();

  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, Math.min(windowMs, 60_000));
  cleanupTimer.unref?.();

  return function rateLimiter(req, res, next) {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 1, resetAt: now + windowMs };
      buckets.set(key, bucket);
    } else {
      bucket.count += 1;
    }

    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ error: message });
    }

    return next();
  };
}

function parseCookies(cookieHeader = '') {
  return cookieHeader.split(';').reduce((cookies, chunk) => {
    const separator = chunk.indexOf('=');
    if (separator === -1) return cookies;
    const key = chunk.slice(0, separator).trim();
    const value = chunk.slice(separator + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function getAdminSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[config.SESSION_COOKIE];
  return readSessionToken(token, config.SESSION_SECRET);
}

function adminAuth(req, res, next) {
  const session = getAdminSession(req);
  if (!session || session.username !== config.ADMIN_USER) {
    return res.status(401).json({ error: 'Your studio session has expired. Please sign in again.' });
  }

  req.admin = session;
  return next();
}

function requireAdminHeader(req, res, next) {
  if (req.get('x-sanoj-admin') !== '1') {
    return res.status(403).json({ error: 'Request verification failed. Refresh the page and try again.' });
  }

  const origin = req.get('origin');
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== req.get('host')) {
        return res.status(403).json({ error: 'Cross-origin request blocked.' });
      }
    } catch {
      return res.status(403).json({ error: 'Invalid request origin.' });
    }
  }

  return next();
}

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
    ].join('; ')
  );
  next();
}

module.exports = {
  createRateLimiter,
  parseCookies,
  getAdminSession,
  adminAuth,
  requireAdminHeader,
  securityHeaders,
};
