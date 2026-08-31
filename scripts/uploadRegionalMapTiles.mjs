#!/usr/bin/env node
/**
 * Upload DE/EU regional map tiles to Supabase bucket `staedte/maps/{de|eu}/`.
 *
 * Build first:
 *   npm run city:de-detail-tiles
 *   npm run city:eu-detail-tiles
 *
 * Env:
 *   EXPO_PUBLIC_SUPABASE_URL or SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY (preferred) or EXPO_PUBLIC_SUPABASE_ANON_KEY
 *
 * Usage:
 *   node scripts/uploadRegionalMapTiles.mjs
 *   node scripts/uploadRegionalMapTiles.mjs --tier de
 *   node scripts/uploadRegionalMapTiles.mjs --tier eu
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_ROOT = path.join(ROOT, 'scripts', 'homeMap', 'out');

function loadEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile();

const url =
  process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  '';

if (!url || !key || url.includes('your-project')) {
  console.error(
    'Missing SUPABASE_URL / EXPO_PUBLIC_SUPABASE_URL or service/anon key in env.',
  );
  process.exit(1);
}

async function uploadObject(objectPath, body, contentType) {
  const endpoint = `${url.replace(/\/$/, '')}/storage/v1/object/staedte/${objectPath}`;
  let lastErr = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          apikey: key,
          'Content-Type': contentType,
          'x-upsert': 'true',
          'cache-control': 'public, max-age=86400',
        },
        body,
      });
      if (res.ok) return;
      const text = await res.text().catch(() => '');
      lastErr = new Error(`Upload failed ${objectPath}: ${res.status} ${text}`);
      if (res.status >= 500 && attempt < 4) {
        await new Promise((r) => setTimeout(r, attempt * 1200));
        continue;
      }
      throw lastErr;
    } catch (err) {
      lastErr = err;
      if (attempt < 4) {
        await new Promise((r) => setTimeout(r, attempt * 1200));
        continue;
      }
      throw lastErr;
    }
  }
}

function listTierFiles(tierDir) {
  if (!fs.existsSync(tierDir)) {
    throw new Error(`Missing output dir: ${tierDir} — run city:*-detail-tiles first`);
  }
  return fs
    .readdirSync(tierDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(tierDir, f));
}

async function uploadTier(tier) {
  const tierDir = path.join(OUT_ROOT, tier);
  const files = listTierFiles(tierDir);
  console.log(`[upload:regional-map] ${tier}: ${files.length} files`);
  for (const filePath of files) {
    const name = path.basename(filePath);
    const objectPath = `maps/${tier}/${name}`;
    const body = fs.readFileSync(filePath);
    await uploadObject(objectPath, body, 'application/json');
    console.log('  ✓', objectPath);
  }
}

async function main() {
  const tierArg = process.argv.find((a) => a.startsWith('--tier='))?.split('=')[1]
    ?? (process.argv.includes('--tier') ? process.argv[process.argv.indexOf('--tier') + 1] : null);
  const tiers = tierArg ? [tierArg] : ['de', 'eu'];
  for (const tier of tiers) {
    if (tier !== 'de' && tier !== 'eu') {
      console.error('Unknown tier:', tier);
      process.exit(1);
    }
    await uploadTier(tier);
  }
  console.log('[upload:regional-map] done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
