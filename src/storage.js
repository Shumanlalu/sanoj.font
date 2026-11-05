'use strict';

const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

let client = null;

function getStorageClient() {
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
    throw Object.assign(
      new Error(
        'Supabase Storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
      ),
      { status: 500 }
    );
  }

  if (!client) {
    client = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }

  return client;
}

function contentTypeFor(fileName) {
  const extension = String(fileName || '').split('.').pop().toLowerCase();
  return (
    {
      woff2: 'font/woff2',
      woff: 'font/woff',
      ttf: 'font/ttf',
      otf: 'font/otf',
      zip: 'application/zip',
    }[extension] || 'application/octet-stream'
  );
}

async function uploadFontObject(objectName, buffer, contentType) {
  const storage = getStorageClient().storage.from(config.SUPABASE_BUCKET);
  const { error } = await storage.upload(objectName, buffer, {
    contentType: contentType || contentTypeFor(objectName),
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) {
    throw Object.assign(new Error(`Font upload failed: ${error.message}`), { status: 502 });
  }
  return objectName;
}

async function deleteFontObjects(objectNames) {
  const names = [...new Set((objectNames || []).filter(Boolean))];
  if (!names.length) return;
  const storage = getStorageClient().storage.from(config.SUPABASE_BUCKET);
  const { error } = await storage.remove(names);
  if (error) {
    console.error('[storage] Could not delete font object:', error.message);
  }
}

async function fontObjectExists(objectName) {
  const storage = getStorageClient().storage.from(config.SUPABASE_BUCKET);
  const separator = objectName.lastIndexOf('/');
  const folder = separator === -1 ? '' : objectName.slice(0, separator);
  const name = separator === -1 ? objectName : objectName.slice(separator + 1);

  const { data, error } = await storage.list(folder, { limit: 100, search: name });
  if (error) {
    throw new Error(`Could not inspect Supabase Storage: ${error.message}`);
  }
  return (data || []).some((object) => object.name === name);
}

async function createFontDownloadUrl(objectName, downloadName) {
  const storage = getStorageClient().storage.from(config.SUPABASE_BUCKET);
  const { data, error } = await storage.createSignedUrl(
    objectName,
    config.SUPABASE_SIGNED_URL_TTL,
    { download: downloadName || true }
  );
  if (error || !data?.signedUrl) {
    throw Object.assign(
      new Error(`The font download could not be prepared: ${error?.message || 'missing signed URL'}`),
      { status: 502 }
    );
  }
  return data.signedUrl;
}

async function ensureFontBucket() {
  const storage = getStorageClient().storage;
  const { data: buckets, error: listError } = await storage.listBuckets();
  if (listError) {
    throw new Error(`Could not list Supabase Storage buckets: ${listError.message}`);
  }
  if (buckets.some((bucket) => bucket.name === config.SUPABASE_BUCKET)) return false;

  const { error } = await storage.createBucket(config.SUPABASE_BUCKET, {
    public: false,
    fileSizeLimit: 10 * 1024 * 1024,
    allowedMimeTypes: ['font/woff2', 'font/woff', 'font/ttf', 'font/otf', 'application/zip'],
  });
  if (error) {
    throw new Error(`Could not create the Supabase Storage bucket: ${error.message}`);
  }
  return true;
}

module.exports = {
  getStorageClient,
  contentTypeFor,
  uploadFontObject,
  deleteFontObjects,
  fontObjectExists,
  createFontDownloadUrl,
  ensureFontBucket,
};
