'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');

const config = require('./src/config');
const { db, getSetting, setSetting } = require('./src/database');
const {
  createSessionToken,
  verifyPassword,
  hashPassword,
} = require('./src/security');
const {
  createRateLimiter,
  getAdminSession,
  adminAuth,
  requireAdminHeader,
  securityHeaders,
} = require('./src/middleware');
const { buildUpiLink, createUpiQr, paymentNote } = require('./src/upi');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', false);
app.use(securityHeaders);
app.use(express.json({ limit: '160kb' }));

const allowedTypeClasses = new Set([
  'type-orbit',
  'type-grotesk',
  'type-atelier',
  'type-monolith',
  'type-signal',
  'type-future',
]);

const allowedStatuses = new Set(['pending', 'review', 'paid', 'rejected', 'cancelled']);
const publicSettingsKeys = [
  'store_name',
  'store_tagline',
  'support_email',
  'support_phone',
  'instagram',
  'announcement',
  'license_note',
];

function nowIso() {
  return new Date().toISOString();
}

function cleanText(value, max = 240) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function asInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function slugify(value) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

function isHexColor(value) {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.length <= 160;
}

function serializeFont(font) {
  return {
    id: font.id,
    slug: font.slug,
    name: font.name,
    category: font.category,
    styles: font.styles,
    glyphs: font.glyphs,
    tagline: font.tagline,
    description: font.description,
    price: font.price,
    typeClass: font.type_class,
    accent: font.accent,
    background: font.background,
    badge: font.badge || null,
    published: Boolean(font.published),
    sortOrder: font.sort_order,
    downloads: font.downloads,
  };
}

function getOrder(orderId) {
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
}

function getOrderItems(orderId) {
  return db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC').all(orderId);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || '')
  );
}

async function buildPublicOrder(order) {
  const items = getOrderItems(order.id).map((item) => ({
    id: item.id,
    fontId: item.font_id,
    name: item.name,
    price: item.price,
    typeClass: item.type_class || 'type-grotesk',
    license: item.license,
    downloadUrl:
      order.status === 'paid' && item.font_id
        ? `/api/download/${item.font_id}?order=${encodeURIComponent(order.id)}`
        : null,
  }));

  const response = {
    id: order.id,
    status: order.status,
    amount: order.amount,
    customerName: order.customer_name,
    email: order.email,
    phone: order.phone,
    utr: order.utr || null,
    createdAt: order.created_at,
    paidAt: order.paid_at || null,
    items,
    support: {
      email: getSetting('support_email') || '',
      phone: getSetting('support_phone') || '',
      instagram: getSetting('instagram') || '',
      storeName: getSetting('store_name') || config.STORE_NAME,
    },
  };

  if (order.status !== 'paid') {
    const upiId = getSetting('upi_id') || '';
    const upiName = getSetting('upi_name') || getSetting('store_name') || config.STORE_NAME;
    const note = paymentNote(order.id);
    const upiLink = buildUpiLink({
      upiId,
      payeeName: upiName,
      amount: order.amount,
      note,
    });

    response.payment = {
      upiId,
      upiName,
      note,
      link: upiLink,
      qrDataUrl: await createUpiQr(upiLink),
    };
  }

  return response;
}

function saveFontFile(file) {
  if (!file) return null;

  const extension = path.extname(file.originalname || '').toLowerCase();
  const allowedExtensions = new Set(['.woff2', '.woff', '.ttf', '.otf', '.zip']);
  if (!allowedExtensions.has(extension)) {
    throw Object.assign(new Error('Please upload a WOFF2, WOFF, TTF, OTF, or ZIP file.'), {
      status: 400,
    });
  }

  const buffer = file.buffer;
  const signatures = {
    '.woff2': [Buffer.from('wOF2')],
    '.woff': [Buffer.from('wOFF')],
    '.ttf': [Buffer.from([0x00, 0x01, 0x00, 0x00]), Buffer.from('true')],
    '.otf': [Buffer.from('OTTO')],
    '.zip': [Buffer.from([0x50, 0x4b, 0x03, 0x04])],
  };

  const valid = signatures[extension].some((signature) =>
    buffer.subarray(0, signature.length).equals(signature)
  );
  if (!valid) {
    throw Object.assign(new Error('That file does not look like a valid font package.'), {
      status: 400,
    });
  }

  const storedName = `font-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${extension}`;
  fs.writeFileSync(path.join(config.FONT_STORAGE_DIR, storedName), buffer);
  return {
    storedName,
    originalName: path.basename(file.originalname).replace(/[^\w.\- ()]/g, '').slice(0, 120) || `font${extension}`,
  };
}

