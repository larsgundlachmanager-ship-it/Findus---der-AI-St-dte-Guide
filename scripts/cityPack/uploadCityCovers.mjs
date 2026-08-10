#!/usr/bin/env node
/**
 * Lädt Stadt-Cover komprimiert (JPEG) nach Supabase staedte/covers/
 * und setzt pack.cover_url — App lädt erst bei Stadt-Vorschlag per HTTPS.
 *
 *   node scripts/cityPack/uploadCityCovers.mjs --ids hamburg,flensburg
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { arg, loadEnvFile, loadPack, savePack } from './lib.mjs';
import { compressCoverForUpload } from './compressCover.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

loadEnvFile();

const url = (
  process.env.SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  ''
).replace(/\/$/, '');
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  '';

if (!url || !key) {
  console.error('Missing SUPABASE_URL / service key in env.');
  process.exit(1);
}

async function upload(objectPath, body, contentType) {
  const endpoint = `${url}/storage/v1/object/staedte/${objectPath}`;
  for (const method of ['POST', 'PUT']) {
    const res = await fetch(endpoint, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        'Content-Type': contentType,
        'x-upsert': 'true',
        'Cache-Control': 'public, max-age=604800',
      },
      body,
    });
    if (res.ok) {
      console.log(`[upload] ${method} staedte/${objectPath}`);
      return;
    }
    if (method === 'PUT') {
      const t = await res.text().catch(() => '');
      throw new Error(`Upload failed ${objectPath}: ${res.status} ${t}`);
    }
  }
}

const ids = String(arg('ids') || 'hamburg,flensburg')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

for (const id of ids) {
  const candidates = [
    path.join(ROOT, 'assets', 'onboarding', 'remote-covers', `${id}.jpg`),
    path.join(ROOT, 'assets', 'onboarding', `city-${id}-soft.png`),
    path.join(ROOT, 'assets', 'onboarding', `city-${id}-3.png`),
    path.join(ROOT, 'assets', 'onboarding', `city-${id}-2.png`),
    path.join(ROOT, 'assets', 'onboarding', 'remote-covers', `${id}.png`),
    path.join(ROOT, 'assets', 'onboarding', `city-${id}.png`),
  ];
  const file = candidates.find((p) => fs.existsSync(p));
  if (!file) {
    throw new Error(`Missing cover file for ${id}: tried ${candidates.join(', ')}`);
  }

  const packed = await compressCoverForUpload(file);
  const stamp = Date.now().toString(36);
  const objectName = `covers/${id}-${stamp}${packed.ext}`;
  await upload(objectName, packed.buffer, packed.contentType);

  const kbIn = Math.round(packed.bytesIn / 1024);
  const kbOut = Math.round(packed.bytesOut / 1024);
  console.log(
    `[cover] ${id} ${kbIn}KB → ${kbOut}KB` +
      (packed.compressed ? ' (jpeg)' : ' (raw, install sharp for compression)'),
  );

  // Keep a compact local copy for re-uploads
  const remoteDir = path.join(ROOT, 'assets', 'onboarding', 'remote-covers');
  fs.mkdirSync(remoteDir, { recursive: true });
  if (packed.compressed) {
    fs.writeFileSync(path.join(remoteDir, `${id}.jpg`), packed.buffer);
  }

  const publicUrl = `${url}/storage/v1/object/public/staedte/${objectName}`;
  const pack = loadPack(id);
  if (!pack) {
    throw new Error(`No pack for ${id}`);
  }
  const localRel = path.relative(ROOT, file).replace(/\\/g, '/');
  pack.cover_url = publicUrl;
  pack._meta = {
    ...(pack._meta || {}),
    cover_url: publicUrl,
    cover_source: 'supabase_remote',
    cover_local: localRel,
    cover_style: 'soft_photo',
    cover_delivery: 'on_demand_https',
  };
  savePack(pack, { bumpVersion: true });
  console.log(`[pack] ${id} v=${pack.data_version} → ${publicUrl}`);
}
