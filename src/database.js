'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');
const { hashPassword } = require('./security');

const databasePath = path.join(config.DATA_DIR, 'sanoj.db');
const db = new DatabaseSync(databasePath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS fonts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    styles TEXT NOT NULL DEFAULT 'Variable',
    glyphs INTEGER NOT NULL DEFAULT 480,
    tagline TEXT NOT NULL,
    description TEXT NOT NULL,
    price INTEGER NOT NULL,
    type_class TEXT NOT NULL,
    accent TEXT NOT NULL,
    background TEXT NOT NULL,
    badge TEXT,
    published INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    file_name TEXT,
    file_original TEXT,
    downloads INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    customer_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    utr TEXT,
    admin_note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    paid_at TEXT
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    font_id INTEGER REFERENCES fonts(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    price INTEGER NOT NULL,
    type_class TEXT,
    license TEXT NOT NULL DEFAULT 'Personal'
  );

  CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
`);

const defaultSettings = {
  store_name: config.STORE_NAME,
  store_tagline: 'Independent type foundry · India',
  upi_id: 'sanoj.studio@okhdfcbank',
  upi_name: config.STORE_NAME,
  support_email: 'hello@sanojtype.in',
  support_phone: '+91 98250 44120',
  instagram: '@sanojtype',
  announcement: 'Edition 01 — Orbit is now in orbit.',
  license_note:
    'Every purchase includes a personal desktop license and the original font files. Commercial licenses are available on request.',
};

const demoFonts = [
  {
    slug: 'orbit',
    name: 'Orbit',
    category: 'Variable',
    styles: 'Variable · 200–900',
    glyphs: 612,
    tagline: 'Wide, weightless, and built for the future.',
    description:
      'A generous display family that pushes letterforms to their outer limits. Orbit pairs a confident, extended skeleton with softly engineered joins, making it equally at home in a headline or a 10-foot installation.',
    price: 3200,
    type_class: 'type-orbit',
    accent: '#e4ff54',
    background: '#20280d',
    badge: 'New release',
    sort_order: 1,
    file_name: 'sanoj-orbit-demo.woff2',
    file_original: 'Sanoj-Orbit-Demo.woff2',
  },
  {
    slug: 'grotesk',
    name: 'Sanoj Grotesk',
    category: 'Sans',
    styles: 'Variable · 300–700',
    glyphs: 548,
    tagline: 'The quiet workhorse with a curious streak.',
    description:
      'A neo-grotesk made for the long haul. Tight spacing, generous x-height, and just enough oddness in the details to keep interfaces and editorial layouts from feeling anonymous.',
    price: 2400,
    type_class: 'type-grotesk',
    accent: '#171712',
    background: '#f2eee4',
    badge: 'Studio staple',
    sort_order: 2,
    file_name: 'sanoj-grotesk-demo.woff2',
    file_original: 'Sanoj-Grotesk-Demo.woff2',
  },
  {
    slug: 'atelier',
    name: 'Atelier',
    category: 'Serif',
    styles: 'Regular + Italic',
    glyphs: 398,
    tagline: 'Old-world elegance, cut with a modern edge.',
    description:
      'Atelier is a high-contrast serif for covers, campaigns, and any place that deserves a little drama. Sharp terminals and an unhurried rhythm give it a presence that reads as clearly in print as it does on glass.',
    price: 2800,
    type_class: 'type-atelier',
    accent: '#4b2417',
    background: '#ead6c1',
    badge: null,
    sort_order: 3,
    file_name: 'sanoj-atelier-demo.woff2',
    file_original: 'Sanoj-Atelier-Demo.woff2',
  },
  {
    slug: 'monolith',
    name: 'Monolith',
    category: 'Display',
    styles: 'Regular',
    glyphs: 346,
    tagline: 'A condensed headline face with monumental presence.',
    description:
      'Built from tall, tightly packed forms, Monolith turns every line into a statement. It is designed to hit hard at scale while keeping its balance in short, punchy compositions.',
    price: 1800,
    type_class: 'type-monolith',
    accent: '#1b100c',
    background: '#ff6847',
    badge: 'Bestseller',
    sort_order: 4,
    file_name: 'sanoj-monolith-demo.woff2',
    file_original: 'Sanoj-Monolith-Demo.woff2',
  },
  {
    slug: 'signal',
    name: 'Signal',
    category: 'Mono',
    styles: 'Regular + Bold',
    glyphs: 447,
    tagline: 'A technical mono for interfaces with a pulse.',
    description:
      'Signal finds beauty in the grid. A crisp monospaced family with a warm, mechanical voice — for code, captions, numbers, and the tiny pieces of a brand that hold everything together.',
    price: 2200,
    type_class: 'type-signal',
    accent: '#f1eee4',
    background: '#151613',
    badge: null,
    sort_order: 5,
    file_name: 'sanoj-signal-demo.woff2',
    file_original: 'Sanoj-Signal-Demo.woff2',
  },
  {
    slug: 'future',
    name: 'Future',
    category: 'Display',
    styles: 'Variable · 400–800',
    glyphs: 506,
    tagline: 'An expressive sans that refuses to sit still.',
    description:
      'Future is a shape-shifting display family with a playful, slightly off-kilter voice. Use it when the brief asks for something memorable, kinetic, and a little bit impossible to ignore.',
    price: 2600,
    type_class: 'type-future',
    accent: '#1a1420',
    background: '#cdc2ff',
    badge: 'Editor’s pick',
    sort_order: 6,
    file_name: 'sanoj-future-demo.woff2',
    file_original: 'Sanoj-Future-Demo.woff2',
  },
];

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value));
}

function seed() {
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(defaultSettings)) {
    insertSetting.run(key, value);
  }

  if (!getSetting('admin_password_hash')) {
    setSetting('admin_password_hash', hashPassword(config.ADMIN_PASSWORD));
  }

  const fontCount = db.prepare('SELECT COUNT(*) AS count FROM fonts').get().count;
  if (fontCount > 0) return;

  const now = new Date().toISOString();
  const insertFont = db.prepare(`
    INSERT INTO fonts (
      slug, name, category, styles, glyphs, tagline, description, price,
      type_class, accent, background, badge, published, sort_order,
      file_name, file_original, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
  `);

  db.exec('BEGIN');
  try {
    for (const font of demoFonts) {
      insertFont.run(
        font.slug,
        font.name,
        font.category,
        font.styles,
        font.glyphs,
        font.tagline,
        font.description,
        font.price,
        font.type_class,
        font.accent,
        font.background,
        font.badge,
        font.sort_order,
        font.file_name,
        font.file_original,
        now,
        now
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

seed();

module.exports = {
  db,
  databasePath,
  getSetting,
  setSetting,
};