function safeDeleteFontFile(fileName) {
  if (!fileName) return;
  const base = path.basename(fileName);
  const filePath = path.resolve(config.FONT_STORAGE_DIR, base);
  if (!filePath.startsWith(path.resolve(config.FONT_STORAGE_DIR) + path.sep)) return;
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // A missing or locked file should not block a database update.
    }
  }
}

function requireFontPayload(req, existing = null) {
  const body = req.body || {};
  const name = cleanText(body.name, 80);
  const tagline = cleanText(body.tagline, 160);
  const description = cleanText(body.description, 1200);
  const category = cleanText(body.category, 30);
  const styles = cleanText(body.styles, 60) || 'Variable';
  const typeClass = cleanText(body.typeClass, 40);
  const accent = cleanText(body.accent, 9);
  const background = cleanText(body.background, 9);
  const badge = cleanText(body.badge, 40);
  const price = asInteger(body.price, 0);
  const glyphs = asInteger(body.glyphs, 480);
  const sortOrder = asInteger(body.sortOrder, 0);
  const published =
    body.published === true || body.published === 'true' || body.published === '1' || body.published === 'on';

  if (name.length < 2) throw Object.assign(new Error('Font name is required.'), { status: 400 });
  if (!category) throw Object.assign(new Error('Choose a category.'), { status: 400 });
  if (!tagline) throw Object.assign(new Error('A short tagline is required.'), { status: 400 });
  if (description.length < 20) {
    throw Object.assign(new Error('Description should be at least 20 characters.'), { status: 400 });
  }
  if (!allowedTypeClasses.has(typeClass)) {
    throw Object.assign(new Error('Choose a valid specimen typeface.'), { status: 400 });
  }
  if (!isHexColor(accent) || !isHexColor(background)) {
    throw Object.assign(new Error('Accent and background must be six-digit hex colors.'), { status: 400 });
  }
  if (price < 1 || price > 100000) {
    throw Object.assign(new Error('Price must be between ₹1 and ₹1,00,000.'), { status: 400 });
  }
  if (glyphs < 1 || glyphs > 50000) {
    throw Object.assign(new Error('Glyph count is out of range.'), { status: 400 });
  }

  let slug = cleanText(body.slug, 60).toLowerCase();
  if (slug) {
    slug = slugify(slug);
  } else if (existing) {
    slug = existing.slug;
  } else {
    slug = slugify(name);
  }
  if (!slug) throw Object.assign(new Error('Could not create a URL slug for this font.'), { status: 400 });

  const duplicate = db
    .prepare('SELECT id FROM fonts WHERE slug = ? AND id != ?')
    .get(slug, existing ? existing.id : -1);
  if (duplicate) {
    throw Object.assign(new Error('Another font already uses that URL slug.'), { status: 409 });
  }

  return {
    name,
    category,
    styles,
    glyphs,
    tagline,
    description,
    price,
    typeClass,
    accent,
    background,
    badge: badge || null,
    published: published ? 1 : 0,
    sortOrder,
    slug,
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                         */
/* ------------------------------------------------------------------ */

const orderLimiter = createRateLimiter({ windowMs: 10 * 60_000, max: 25 });
const utrLimiter = createRateLimiter({ windowMs: 5 * 60_000, max: 15 });
const loginLimiter = createRateLimiter({
  windowMs: 10 * 60_000,
  max: 8,
  message: 'Too many sign-in attempts. Try again in a few minutes.',
});

app.get('/api/fonts', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM fonts WHERE published = 1 ORDER BY sort_order ASC, id ASC')
    .all();
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json({ fonts: rows.map(serializeFont) });
});

app.get('/api/store', (req, res) => {
  const settings = {};
  for (const key of publicSettingsKeys) settings[key] = getSetting(key) || '';
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json({ store: settings });
});

app.get('/api/health', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true });
});

