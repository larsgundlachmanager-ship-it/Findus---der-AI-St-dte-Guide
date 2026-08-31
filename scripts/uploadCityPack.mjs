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
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  buildPackPatch,
  keepLatestPatchRefs,
  patchObjectPath,
  patchTooLarge,
} from './cityPack/packDelta.mjs';

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

async function uploadObject(objectPath, body, contentType, extra = {}) {
  const endpoint = `${url.replace(/\/$/, '')}/storage/v1/object/staedte/${objectPath}`;
  const headers = {
    Authorization: `Bearer ${key}`,
    apikey: key,
    'Content-Type': contentType,
    'x-upsert': 'true',
    'cache-control': extra.cacheControl || 'public, max-age=3600',
  };
  if (extra.contentEncoding) {
    headers['content-encoding'] = extra.contentEncoding;
  }
  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body,
  });
  if (!res.ok) {
    const res2 = await fetch(endpoint, {
      method: 'PUT',
      headers,
      body,
    });
    if (!res2.ok) {
      const t = await res2.text().catch(() => '');
      throw new Error(
        `Upload failed ${objectPath}: ${res.status}/${res2.status} ${t}`,
      );
    }
  }
  console.log(`[upload] staedte/${objectPath}`);
}

async function uploadJson(objectPath, jsonText, cacheControl) {
  await uploadObject(objectPath, jsonText, 'application/json', {
    cacheControl,
  });
  return {
    sha256: sha256Text(jsonText),
    rawBytes: Buffer.byteLength(jsonText, 'utf8'),
  };
}

function hashFilePath() {
  return path.join(OUT_DIR, '_upload_hashes.json');
}

function loadHashes() {
  const p = hashFilePath();
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

function saveHashes(hashes) {
  fs.writeFileSync(hashFilePath(), JSON.stringify(hashes, null, 2));
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

async function downloadRemoteJson(objectPath) {
  const endpoint = `${url.replace(/\/$/, '')}/storage/v1/object/staedte/${objectPath}`;
  const res = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      Accept: 'application/json',
    },
  });
  if (!res.ok) return null;
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isCityPackFile(f) {
  if (!f.endsWith('.json') || f === 'index.json' || f.startsWith('_')) {
    return false;
  }
  if (f.includes('.')) {
    const base = f.slice(0, -'.json'.length);
    if (base.includes('.')) return false;
  }
  return true;
}

const OBSOLETE_PACK_IDS = new Set([
  'berlin',
  'berlin_umland',
  'frankfurt',
  'hochheim',
]);

function packUiStats(pack) {
  const spots = Array.isArray(pack.spots) ? pack.spots : [];
  const tps = Array.isArray(pack.trigger_points) ? pack.trigger_points : [];
  const idx = pack._pack_index || {};
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  };
  const story =
    spots.filter((s) => s && s.pack_role !== 'directory').length || num(idx.story);
  const directory =
    spots.filter((s) => s && s.pack_role === 'directory').length ||
    num(idx.directory);

  let zoneCount = 0;
  let approachCount = 0;
  let subCount = 0;
  for (const t of tps) {
    if (!t || typeof t.lat !== 'number' || typeof t.lng !== 'number') continue;
    const kind = String(t.trigger_kind || 'area');
    if (kind === 'approach') approachCount += 1;
    else if (kind === 'sub') subCount += 1;
    else zoneCount += 1;
  }
  if (approachCount === 0) {
    for (const s of spots) {
      const arr = s?.approach_triggers || s?.approachTriggers || [];
      for (const a of arr) {
        const lat = a?.lat ?? a?.latitude;
        const lng = a?.lng ?? a?.longitude;
        if (typeof lat === 'number' && typeof lng === 'number') {
          approachCount += 1;
        }
      }
    }
  }
  if (zoneCount === 0) {
    zoneCount = spots.filter(
      (s) => s && typeof s.lat === 'number' && typeof s.lng === 'number',
    ).length;
  }
  const triggerCount = zoneCount + approachCount + subCount;

  let facts = 0;
  for (const t of tps) {
    if (!t) continue;
    if (t.trigger_kind === 'approach' || t.trigger_kind === 'sub') continue;
    const gi = t.general_info;
    if (typeof gi === 'string' && gi.trim()) facts += 1;
    else if (Array.isArray(gi)) facts += gi.filter(Boolean).length;
    if (Array.isArray(t.deep_data_pool)) facts += t.deep_data_pool.length;
  }
  for (const s of spots) {
    if (Array.isArray(s?.bullets)) facts += s.bullets.filter(Boolean).length;
  }

  return {
    triggerCount,
    zoneCount,
    approachCount,
    subCount,
    storyCount: story,
    directoryCount: directory,
    factCount: facts,
    placeCount: triggerCount,
    gpsCount: zoneCount,
  };
}

