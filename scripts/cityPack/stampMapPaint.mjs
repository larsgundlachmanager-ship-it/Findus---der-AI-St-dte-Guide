#!/usr/bin/env node
/**
 * Stempel map_paint auf alle Spots einer Stadt (oder --all).
 *
 *   node scripts/cityPack/stampMapPaint.mjs --city prisdorf
 *   node scripts/cityPack/stampMapPaint.mjs --city prisdorf --no-upload
 *   node scripts/cityPack/stampMapPaint.mjs --all --no-upload
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { arg, hasFlag, loadPack, savePack, STAEDTE_DIR, ROOT } from './lib.mjs';
import { stampMapPaintOnPack } from './mapPaintPolicy.mjs';

function listCityIds() {
  return fs
    .readdirSync(STAEDTE_DIR)
    .filter((f) => /^[a-z0-9_-]+\.json$/i.test(f) && f !== 'index.json')
    .map((f) => f.replace(/\.json$/i, ''));
}

function processCity(cityId, { skipUpload }) {
  const pack = loadPack(cityId);
  if (!pack) throw new Error(`pack missing: ${cityId}`);
  const stats = stampMapPaintOnPack(pack);
  savePack(pack, { bumpVersion: true });
  console.log(
    `[map-paint] ${cityId}: story_fill=${stats.storyFill} building_focus=${stats.buildingFocus} icon_only=${stats.iconOnly} polysCleared=${stats.polysCleared}`,
  );
  if (!skipUpload) {
    const file = path.join(ROOT, 'data', 'staedte', `${cityId}.json`);
    const r = spawnSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'uploadCityPack.mjs'), file],
      { cwd: ROOT, stdio: 'inherit', env: process.env },
    );
    if (r.status !== 0) throw new Error(`upload ${cityId} exit ${r.status}`);
  }
  return stats;
}

function main() {
  const skipUpload = hasFlag('no-upload') || hasFlag('skip-upload');
  const all = hasFlag('all');
  const cityId = arg('city');
  if (!all && !cityId) {
    console.error(
      'Usage: node scripts/cityPack/stampMapPaint.mjs --city <id> | --all [--no-upload]',
    );
    process.exit(1);
  }
  const ids = all ? listCityIds() : [cityId];
  for (const id of ids) {
    processCity(id, { skipUpload });
  }
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exit(1);
}