app.post('/api/orders', orderLimiter, (req, res) => {
  const body = req.body || {};
  const name = cleanText(body.name, 80);
  const email = cleanText(body.email, 160).toLowerCase();
  const phone = cleanText(body.phone, 30);
  const ids = Array.isArray(body.items)
    ? [...new Set(body.items.map((item) => asInteger(item, 0)).filter((id) => id > 0))]
    : [];

  if (name.length < 2) return res.status(400).json({ error: 'Please enter your full name.' });
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (phone.replace(/\D/g, '').length < 8 || phone.replace(/\D/g, '').length > 15) {
    return res.status(400).json({ error: 'Please enter a valid phone number.' });
  }
  if (ids.length === 0) return res.status(400).json({ error: 'Your bag is empty.' });
  if (ids.length > 10) return res.status(400).json({ error: 'A maximum of 10 fonts can be ordered at once.' });

  const placeholders = ids.map(() => '?').join(',');
  const fonts = db
    .prepare(`SELECT * FROM fonts WHERE published = 1 AND id IN (${placeholders})`)
    .all(...ids);

  if (fonts.length !== ids.length) {
    return res.status(409).json({ error: 'One or more fonts are no longer available.' });
  }

  const amount = fonts.reduce((sum, font) => sum + font.price, 0);
  const orderId = crypto.randomUUID();
  const timestamp = nowIso();

  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO orders (id, customer_name, email, phone, amount, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(orderId, name, email, phone, amount, timestamp, timestamp);

    const insertItem = db.prepare(`
      INSERT INTO order_items (order_id, font_id, name, price, type_class, license)
      VALUES (?, ?, ?, ?, ?, 'Personal')
    `);
    for (const font of fonts) {
      insertItem.run(orderId, font.id, font.name, font.price, font.type_class);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  res.status(201).json({
    orderId,
    checkoutUrl: `/checkout.html?order=${encodeURIComponent(orderId)}`,
  });
});

app.get('/api/orders/:id', async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Order not found.' });
  const order = getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });

  res.setHeader('Cache-Control', 'no-store');
  res.json({ order: await buildPublicOrder(order) });
});

app.post('/api/orders/:id/utr', utrLimiter, (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Order not found.' });
  const order = getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (order.status === 'paid') return res.status(409).json({ error: 'This order is already marked as paid.' });
  if (order.status === 'cancelled') {
    return res.status(409).json({ error: 'This order has been cancelled. Please contact the studio.' });
  }

  const utr = cleanText(req.body?.utr, 40).replace(/\s+/g, '');
  if (!/^[A-Za-z0-9-]{6,30}$/.test(utr)) {
    return res.status(400).json({
      error: 'Enter a valid UPI reference number (6–30 letters or digits, found in your payment app).',
    });
  }

  db.prepare(`
    UPDATE orders
    SET utr = ?, status = 'review', admin_note = NULL, updated_at = ?
    WHERE id = ?
  `).run(utr.toUpperCase(), nowIso(), order.id);

  res.json({
    ok: true,
    status: 'review',
    message: 'Payment reference received. The studio will verify it shortly.',
  });
});

app.get('/api/download/:fontId', (req, res) => {
  const orderId = String(req.query.order || '');
  if (!isUuid(orderId)) return res.status(404).send('Download link is invalid.');

  const order = getOrder(orderId);
  if (!order || order.status !== 'paid') {
    return res.status(403).send('Downloads unlock once your payment is verified.');
  }

  const fontId = asInteger(req.params.fontId, 0);
  const item = db
    .prepare('SELECT * FROM order_items WHERE order_id = ? AND font_id = ? LIMIT 1')
    .get(order.id, fontId);
  if (!item) return res.status(404).send('This font is not part of the order.');

  const font = db.prepare('SELECT * FROM fonts WHERE id = ?').get(fontId);
  if (!font || !font.file_name) return res.status(404).send('The font file is not available yet.');

  const safeName = path.basename(font.file_name);
  const filePath = path.resolve(config.FONT_STORAGE_DIR, safeName);
  if (!filePath.startsWith(path.resolve(config.FONT_STORAGE_DIR) + path.sep) || !fs.existsSync(filePath)) {
    return res.status(404).send('The font file could not be found. Please contact the studio.');
  }

  db.prepare('UPDATE fonts SET downloads = downloads + 1 WHERE id = ?').run(font.id);
  res.download(filePath, font.file_original || `${font.slug}${path.extname(safeName)}`);
});

