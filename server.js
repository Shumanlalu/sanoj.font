'use strict';

const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');

const config = require('./src/config');
const {
  initializeDatabase,
  getSetting,
  setSetting,
  getSettings,
  setSettings,
  get,
  all,
  query,
  run,
  withTransaction,
} = require('./src/database');
const {
  uploadFontObject,
  deleteFontObjects,
  createFontDownloadUrl,
} = require('./src/storage');
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
app.set('trust proxy', process.env.VERCEL ? 1 : false);
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

async function getOrder(orderId) {
  return get('SELECT * FROM orders WHERE id = $1', [orderId]);
}

async function getOrderItems(orderId) {
  return all('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id ASC', [orderId]);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || '')
  );
}

async function buildPublicOrder(order) {
  const [items, settings] = await Promise.all([
    getOrderItems(order.id),
    getSettings([
      'support_email',
      'support_phone',
      'instagram',
      'store_name',
      'upi_id',
      'upi_name',
    ]),
  ]);

  const mappedItems = items.map((item) => ({
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
    items: mappedItems,
    support: {
      email: settings.support_email || '',
      phone: settings.support_phone || '',
      instagram: settings.instagram || '',
      storeName: settings.store_name || config.STORE_NAME,
    },
  };

  if (order.status !== 'paid') {
    const upiId = settings.upi_id || '';
    const upiName = settings.upi_name || settings.store_name || config.STORE_NAME;
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

async function saveFontFile(file) {
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

  const storedName = `fonts/${Date.now()}-${crypto.randomBytes(6).toString('hex')}${extension}`;
  await uploadFontObject(storedName, buffer);
  return {
    storedName,
    originalName:
      path.basename(file.originalname).replace(/[^\w.\- ()]/g, '').slice(0, 120) || `font${extension}`,
  };
}

async function safeDeleteFontFile(fileName) {
  if (!fileName) return;
  await deleteFontObjects([fileName]);
}

async function requireFontPayload(req, existing = null) {
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

  const duplicate = await get('SELECT id FROM fonts WHERE slug = $1 AND id != $2', [
    slug,
    existing ? existing.id : -1,
  ]);
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
/* Database readiness                                                 */
/* ------------------------------------------------------------------ */

// Runs once per serverless instance (and once locally) before any API call.
app.use('/api', async (req, res, next) => {
  try {
    await initializeDatabase();
    next();
  } catch (error) {
    next(error);
  }
});

// Admin sessions need a stable signing key. Block admin routes with a clear
// error instead of crashing the whole deployment when it is missing.
app.use('/api/admin', (req, res, next) => {
  if (config.SESSION_SECRET_MISSING) {
    return res.status(500).json({
      error: 'Admin sessions are not configured. Set SESSION_SECRET in the environment.',
    });
  }
  return next();
});

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

app.get('/api/fonts', async (req, res) => {
  const rows = await all('SELECT * FROM fonts WHERE published = 1 ORDER BY sort_order ASC, id ASC');
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json({ fonts: rows.map(serializeFont) });
});

app.get('/api/store', async (req, res) => {
  const stored = await getSettings(publicSettingsKeys);
  const settings = {};
  for (const key of publicSettingsKeys) settings[key] = stored[key] || '';
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json({ store: settings });
});

app.get('/api/health', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true });
});

app.post('/api/orders', orderLimiter, async (req, res) => {
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

  const placeholders = ids.map((_, index) => `$${index + 1}`).join(',');
  const fonts = await all(
    `SELECT * FROM fonts WHERE published = 1 AND id IN (${placeholders})`,
    ids
  );

  if (fonts.length !== ids.length) {
    return res.status(409).json({ error: 'One or more fonts are no longer available.' });
  }

  const amount = fonts.reduce((sum, font) => sum + font.price, 0);
  const orderId = crypto.randomUUID();
  const timestamp = nowIso();

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO orders (id, customer_name, email, phone, amount, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $6)`,
      [orderId, name, email, phone, amount, timestamp]
    );

    for (const font of fonts) {
      await client.query(
        `INSERT INTO order_items (order_id, font_id, name, price, type_class, license)
         VALUES ($1, $2, $3, $4, $5, 'Personal')`,
        [orderId, font.id, font.name, font.price, font.type_class]
      );
    }
  });

  res.status(201).json({
    orderId,
    checkoutUrl: `/checkout.html?order=${encodeURIComponent(orderId)}`,
  });
});

app.get('/api/orders/:id', async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Order not found.' });
  const order = await getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });

  res.setHeader('Cache-Control', 'no-store');
  res.json({ order: await buildPublicOrder(order) });
});

app.post('/api/orders/:id/utr', utrLimiter, async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Order not found.' });
  const order = await getOrder(req.params.id);
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

  await run(
    `UPDATE orders
     SET utr = $1, status = 'review', admin_note = NULL, updated_at = $2
     WHERE id = $3`,
    [utr.toUpperCase(), nowIso(), order.id]
  );

  res.json({
    ok: true,
    status: 'review',
    message: 'Payment reference received. The studio will verify it shortly.',
  });
});

app.get('/api/download/:fontId', async (req, res) => {
  const orderId = String(req.query.order || '');
  if (!isUuid(orderId)) return res.status(404).send('Download link is invalid.');

  const order = await getOrder(orderId);
  if (!order || order.status !== 'paid') {
    return res.status(403).send('Downloads unlock once your payment is verified.');
  }

  const fontId = asInteger(req.params.fontId, 0);
  const item = await get(
    'SELECT * FROM order_items WHERE order_id = $1 AND font_id = $2 LIMIT 1',
    [order.id, fontId]
  );
  if (!item) return res.status(404).send('This font is not part of the order.');

  const font = await get('SELECT * FROM fonts WHERE id = $1', [fontId]);
  if (!font || !font.file_name) return res.status(404).send('The font file is not available yet.');

  await run('UPDATE fonts SET downloads = downloads + 1 WHERE id = $1', [font.id]);

  const extension = path.extname(font.file_name) || '';
  const downloadName = font.file_original || `${font.slug}${extension}`;
  const downloadUrl = await createFontDownloadUrl(font.file_name, downloadName);

  res.setHeader('Cache-Control', 'no-store');
  res.redirect(302, downloadUrl);
});

/* ------------------------------------------------------------------ */
/* Admin authentication                                               */
/* ------------------------------------------------------------------ */

app.get('/api/admin/me', async (req, res) => {
  const session = getAdminSession(req);
  if (!session || session.username !== config.ADMIN_USER) {
    return res.json({ authenticated: false });
  }
  return res.json({
    authenticated: true,
    username: session.username,
    storeName: (await getSetting('store_name')) || config.STORE_NAME,
    expiresAt: session.expiresAt,
  });
});

app.post('/api/admin/login', loginLimiter, async (req, res) => {
  const username = cleanText(req.body?.username, 80);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!username || !password) {
    return res.status(400).json({ error: 'Enter your username and password.' });
  }

  const validUser = username === config.ADMIN_USER;
  const storedHash = await getSetting('admin_password_hash');
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

const maxFontUploadMb = Math.min(Math.max(config.MAX_FONT_UPLOAD_MB, 1), 10);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxFontUploadMb * 1024 * 1024, files: 1 },
});

app.use('/api/admin', adminAuth, requireAdminHeader);

app.get('/api/admin/overview', async (req, res) => {
  const [revenue, orderCount, reviewCount, publishedFonts, last7, previous7, dailyRows, recentOrders, topFonts] =
    await Promise.all([
      get("SELECT COALESCE(SUM(amount), 0)::int AS value FROM orders WHERE status = 'paid'"),
      get('SELECT COUNT(*)::int AS value FROM orders'),
      get("SELECT COUNT(*)::int AS value FROM orders WHERE status = 'review'"),
      get('SELECT COUNT(*)::int AS value FROM fonts WHERE published = 1'),
      get(
        "SELECT COALESCE(SUM(amount), 0)::int AS value FROM orders WHERE status = 'paid' AND paid_at::timestamptz >= now() - interval '7 days'"
      ),
      get(
        "SELECT COALESCE(SUM(amount), 0)::int AS value FROM orders WHERE status = 'paid' AND paid_at::timestamptz >= now() - interval '14 days' AND paid_at::timestamptz < now() - interval '7 days'"
      ),
      all(`
        SELECT LEFT(paid_at, 10) AS day, SUM(amount)::int AS revenue, COUNT(*)::int AS orders
        FROM orders
        WHERE status = 'paid' AND paid_at::timestamptz >= now() - interval '13 days'
        GROUP BY LEFT(paid_at, 10)
        ORDER BY day ASC
      `),
      all(`
        SELECT o.*, (SELECT COUNT(*)::int FROM order_items i WHERE i.order_id = o.id) AS item_count
        FROM orders o ORDER BY o.created_at DESC LIMIT 6
      `),
      all(`
        SELECT i.name, i.type_class, COUNT(*)::int AS sold, SUM(i.price)::int AS revenue
        FROM order_items i
        JOIN orders o ON o.id = i.order_id
        WHERE o.status = 'paid'
        GROUP BY i.name, i.type_class
        ORDER BY sold DESC, revenue DESC
        LIMIT 5
      `),
    ]);

  const dailyMap = new Map(dailyRows.map((row) => [row.day, row]));
  const daily = [];
  for (let offset = 13; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - offset);
    const key = date.toISOString().slice(0, 10);
    const match = dailyMap.get(key);
    daily.push({ day: key, revenue: match?.revenue || 0, orders: match?.orders || 0 });
  }

  res.json({
    stats: {
      revenue: revenue.value,
      orderCount: orderCount.value,
      reviewCount: reviewCount.value,
      publishedFonts: publishedFonts.value,
      last7: { value: last7.value, previous: previous7.value },
    },
    daily,
    recentOrders: recentOrders.map((order) => ({
      id: order.id,
      customerName: order.customer_name,
      email: order.email,
      amount: order.amount,
      status: order.status,
      createdAt: order.created_at,
      itemCount: order.item_count,
    })),
    topFonts,
  });
});

app.get('/api/admin/fonts', async (req, res) => {
  const rows = await all('SELECT * FROM fonts ORDER BY sort_order ASC, id ASC');
  res.json({ fonts: rows.map((font) => ({ ...serializeFont(font), hasFile: Boolean(font.file_name) })) });
});

app.post('/api/admin/fonts', upload.single('file'), async (req, res) => {
  const payload = await requireFontPayload(req);
  const uploaded = await saveFontFile(req.file);
  const timestamp = nowIso();

  try {
    const { rows } = await query(
      `INSERT INTO fonts (
        slug, name, category, styles, glyphs, tagline, description, price,
        type_class, accent, background, badge, published, sort_order,
        file_name, file_original, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING *`,
      [
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
        timestamp,
      ]
    );

    const font = rows[0];
    res.status(201).json({ font: { ...serializeFont(font), hasFile: Boolean(font.file_name) } });
  } catch (error) {
    if (uploaded) await safeDeleteFontFile(uploaded.storedName);
    throw error;
  }
});

app.post('/api/admin/fonts/:id', upload.single('file'), async (req, res) => {
  const fontId = asInteger(req.params.id, 0);
  const existing = await get('SELECT * FROM fonts WHERE id = $1', [fontId]);
  if (!existing) return res.status(404).json({ error: 'Font not found.' });

  const payload = await requireFontPayload(req, existing);
  const uploaded = await saveFontFile(req.file);
  const timestamp = nowIso();

  try {
    const { rows } = await query(
      `UPDATE fonts SET
        slug = $1, name = $2, category = $3, styles = $4, glyphs = $5, tagline = $6,
        description = $7, price = $8, type_class = $9, accent = $10, background = $11,
        badge = $12, published = $13, sort_order = $14, file_name = $15, file_original = $16,
        updated_at = $17
       WHERE id = $18
       RETURNING *`,
      [
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
        fontId,
      ]
    );

    if (uploaded && existing.file_name && existing.file_name !== uploaded.storedName) {
      await safeDeleteFontFile(existing.file_name);
    }

    const font = rows[0];
    res.json({ font: { ...serializeFont(font), hasFile: Boolean(font.file_name) } });
  } catch (error) {
    if (uploaded) await safeDeleteFontFile(uploaded.storedName);
    throw error;
  }
});

app.patch('/api/admin/fonts/:id/publish', async (req, res) => {
  const fontId = asInteger(req.params.id, 0);
  const existing = await get('SELECT * FROM fonts WHERE id = $1', [fontId]);
  if (!existing) return res.status(404).json({ error: 'Font not found.' });

  const nextPublished = req.body?.published === true || req.body?.published === 'true';
  const { rows } = await query(
    'UPDATE fonts SET published = $1, updated_at = $2 WHERE id = $3 RETURNING *',
    [nextPublished ? 1 : 0, nowIso(), fontId]
  );

  const font = rows[0];
  res.json({ font: { ...serializeFont(font), hasFile: Boolean(font.file_name) } });
});

app.delete('/api/admin/fonts/:id', async (req, res) => {
  const fontId = asInteger(req.params.id, 0);
  const existing = await get('SELECT * FROM fonts WHERE id = $1', [fontId]);
  if (!existing) return res.status(404).json({ error: 'Font not found.' });

  await run('DELETE FROM fonts WHERE id = $1', [fontId]);

  if (existing.file_name) {
    const otherReferences = await get(
      'SELECT COUNT(*)::int AS count FROM fonts WHERE file_name = $1',
      [existing.file_name]
    );
    if (!otherReferences.count) await safeDeleteFontFile(existing.file_name);
  }

  res.json({ ok: true });
});

app.get('/api/admin/orders', async (req, res) => {
  const status = cleanText(req.query.status, 20);
  const search = cleanText(req.query.q, 80);
  const clauses = [];
  const params = [];

  if (status && status !== 'all' && allowedStatuses.has(status)) {
    params.push(status);
    clauses.push(`o.status = $${params.length}`);
  }
  if (search) {
    const term = `%${search}%`;
    const base = params.length;
    clauses.push(
      `(o.customer_name ILIKE $${base + 1} OR o.email ILIKE $${base + 2} OR o.id ILIKE $${base + 3} OR COALESCE(o.utr, '') ILIKE $${base + 4})`
    );
    params.push(term, term, term, term);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await all(
    `SELECT o.*, (SELECT COUNT(*)::int FROM order_items i WHERE i.order_id = o.id) AS item_count
     FROM orders o ${where}
     ORDER BY o.created_at DESC
     LIMIT 250`,
    params
  );

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

app.get('/api/admin/orders/:id', async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Order not found.' });
  const order = await getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });

  const items = (await getOrderItems(order.id)).map((item) => ({
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

app.patch('/api/admin/orders/:id', async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Order not found.' });
  const order = await getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });

  const status = cleanText(req.body?.status, 20);
  const adminNote =
    typeof req.body?.adminNote === 'string' ? cleanText(req.body.adminNote, 500) : order.admin_note || '';

  if (!allowedStatuses.has(status)) {
    return res.status(400).json({ error: 'Choose a valid order status.' });
  }

  const paidAt = status === 'paid' ? order.paid_at || nowIso() : null;
  await run(
    `UPDATE orders SET status = $1, admin_note = $2, paid_at = $3, updated_at = $4
     WHERE id = $5`,
    [status, adminNote || null, paidAt, nowIso(), order.id]
  );

  res.json({ ok: true, status });
});

app.get('/api/admin/settings', async (req, res) => {
  const keys = [...new Set([...publicSettingsKeys, 'upi_id', 'upi_name', 'store_name', 'store_tagline'])];
  const stored = await getSettings(keys);
  const settings = {};
  for (const key of keys) settings[key] = stored[key] || '';
  res.json({ settings });
});

app.put('/api/admin/settings', async (req, res) => {
  const body = req.body || {};
  const errors = [];
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);

  const keys = [
    'upi_id',
    'upi_name',
    'support_email',
    'support_phone',
    'store_name',
    'store_tagline',
    'instagram',
    'announcement',
    'license_note',
  ];
  const stored = await getSettings(keys);
  const current = Object.fromEntries(keys.map((key) => [key, stored[key] || '']));

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

  await setSettings(values);
  res.json({ ok: true, settings: values });
});

app.post('/api/admin/password', async (req, res) => {
  const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

  if (!verifyPassword(currentPassword, await getSetting('admin_password_hash'))) {
    return res.status(401).json({ error: 'Your current password is not correct.' });
  }
  if (newPassword.length < 10) {
    return res.status(400).json({ error: 'Use at least 10 characters for the new password.' });
  }
  if (!/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    return res.status(400).json({ error: 'Include at least one letter and one number in the new password.' });
  }

  await setSetting('admin_password_hash', hashPassword(newPassword));
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
  res.status(404).sendFile(path.join(config.PUBLIC_DIR, '404.html'), (error) => {
    if (!error || res.headersSent) return;
    res
      .status(404)
      .type('html')
      .send(
        '<!doctype html><html lang="en"><meta charset="utf-8"><title>Page not found — Sanoj Type Foundry</title><body style="font-family:system-ui;padding:10vh;background:#111;color:#eee"><h1>404</h1><p>That page could not be found.</p><p><a style="color:#d8ff3e" href="/">Return to the foundry</a></p></body></html>'
      );
  });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof multer.MulterError) {
    const message =
      error.code === 'LIMIT_FILE_SIZE'
        ? `The font file is too large. Maximum size is ${maxFontUploadMb} MB.`
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

/* ------------------------------------------------------------------ */
/* Local server / Vercel export                                       */
/* ------------------------------------------------------------------ */

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

async function startLocalServer() {
  if (config.SESSION_SECRET_MISSING) {
    throw new Error(
      'SESSION_SECRET is required in production. Add a long random value to .env or the environment.'
    );
  }
  await initializeDatabase();

  const server = app.listen(config.PORT, config.HOST, () => {
    console.log('');
    console.log('  SANOJ TYPE FOUNDRY');
    console.log(`  Site       http://localhost:${config.PORT}`);
    console.log(`  Studio     http://localhost:${config.PORT}/admin`);
    for (const url of localNetworkUrls()) {
      console.log(`  On network ${url}`);
    }
    console.log(`  Database   PostgreSQL (Supabase)`);
    console.log(`  Storage    Supabase bucket "${config.SUPABASE_BUCKET}"`);
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
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (require.main === module) {
  startLocalServer().catch((error) => {
    console.error('\n  The server could not start.');
    console.error(' ', error.message, '\n');
    process.exitCode = 1;
  });
}

module.exports = app;
