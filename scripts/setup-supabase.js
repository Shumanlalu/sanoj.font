'use strict';

/*
 * One-time Supabase setup.
 *
 *   1. Creates the PostgreSQL schema and seeds the demo catalogue.
 *   2. Creates the private Supabase Storage bucket.
 *   3. Uploads the six demo font packages.
 *
 * Run it after filling in .env:
 *
 *   npm.cmd run setup:supabase
 *
 * Add --force to re-upload demo packages that already exist.
 */

const fs = require('node:fs');
const path = require('node:path');

const config = require('../src/config');
const { initializeDatabase, getPool, demoFonts } = require('../src/database');
const {
  ensureFontBucket,
  fontObjectExists,
  uploadFontObject,
  deleteFontObjects,
  contentTypeFor,
} = require('../src/storage');

const force = process.argv.includes('--force');
const demoDir = path.join(config.ROOT, 'storage', 'fonts');

function printMissingConfig(missing) {
  console.error('');
  console.error('  Supabase is not configured yet.');
  console.error('');
  console.error(`  Missing: ${missing.join(', ')}`);
  console.error('');
  console.error('  Copy .env.example to .env, fill in the values from your Supabase');
  console.error('  project, then run this command again:');
  console.error('');
  console.error('    npm.cmd run setup:supabase');
  console.error('');
  console.error('  Supabase dashboard: https://supabase.com/dashboard');
  console.error('');
}

async function main() {
  const missing = [];
  if (!config.DATABASE_URL) missing.push('DATABASE_URL');
  if (!config.SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!config.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length) {
    printMissingConfig(missing);
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log('  SANOJ TYPE FOUNDRY — SUPABASE SETUP');
  console.log('');
  console.log('  [1/3] Creating the PostgreSQL schema and seed data…');
  await initializeDatabase();
  console.log('        Schema and demo catalogue are ready.');

  console.log('  [2/3] Ensuring the private storage bucket…');
  const created = await ensureFontBucket();
  console.log(
    created
      ? `        Created bucket "${config.SUPABASE_BUCKET}".`
      : `        Bucket "${config.SUPABASE_BUCKET}" already exists.`
  );

  console.log('  [3/3] Uploading the demo font packages…');
  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const font of demoFonts) {
    const filePath = path.join(demoDir, font.file_name);
    if (!fs.existsSync(filePath)) {
      console.warn(`        ! ${font.file_name} is missing from storage/fonts — skipped.`);
      skipped += 1;
      continue;
    }

    try {
      const exists = await fontObjectExists(font.file_name);
      if (exists && !force) {
        console.log(`        = ${font.file_name} (already uploaded)`);
        skipped += 1;
        continue;
      }
      if (exists && force) {
        await deleteFontObjects([font.file_name]);
      }

      await uploadFontObject(
        font.file_name,
        fs.readFileSync(filePath),
        contentTypeFor(font.file_name)
      );
      console.log(`        + ${font.file_name}`);
      uploaded += 1;
    } catch (error) {
      console.error(`        x ${font.file_name}: ${error.message}`);
      failed += 1;
    }
  }

  console.log('');
  console.log(`  Uploaded ${uploaded}, skipped ${skipped}, failed ${failed}.`);
  console.log('');
  console.log('  Supabase is ready. Next steps:');
  console.log('    1. Start locally:  npm.cmd start');
  console.log('    2. Sign in at:     http://localhost:3000/admin/');
  console.log('    3. Change the default admin password and UPI address.');
  console.log('');

  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error('');
    console.error('  Setup failed:', error.message);
    if (error.code) console.error('  Code:', error.code);
    console.error('');
    process.exitCode = 1;
  })
  .finally(async () => {
    if (config.DATABASE_URL) {
      try {
        await getPool().end();
      } catch {
        // The process is exiting anyway.
      }
    }
  });