/* ------------------------------------------------------------------ */
/* Admin authentication                                               */
/* ------------------------------------------------------------------ */

app.get('/api/admin/me', (req, res) => {
  const session = getAdminSession(req);
  if (!session || session.username !== config.ADMIN_USER) {
    return res.json({ authenticated: false });
  }
  return res.json({
    authenticated: true,
    username: session.username,
    storeName: getSetting('store_name') || config.STORE_NAME,
    expiresAt: session.expiresAt,
  });
});

app.post('/api/admin/login', loginLimiter, (req, res) => {
  const username = cleanText(req.body?.username, 80);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!username || !password) {
    return res.status(400).json({ error: 'Enter your username and password.' });
  }

  const validUser = username === config.ADMIN_USER;
  const storedHash = getSetting('admin_password_hash');
  const validPassword = verifyPassword(password, storedHash);

  if (!validUser || !validPassword) {
    return res.status(401).json({ error: 'Those credentials do not match our records.' });
  }

  const token = createSessionToken(config.ADMIN_USER, config.SESSION_SECRET, config.SESSION_TTL_MS);
  res.cookie(config.SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.NODE_ENV === 'production',
    maxAge: config.SESSION_TTL_MS,
    path: '/',
  });

  res.setHeader('Cache-Control', 'no-store');
  return res.json({ ok: true, username: config.ADMIN_USER });
});

app.post('/api/admin/logout', adminAuth, requireAdminHeader, (req, res) => {
  res.clearCookie(config.SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.NODE_ENV === 'production',
    path: '/',
  });
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Protected admin API                                                */
/* ------------------------------------------------------------------ */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

app.use('/api/admin', adminAuth, requireAdminHeader);

app.get('/api/admin/overview', (req, res) => {
  const revenue = db
    .prepare("SELECT COALESCE(SUM(amount), 0) AS value FROM orders WHERE status = 'paid'")
    .get().value;
  const orderCount = db.prepare('SELECT COUNT(*) AS value FROM orders').get().value;
  const reviewCount = db.prepare("SELECT COUNT(*) AS value FROM orders WHERE status = 'review'").get().value;
  const publishedFonts = db.prepare('SELECT COUNT(*) AS value FROM fonts WHERE published = 1').get().value;

  const last7 = db
    .prepare("SELECT COALESCE(SUM(amount), 0) AS value FROM orders WHERE status = 'paid' AND datetime(paid_at) >= datetime('now', '-7 days')")
    .get().value;
  const previous7 = db
    .prepare("SELECT COALESCE(SUM(amount), 0) AS value FROM orders WHERE status = 'paid' AND datetime(paid_at) >= datetime('now', '-14 days') AND datetime(paid_at) < datetime('now', '-7 days')")
    .get().value;

  const dailyRows = db
    .prepare(`
      SELECT date(paid_at) AS day, SUM(amount) AS revenue, COUNT(*) AS orders
      FROM orders
      WHERE status = 'paid' AND datetime(paid_at) >= datetime('now', '-13 days')
      GROUP BY date(paid_at)
      ORDER BY day ASC
    `)
    .all();
  const dailyMap = new Map(dailyRows.map((row) => [row.day, row]));
  const daily = [];
  for (let offset = 13; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - offset);
    const key = date.toISOString().slice(0, 10);
    const match = dailyMap.get(key);
    daily.push({ day: key, revenue: match?.revenue || 0, orders: match?.orders || 0 });
  }

  const recentOrders = db
    .prepare(`
      SELECT o.*, (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id) AS item_count
      FROM orders o ORDER BY o.created_at DESC LIMIT 6
    `)
    .all()
    .map((order) => ({
      id: order.id,
      customerName: order.customer_name,
      email: order.email,
      amount: order.amount,
      status: order.status,
      createdAt: order.created_at,
      itemCount: order.item_count,
    }));

  const topFonts = db
    .prepare(`
      SELECT i.name, i.type_class, COUNT(*) AS sold, SUM(i.price) AS revenue
      FROM order_items i
      JOIN orders o ON o.id = i.order_id
      WHERE o.status = 'paid'
      GROUP BY i.name, i.type_class
      ORDER BY sold DESC, revenue DESC
      LIMIT 5
    `)
    .all();

  res.json({
    stats: {
      revenue,
      orderCount,
      reviewCount,
      publishedFonts,
      last7: { value: last7, previous: previous7 },
    },
    daily,
    recentOrders,
    topFonts,
  });
});