/** Genug Punkte für hasDetailedCityBoundaryPolygon (≥80) — ohne volle OSM-Ringe. */
function simplifyCoveragePolygon(poly, maxPts = 120) {
  if (!Array.isArray(poly) || poly.length < 6) return null;
  const ring = poly
    .map((p) => {
      if (!Array.isArray(p) || p.length < 2) return null;
      const lat = Number(p[0]);
      const lng = Number(p[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return [lat, lng];
    })
    .filter(Boolean);
  if (ring.length < 6) return null;
  if (ring.length <= maxPts) return ring;
  const out = [];
  const step = (ring.length - 1) / (maxPts - 1);
  for (let i = 0; i < maxPts - 1; i++) {
    out.push(ring[Math.round(i * step)]);
  }
  const last = ring[ring.length - 1];
  const first = out[0];
  if (
    !last ||
    !first ||
    last[0] !== first[0] ||
    last[1] !== first[1]
  ) {
    out.push(last);
  }
  return out;
}

function coverageForIndex(pack) {
  const c = pack?._coverage;
  if (!c) return null;
  const latMin = Number(c.latMin);
  const latMax = Number(c.latMax);
  const lngMin = Number(c.lngMin);
  const lngMax = Number(c.lngMax);
  if (![latMin, latMax, lngMin, lngMax].every(Number.isFinite)) return null;
  if (latMin >= latMax || lngMin >= lngMax) return null;
  const polygon = simplifyCoveragePolygon(c.polygon);
  return {
    latMin,
    latMax,
    lngMin,
    lngMax,
    ...(polygon ? { polygon } : {}),
  };
}

function buildIndex(patchByCity) {
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
    const patches = patchByCity.get(pack.city_id);
    const coverage = coverageForIndex(pack);
    available.push({
      id: pack.city_id,
      name: pack.name,
      data_version: pack.data_version || 1,
      symbol: pack.symbol || '🌳',
      lat: pack.lat,
      lng: pack.lng,
      ...(cover ? { cover_url: cover, coverUrl: cover } : {}),
      ...packUiStats(pack),
      ...(coverage || {}),
      ...(patches?.length ? { patches } : {}),
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

  const hashes = loadHashes();
  const patchByCity = new Map();
  let uploadedSomething = false;

  const indexPath = path.join(OUT_DIR, 'index.json');
  if (fs.existsSync(indexPath)) {
    try {
      const local = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      for (const c of local.available_cities || []) {
        if (c?.id && Array.isArray(c.patches) && c.patches.length) {
          patchByCity.set(c.id, c.patches);
        }
      }
    } catch {
      /* ignore */
    }
  }

  for (const file of files) {
    if (!fs.existsSync(file)) throw new Error(`Missing file ${file}`);
    const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
    const name = `${pack.city_id}.json`;
    const jsonText = JSON.stringify(pack);
    const digest = sha256Text(jsonText);

    if (hashes[name] === digest) {
      console.log(`[skip] ${name} unverändert`);
    } else {
      const prev = await downloadRemoteJson(name);
      let nextPatches = [];
      if (prev && typeof prev === 'object') {
        const patch = buildPackPatch(prev, pack);
        if (patch && !patchTooLarge(patch, pack)) {
          const patchFile = patchObjectPath(
            pack.city_id,
            patch.from_version,
            patch.to_version,
          );
          const patchText = JSON.stringify(patch);
          await uploadJson(patchFile, patchText, 'public, max-age=86400');
          nextPatches = keepLatestPatchRefs(
            [
              ...(patchByCity.get(pack.city_id) || []),
              {
                from: patch.from_version,
                to: patch.to_version,
                file: patchFile,
                bytes: Buffer.byteLength(patchText, 'utf8'),
              },
            ],
            Number(pack.data_version) || patch.to_version,
          );
          console.log(
            `[patch] ${pack.city_id} v${patch.from_version}→v${patch.to_version}`,
          );
        } else {
          console.log(`[patch] ${pack.city_id} zu groß / ungeeignet → nur Full-File`);
        }
      }
      const up = await uploadJson(name, jsonText, 'public, max-age=3600');
      console.log(`[pack] ${name} ${Math.round(up.rawBytes / 1024)}k`);
      hashes[name] = digest;
      patchByCity.set(pack.city_id, nextPatches);
      uploadedSomething = true;
    }

    const mapFile = path.join(OUT_DIR, `${pack.city_id}.map.json`);
    if (fs.existsSync(mapFile)) {
      const mapBuf = fs.readFileSync(mapFile);
      const mapKey = `${pack.city_id}.map.json`;
      const mapHash = crypto.createHash('sha256').update(mapBuf).digest('hex');
      if (hashes[mapKey] === mapHash) {
        console.log(`[skip] ${mapKey} unverändert`);
      } else {
        try {
          await uploadObject(mapKey, mapBuf, 'application/json', {
            cacheControl: 'public, max-age=3600',
          });
          hashes[mapKey] = mapHash;
          uploadedSomething = true;
        } catch (e) {
          const msg = String(e.message || e);
          if (/413|too large|EntityTooLarge/i.test(msg)) {
            console.warn(`[skip] ${mapKey} zu groß für Storage — Pack-JSON ist oben`);
          } else {
            throw e;
          }
        }
      }
    }
  }

  saveHashes(hashes);

  if (args.includes('--index') || uploadedSomething || files.length) {
    const index = buildIndex(patchByCity);
    let merged = index;
    if (fs.existsSync(indexPath)) {
      const local = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      const byId = new Map();
      for (const c of local.available_cities || []) {
        if (c?.id && !OBSOLETE_PACK_IDS.has(c.id)) byId.set(c.id, c);
      }
      for (const c of index.available_cities) {
        if (c?.id && !OBSOLETE_PACK_IDS.has(c.id)) byId.set(c.id, { ...byId.get(c.id), ...c });
      }
      merged = {
        last_global_update: new Date().toISOString(),
        available_cities: [...byId.values()],
      };
    }
    try {
      fs.writeFileSync(indexPath, JSON.stringify(merged, null, 2));
    } catch (e) {
      console.warn(`[upload] local index.json skip: ${e.message || e}`);
    }
    if (uploadedSomething || args.includes('--index')) {
      await uploadJson(
        'index.json',
        JSON.stringify(merged),
        'public, max-age=120',
      );
    }
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
