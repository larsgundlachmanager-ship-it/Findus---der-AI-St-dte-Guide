#!/usr/bin/env node
/**
 * Upload city pack(s) to Supabase Storage bucket `staedte`.
 *
 * Env:
 *   EXPO_PUBLIC_SUPABASE_URL or SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY (preferred) or EXPO_PUBLIC_SUPABASE_ANON_KEY
 *
 * Usage:
 *   node scripts/uploadCityPack.mjs data/staedte/prisdorf.json
 *   node scripts/uploadCityPack.mjs --all
 *   node scripts/uploadCityPack.mjs --index
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'data', 'staedte');

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
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    body,
  });
  if (!res.ok) {
    // try PUT upsert alternative
    const res2 = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        'Content-Type': contentType,
        'x-upsert': 'true',
      },
      body,
    });
    if (!res2.ok) {
      const t = await res2.text().catch(() => '');
      throw new Error(`Upload failed ${objectPath}: ${res.status}/${res2.status} ${t}`);
    }
  }
  console.log(`[upload] staedte/${objectPath}`);
}

function isCityPackFile(f) {
  if (!f.endsWith('.json') || f === 'index.json' || f.startsWith('_')) {
    return false;
  }
  // Skip reports/aux: pinneberg.gaps.json, hechingen.research.json, …
  if (f.includes('.')) {
    const base = f.slice(0, -'.json'.length);
    if (base.includes('.')) return false;
  }
  return true;
}

/** Veraltete Duplikat-Packs — nie wieder in index.json aufnehmen. */
const OBSOLETE_PACK_IDS = new Set([
  'berlin',
  'berlin_umland',
  'frankfurt',
  'hochheim',
]);

function buildIndex() {
  const files = fs.readdirSync(OUT_DIR).filter(isCityPackFile);
  const available = [];
  for (const f of files) {
    const pack = JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), 'utf8'));
    if (!pack.city_id || !pack.name) {
      console.warn(`[upload] skip index entry for ${f} (missing city_id/name)`);
      continue;
    }
    const idFromFile = f.replace(/\.json$/i, '');
    if (OBSOLETE_PACK_IDS.has(pack.city_id) || OBSOLETE_PACK_IDS.has(idFromFile)) {
      console.warn(`[upload] skip obsolete pack ${f}`);
      continue;
    }
    if (pack.city_id !== idFromFile) {
      console.warn(
        `[upload] skip index entry for ${f} (city_id=${pack.city_id} ≠ file)`,
      );
      continue;
    }
    const cover =
      (typeof pack.cover_url === 'string' && pack.cover_url.trim()) ||
      (typeof pack._meta?.cover_url === 'string' &&
        String(pack._meta.cover_url).trim()) ||
      '';
    available.push({
      id: pack.city_id,
      name: pack.name,
      data_version: pack.data_version || 1,
      symbol: pack.symbol || '🌳',
      lat: pack.lat,
      lng: pack.lng,
      ...(cover
        ? { cover_url: cover, coverUrl: cover }
        : {}),
    });
  }
  return {
    last_global_update: new Date().toISOString(),
    available_cities: available,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const files = [];

  if (args.includes('--all')) {
    for (const f of fs.readdirSync(OUT_DIR)) {
      if (isCityPackFile(f)) {
        files.push(path.join(OUT_DIR, f));
      }
    }
  } else {
    for (const a of args) {
      if (a.startsWith('--')) continue;
      files.push(path.resolve(a));
    }
  }

  if (args.includes('--index') || args.includes('--all') || files.length) {
    // always refresh index when uploading packs
  }

  for (const file of files) {
    if (!fs.existsSync(file)) throw new Error(`Missing file ${file}`);
    const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
    const name = `${pack.city_id}.json`;
    await uploadObject(name, JSON.stringify(pack), 'application/json');
  }

  if (args.includes('--index') || args.includes('--all') || files.length) {
    const index = buildIndex();
    // merge with remote known cities if local missing pinneberg etc.
    const indexPath = path.join(OUT_DIR, 'index.json');
    let merged = index;
    if (fs.existsSync(indexPath)) {
      const local = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      const byId = new Map();
      for (const c of local.available_cities || []) {
        if (c?.id && !OBSOLETE_PACK_IDS.has(c.id)) byId.set(c.id, c);
      }
      for (const c of index.available_cities) {
        if (c?.id && !OBSOLETE_PACK_IDS.has(c.id)) byId.set(c.id, c);
      }
      merged = {
        last_global_update: new Date().toISOString(),
        available_cities: [...byId.values()],
      };
    }
    fs.writeFileSync(indexPath, JSON.stringify(merged, null, 2));
    await uploadObject('index.json', JSON.stringify(merged), 'application/json');
  }

  if (!files.length && !args.includes('--index')) {
    console.error(
      'Usage: node scripts/uploadCityPack.mjs <file.json> | --all | --index',
    );
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