app.get('/api/admin/fonts', (req, res) => {
  const rows = db.prepare('SELECT * FROM fonts ORDER BY sort_order ASC, id ASC').all();
  res.json({ fonts: rows.map((font) => ({ ...serializeFont(font), hasFile: Boolean(font.file_name) })) });
});

app.post('/api/admin/fonts', upload.single('file'), (req, res) => {
  const payload = requireFontPayload(req);
  const uploaded = saveFontFile(req.file);
  const timestamp = nowIso();

  try {
    const result = db.prepare(`
      INSERT INTO fonts (
        slug, name, category, styles, glyphs, tagline, description, price,
        type_class, accent, background, badge, published, sort_order,
        file_name, file_original, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      payload.slug,
      payload.name,
      payload.category,
      payload.styles,
      payload.glyphs,
      payload.tagline,
      payload.description,
      payload.price,
      payload.typeClass,
      payload.accent,
      payload.background,
      payload.badge,
      payload.published,
      payload.sortOrder,
      uploaded?.storedName || null,
      uploaded?.originalName || null,
      timestamp,
      timestamp
    );

    const font = db.prepare('SELECT * FROM fonts WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ font: { ...serializeFont(font), hasFile: Boolean(font.file_name) } });
  } catch (error) {
    if (uploaded) safeDeleteFontFile(uploaded.storedName);
    throw error;
  }
});

app.post('/api/admin/fonts/:id', upload.single('file'), (req, res) => {
  const fontId = asInteger(req.params.id, 0);
  const existing = db.prepare('SELECT * FROM fonts WHERE id = ?').get(fontId);
  if (!existing) return res.status(404).json({ error: 'Font not found.' });

  const payload = requireFontPayload(req, existing);
  const uploaded = saveFontFile(req.file);
  const timestamp = nowIso();

  try {
    db.prepare(`
      UPDATE fonts SET
        slug = ?, name = ?, category = ?, styles = ?, glyphs = ?, tagline = ?,
        description = ?, price = ?, type_class = ?, accent = ?, background = ?,
        badge = ?, published = ?, sort_order = ?, file_name = ?, file_original = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      payload.slug,
      payload.name,
      payload.category,
      payload.styles,
      payload.glyphs,
      payload.tagline,
      payload.description,
      payload.price,
      payload.typeClass,
      payload.accent,
      payload.background,
      payload.badge,
      payload.published,
      payload.sortOrder,
      uploaded?.storedName || existing.file_name,
      uploaded?.originalName || existing.file_original,
      timestamp,
      fontId
    );

    if (uploaded && existing.file_name && existing.file_name !== uploaded.storedName) {
      safeDeleteFontFile(existing.file_name);
    }

    const font = db.prepare('SELECT * FROM fonts WHERE id = ?').get(fontId);
    res.json({ font: { ...serializeFont(font), hasFile: Boolean(font.file_name) } });
  } catch (error) {
    if (uploaded) safeDeleteFontFile(uploaded.storedName);
    throw error;
  }
});

app.patch('/api/admin/fonts/:id/publish', (req, res) => {
  const fontId = asInteger(req.params.id, 0);
  const existing = db.prepare('SELECT * FROM fonts WHERE id = ?').get(fontId);
  if (!existing) return res.status(404).json({ error: 'Font not found.' });

  const nextPublished = req.body?.published === true || req.body?.published === 'true';
  db.prepare('UPDATE fonts SET published = ?, updated_at = ? WHERE id = ?').run(
    nextPublished ? 1 : 0,
    nowIso(),
    fontId
  );

  const font = db.prepare('SELECT * FROM fonts WHERE id = ?').get(fontId);
  res.json({ font: { ...serializeFont(font), hasFile: Boolean(font.file_name) } });
});

