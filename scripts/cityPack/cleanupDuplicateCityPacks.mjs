#!/usr/bin/env node
/**
 * Remove obsolete duplicate city packs from local disk + Supabase bucket,
 * rebuild a clean index (one entry per city).
 *
 * Canonical:
 *   berlin-zentral, berlin-umland
 *   frankfurt_am_main (not frankfurt)
 *   hochheim_am_main (not hochheim)
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, STAEDTE_DIR, loadEnvFile, writeJson } from './lib.mjs';

loadEnvFile();

const OBSOLETE = [
  'berlin.json',
  'berlin_umland.json',
  'frankfurt.json',
  'hochheim.json',
];

const url =
  process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  '';

async function deleteRemote(objectPath) {
  const endpoint = `${url.replace(/\/$/, '')}/storage/v1/object/staedte/${objectPath}`;
  const res = await fetch(endpoint, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
    },
  });
  console.log(`[delete] ${objectPath} → ${res.status}`);
  return res.ok || res.status === 404;
}

function isCityPackFile(f) {
  if (!f.endsWith('.json') || f === 'index.json' || f.startsWith('_')) return false;
  const base = f.slice(0, -'.json'.length);
  if (base.includes('.')) return false;
  return true;
}

function buildCleanIndex() {
  const files = fs.readdirSync(STAEDTE_DIR).filter(isCityPackFile);
  const available = [];
  for (const f of files) {
    const pack = JSON.parse(fs.readFileSync(path.join(STAEDTE_DIR, f), 'utf8'));
    if (!pack.city_id || !pack.name) continue;
    const idFromFile = f.replace(/\.json$/i, '');
    if (pack.city_id !== idFromFile) {
      console.warn(`[index] skip ${f}: city_id=${pack.city_id}`);
      continue;
    }
    if (OBSOLETE.includes(f)) continue;
    const cover =
      (typeof pack.cover_url === 'string' && pack.cover_url.trim()) || '';
    available.push({
      id: pack.city_id,
      name: pack.name,
      data_version: pack.data_version || 1,
      symbol: pack.symbol || '🌳',
      lat: pack.lat,
      lng: pack.lng,
      ...(cover ? { cover_url: cover, coverUrl: cover } : {}),
    });
  }
  available.sort((a, b) => String(a.name).localeCompare(String(b.name), 'de'));
  return {
    last_global_update: new Date().toISOString(),
    available_cities: available,
  };
}

async function main() {
  // Quarantine local duplicates
  for (const f of OBSOLETE) {
    const p = path.join(STAEDTE_DIR, f);
    if (!fs.existsSync(p)) continue;
    const bak = path.join(STAEDTE_DIR, `${f}.bak-duplicate`);
    fs.renameSync(p, bak);
    console.log(`[local] quarantine ${f}`);
  }
  // also bak-duplicate leftover
  for (const f of fs.readdirSync(STAEDTE_DIR)) {
    if (/^berlin_umland\.json$/i.test(f)) {
      fs.renameSync(
        path.join(STAEDTE_DIR, f),
        path.join(STAEDTE_DIR, `${f}.bak-duplicate`),
      );
    }
  }

  const index = buildCleanIndex();
  writeJson(path.join(STAEDTE_DIR, 'index.json'), index);
  console.log(
    `[index] ${index.available_cities.length} cities; berlin=`,
    index.available_cities
      .filter((c) => /berlin/i.test(c.id + c.name))
      .map((c) => c.id),
  );
  console.log(
    '[index] hochheim/frankfurt=',
    index.available_cities
      .filter((c) => /hochheim|frankfurt/i.test(c.id + c.name))
      .map((c) => `${c.id}:${c.name}`),
  );

  if (!url || !key) {
    console.warn('[remote] missing supabase credentials — local only');
    return;
  }

  for (const f of OBSOLETE) {
    await deleteRemote(f);
  }

  // upload clean index
  const endpoint = `${url.replace(/\/$/, '')}/storage/v1/object/staedte/index.json`;
  const body = JSON.stringify(index);
  let res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': 'application/json',
      'x-upsert': 'true',
    },
    body,
  });
  if (!res.ok) {
    res = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        'Content-Type': 'application/json',
        'x-upsert': 'true',
      },
      body,
    });
  }
  if (!res.ok) throw new Error(`index upload failed ${res.status}`);
  console.log('[upload] staedte/index.json');

  // verify bucket listing
  const listRes = await fetch(
    `${url.replace(/\/$/, '')}/storage/v1/object/list/staedte`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prefix: '',
        limit: 200,
        offset: 0,
        sortBy: { column: 'name', order: 'asc' },
      }),
    },
  );
  const listed = await listRes.json();
  const names = (Array.isArray(listed) ? listed : [])
    .map((x) => x.name)
    .filter((n) => String(n).endsWith('.json'));
  console.log(
    '[bucket] berlin/hoch/ffm leftovers',
    names.filter((n) => /berlin|hochheim|frankfurt/i.test(n)),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
