#!/usr/bin/env node
/**
 * Stylisiertes Stadt-Cover einbinden (+ optional Supabase Upload).
 *
 *   npm run city:cover:apply -- --id laboe --from ./stylized.png
 *   npm run city:cover:apply -- --id laboe --from ./stylized.png --upload
 *   npm run city:cover:apply -- --id laboe --from ./x.png --asset-tag soft
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT,
  arg,
  hasFlag,
  loadEnvFile,
  loadPack,
  savePack,
  slugify,
} from './lib.mjs';
import {
  findPending,
  markApplied,
  markStylized,
} from './pendingCovers.mjs';
import { COVER_STYLE_ID } from './coverStyle.mjs';

loadEnvFile();

const CITY_COVERS_TS = path.join(ROOT, 'src', 'constants', 'cityCovers.ts');
const ONBOARDING = path.join(ROOT, 'assets', 'onboarding');

function parseNum(name, fallback) {
  const v = arg(name);
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function ensureFocusEntry(src, cityId, focus) {
  const re =
    /(const\s+COVER_FOCUS\s*:\s*Record<[^>]+>\s*=\s*\{)([\s\S]*?)(\n\};)/;
  const m = src.match(re);
  // Cover-Fokus-Map optional (1:1-Anzeige) — Search-Meta reicht.
  if (!m) return src;
  const line = `  ${cityId}: { scale: ${focus.scale}, translateY: ${focus.translateY}, translateX: ${focus.translateX} },`;
  const body = m[2];
  if (new RegExp(`^\\s*${cityId}\\s*:`, 'm').test(body)) {
    const replaced = body.replace(
      new RegExp(`^\\s*${cityId}\\s*:\\s*\\{[^}]+\\},?`, 'm'),
      line,
    );
    return src.replace(re, `${m[1]}${replaced}${m[3]}`);
  }
  const trimmed = body.replace(/\s*$/, '');
  return src.replace(re, `${m[1]}${trimmed}\n${line}\n${m[3]}`);
}

function ensureSearchMetaStub(src, cityId, cityName) {
  const re =
    /(export\s+const\s+CITY_SEARCH_META\s*:\s*Record<[^>]+>\s*=\s*\{)([\s\S]*?)(\n\};)/;
  const m = src.match(re);
  if (!m) return src;
  if (new RegExp(`^\\s*${cityId}\\s*:`, 'm').test(m[2])) return src;
  const label = cityName || cityId;
  const stub = `  ${cityId}: {
    region: '',
    country: 'Deutschland',
    aliases: ['${label.replace(/'/g, "\\'")}'],
  },
`;
  const trimmed = m[2].replace(/\s*$/, '');
  return src.replace(re, `${m[1]}${trimmed}\n${stub}${m[3]}`);
}

function resolveFrom(id, fromArg) {
  if (fromArg) return path.resolve(fromArg);
  const pending = findPending(id);
  if (pending?.stylized) {
    const p = path.join(ROOT, pending.stylized);
    if (fs.existsSync(p)) return p;
  }
  const fallback = path.join(
    ROOT,
    'data',
    'staedte',
    'pending-covers',
    id,
    'stylized.png',
  );
  if (fs.existsSync(fallback)) return fallback;
  return null;
}

function main() {
  const cityName = arg('city') || '';
  const id = (arg('id') || slugify(cityName) || '').toLowerCase();
  if (!id) {
    console.error('Need --id or --city');
    process.exit(1);
  }

  const from = resolveFrom(id, arg('from'));
  if (!from || !fs.existsSync(from)) {
    console.error(
      `No stylized image. Pass --from <png> or put pending-covers/${id}/stylized.png`,
    );
    process.exit(1);
  }

  const tag = (arg('asset-tag') || 'soft').replace(/[^a-z0-9_-]/gi, '');
  fs.mkdirSync(ONBOARDING, { recursive: true });
  const destName = `city-${id}-${tag}.png`;
  const destAbs = path.join(ONBOARDING, destName);
  const canonicalAbs = path.join(ONBOARDING, `city-${id}.png`);
  fs.copyFileSync(from, destAbs);
  fs.copyFileSync(from, canonicalAbs);
  console.log(`[cover:apply] asset → assets/onboarding/${destName}`);

  const remoteDir = path.join(ONBOARDING, 'remote-covers');
  fs.mkdirSync(remoteDir, { recursive: true });
  fs.copyFileSync(from, path.join(remoteDir, `${id}.png`));

  const pendingStylizedRel = path
    .join('data', 'staedte', 'pending-covers', id, 'stylized.png')
    .replace(/\\/g, '/');
  const pendingStylizedAbs = path.join(ROOT, pendingStylizedRel);
  fs.mkdirSync(path.dirname(pendingStylizedAbs), { recursive: true });
  fs.copyFileSync(from, pendingStylizedAbs);
  try {
    markStylized(id, pendingStylizedRel);
  } catch {
    /* optional */
  }

  let ts = fs.readFileSync(CITY_COVERS_TS, 'utf8');
  // Kein require() mehr — Cover kommen nur per HTTPS (cover_url), APK bleibt schlank.
  ts = ensureFocusEntry(ts, id, {
    scale: parseNum('focus-scale', 1.06),
    translateY: parseNum('focus-y', -4),
    translateX: parseNum('focus-x', 0),
  });
  ts = ensureSearchMetaStub(ts, id, cityName || findPending(id)?.city_name);
  fs.writeFileSync(CITY_COVERS_TS, ts, 'utf8');
  console.log(
    `[cover:apply] patched focus/meta in cityCovers.ts (${id}) — no bundled asset`,
  );

  const pack = loadPack(id);
  if (pack) {
    pack._meta = {
      ...(pack._meta || {}),
      cover_local: `assets/onboarding/${destName}`,
      cover_source: 'stylized_soft_photo',
      cover_style: COVER_STYLE_ID,
      cover_delivery: 'on_demand_https',
    };
    savePack(pack, { bumpVersion: true });
    console.log(`[cover:apply] pack meta updated v=${pack.data_version}`);
  } else {
    console.log(
      `[cover:apply] no pack yet for ${id} — local source ready for later upload`,
    );
  }

  try {
    markApplied(id, {
      asset: `assets/onboarding/${destName}`,
      style: COVER_STYLE_ID,
    });
  } catch {
    /* ok */
  }

  if (hasFlag('upload')) {
    console.log(`[cover:apply] uploading cover + pack for ${id}…`);
    const upCover = spawnSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'cityPack', 'uploadCityCovers.mjs'), '--ids', id],
      { cwd: ROOT, stdio: 'inherit', env: process.env },
    );
    if (upCover.status !== 0) process.exit(upCover.status || 1);
    const packPath = path.join('data', 'staedte', `${id}.json`);
    if (fs.existsSync(path.join(ROOT, packPath))) {
      const upPack = spawnSync(
        process.execPath,
        [path.join(ROOT, 'scripts', 'uploadCityPack.mjs'), packPath],
        { cwd: ROOT, stdio: 'inherit', env: process.env },
      );
      if (upPack.status !== 0) process.exit(upPack.status || 1);
    }
  }

  console.log(`[cover:apply] DONE ${id} style=${COVER_STYLE_ID}`);
}

main();