app.delete('/api/admin/fonts/:id', (req, res) => {
  const fontId = asInteger(req.params.id, 0);
  const existing = db.prepare('SELECT * FROM fonts WHERE id = ?').get(fontId);
  if (!existing) return res.status(404).json({ error: 'Font not found.' });

  db.prepare('DELETE FROM fonts WHERE id = ?').run(fontId);

  if (existing.file_name) {
    const otherReferences = db.prepare('SELECT COUNT(*) AS count FROM fonts WHERE file_name = ?').get(existing.file_name).count;
    if (!otherReferences) safeDeleteFontFile(existing.file_name);
  }

  res.json({ ok: true });
});

app.get('/api/admin/orders', (req, res) => {
  const status = cleanText(req.query.status, 20);
  const query = cleanText(req.query.q, 80);
  const clauses = [];
  const params = [];

  if (status && status !== 'all' && allowedStatuses.has(status)) {
    clauses.push('o.status = ?');
    params.push(status);
  }
  if (query) {
    clauses.push('(o.customer_name LIKE ? OR o.email LIKE ? OR o.id LIKE ? OR o.utr LIKE ?)');
    const term = `%${query}%`;
    params.push(term, term, term, term);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(`
      SELECT o.*, (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id) AS item_count
      FROM orders o ${where}
      ORDER BY o.created_at DESC
      LIMIT 250
    `)
    .all(...params);

  res.json({
    orders: rows.map((order) => ({
      id: order.id,
      customerName: order.customer_name,
      email: order.email,
      phone: order.phone,
      amount: order.amount,
      status: order.status,
      utr: order.utr || null,
      createdAt: order.created_at,
      paidAt: order.paid_at,
      itemCount: order.item_count,
    })),
  });
});

app.get('/api/admin/orders/:id', (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Order not found.' });
  const order = getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });

  const items = getOrderItems(order.id).map((item) => ({
    id: item.id,
    fontId: item.font_id,
    name: item.name,
    price: item.price,
    typeClass: item.type_class,
    license: item.license,
  }));

  res.json({
    order: {
      ...order,
      adminNote: order.admin_note,
      items,
    },
  });
});

app.patch('/api/admin/orders/:id', (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Order not found.' });
  const order = getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });

  const status = cleanText(req.body?.status, 20);
  const adminNote =
    typeof req.body?.adminNote === 'string' ? cleanText(req.body.adminNote, 500) : order.admin_note || '';

  if (!allowedStatuses.has(status)) {
    return res.status(400).json({ error: 'Choose a valid order status.' });
  }

  const paidAt = status === 'paid' ? order.paid_at || nowIso() : null;
  db.prepare(`
    UPDATE orders SET status = ?, admin_note = ?, paid_at = ?, updated_at = ?
    WHERE id = ?
  `).run(status, adminNote || null, paidAt, nowIso(), order.id);

  res.json({ ok: true, status });
});

app.get('/api/admin/settings', (req, res) => {
  const settings = {};
  for (const key of [...publicSettingsKeys, 'upi_id', 'upi_name', 'store_name', 'store_tagline']) {
    settings[key] = getSetting(key) || '';
  }
  res.json({ settings });
});

app.put('/api/admin/settings', (req, res) => {
  const body = req.body || {};
  const errors = [];
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);

  // Read the current values first so partial updates keep everything else intact.
  const current = {
    upi_id: getSetting('upi_id') || '',
    upi_name: getSetting('upi_name') || '',
    support_email: getSetting('support_email') || '',
    support_phone: getSetting('support_phone') || '',
    store_name: getSetting('store_name') || '',
    store_tagline: getSetting('store_tagline') || '',
    instagram: getSetting('instagram') || '',
    announcement: getSetting('announcement') || '',
    license_note: getSetting('license_note') || '',
  };

  const values = {
    upi_id: has('upi_id') ? cleanText(body.upi_id, 120) : current.upi_id,
    upi_name: has('upi_name') ? cleanText(body.upi_name, 80) : current.upi_name,
    support_email: (has('support_email') ? cleanText(body.support_email, 160) : current.support_email).toLowerCase(),
    support_phone: has('support_phone') ? cleanText(body.support_phone, 30) : current.support_phone,
    store_name: has('store_name') ? cleanText(body.store_name, 80) : current.store_name,
    store_tagline: has('store_tagline') ? cleanText(body.store_tagline, 120) : current.store_tagline,
    instagram: has('instagram') ? cleanText(body.instagram, 60) : current.instagram,
    announcement: has('announcement') ? cleanText(body.announcement, 160) : current.announcement,
    license_note: has('license_note') ? cleanText(body.license_note, 600) : current.license_note,
  };

  if (!/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(values.upi_id)) {
    errors.push('UPI ID must look like name@bank (for example, studio@okhdfcbank).');
  }
  if (values.upi_name.length < 2) errors.push('UPI payee name is required.');
  if (!isValidEmail(values.support_email)) errors.push('Support email is invalid.');
  if (values.store_name.length < 2) errors.push('Store name is required.');
  if (values.support_phone && values.support_phone.replace(/\D/g, '').length < 8) {
    errors.push('Support phone is invalid.');
  }

  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  for (const [key, value] of Object.entries(values)) setSetting(key, value);
  res.json({ ok: true, settings: values });
});

app.post('/api/admin/password', (req, res) => {
  const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

  if (!verifyPassword(currentPassword, getSetting('admin_password_hash'))) {
    return res.status(401).json({ error: 'Your current password is not correct.' });
  }
  if (newPassword.length < 10) {
    return res.status(400).json({ error: 'Use at least 10 characters for the new password.' });
  }
  if (!/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    return res.status(400).json({ error: 'Include at least one letter and one number in the new password.' });
  }

  setSetting('admin_password_hash', hashPassword(newPassword));
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Pages & error handling                                             */
/* ------------------------------------------------------------------ */

app.use(
  express.static(config.PUBLIC_DIR, {
    index: 'index.html',
    maxAge: config.NODE_ENV === 'production' ? '1h' : 0,
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

app.get('/', (req, res) => res.sendFile(path.join(config.PUBLIC_DIR, 'index.html')));
app.get('/admin', (req, res) => res.redirect('/admin/'));
app.get('/checkout', (req, res) => res.sendFile(path.join(config.PUBLIC_DIR, 'checkout.html')));

app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));
app.use((req, res) => {
  res.status(404).sendFile(path.join(config.PUBLIC_DIR, '404.html'));
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof multer.MulterError) {
    const message =
      error.code === 'LIMIT_FILE_SIZE'
        ? 'The font file is too large. Maximum size is 10 MB.'
        : 'The upload could not be processed.';
    return res.status(400).json({ error: message });
  }

  const status = Number(error.status) || 500;
  if (status >= 500) {
    console.error(`[${new Date().toISOString()}]`, error);
  }
  return res.status(status).json({
    error: status >= 500 ? 'Something went wrong on our end. Please try again.' : error.message,
  });
});

function localNetworkUrls() {
  const urls = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        urls.push(`http://${entry.address}:${config.PORT}`);
      }
    }
  }
  return urls;
}

const server = app.listen(config.PORT, config.HOST, () => {
  console.log('');
  console.log('  SANOJ TYPE FOUNDRY');
  console.log(`  Site       http://localhost:${config.PORT}`);
  console.log(`  Studio     http://localhost:${config.PORT}/admin`);
  for (const url of localNetworkUrls()) {
    console.log(`  On network ${url}`);
  }
  console.log(`  Database   ${path.relative(config.ROOT, require('./src/database').databasePath)}`);
  console.log('');
  console.log('  Keep this window open while using the site.');
  console.log('');
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n  Port ${config.PORT} is already in use.`);
    console.error('  The site may already be running in another window.');
    console.error(`  Try opening http://localhost:${config.PORT} instead.\n`);
  } else {
    console.error('\n  The server could not start:', error.message, '\n');
  }
  process.exitCode = 1;
});

function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down…`);
  server.close(() => {
    try {
      db.close();
    } catch {
      // Ignore shutdown errors from SQLite.
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
