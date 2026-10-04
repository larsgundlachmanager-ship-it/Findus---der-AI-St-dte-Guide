#!/usr/bin/env node
/**
 * Map-Perfect Pipeline für eine Stadt (kein Google-Bulk):
 *   1) polishMapBullets
 *   2) osm-footprints --all-spots --no-upload
 *   3) mapPerfectGate
 *   4) optional upload:city
 *
 *   node scripts/cityPack/mapPerfectCity.mjs --city kiel
 *   node scripts/cityPack/mapPerfectCity.mjs --city kiel --no-upload
 *   node scripts/cityPack/mapPerfectCity.mjs --city kiel --strict
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, arg, hasFlag, loadEnvFile } from './lib.mjs';

loadEnvFile();

function run(scriptRel, args, { fatal = true } = {}) {
  const script = path.join(ROOT, 'scripts', 'cityPack', scriptRel);
  console.log(`\n[map-perfect] ▶ ${scriptRel} ${args.join(' ')}`);
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  if (r.status !== 0) {
    const msg = `${scriptRel} exit ${r.status}`;
    if (fatal) throw new Error(msg);
    console.warn(`[map-perfect] ${msg} — weiter`);
    return false;
  }
  return true;
}

function uploadCity(cityId) {
  const file = path.join(ROOT, 'data', 'staedte', `${cityId}.json`);
  console.log(`\n[map-perfect] ▶ upload:city ${cityId}`);
  const r = spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'uploadCityPack.mjs'), file],
    { cwd: ROOT, stdio: 'inherit', env: process.env },
  );
  if (r.status !== 0) throw new Error(`upload:city ${cityId} exit ${r.status}`);
}

function main() {
  const cityId = arg('city');
  if (!cityId) {
    console.error(
      'Usage: node scripts/cityPack/mapPerfectCity.mjs --city <id> [--no-upload] [--strict] [--force-footprints]',
    );
    process.exit(1);
  }
  const skipUpload = hasFlag('no-upload') || hasFlag('skip-upload');
  const strict = hasFlag('strict');
  const forceFoot = hasFlag('force-footprints') || hasFlag('force');

  console.log(`[map-perfect] city=${cityId} strict=${strict} upload=${!skipUpload}`);

  run('stampMapPaint.mjs', ['--city', cityId, '--no-upload'], { fatal: true });
  run('polishMapBullets.mjs', ['--city', cityId], { fatal: false });
  run('forceFillMapBullets.mjs', ['--city', cityId], { fatal: false });

  // Overpass oft 429/504 — Gap nur opt-in (--with-gap), sonst Footprints + Bullets.
  if (hasFlag('with-gap')) {
    run(
      'basemapGap.mjs',
      ['--city', cityId, '--apply', '--no-upload'],
      { fatal: false },
    );
  } else {
    console.log('[map-perfect] skip basemap-gap (use --with-gap when Overpass healthy)');
  }

  const footArgs = ['--city', cityId, '--no-upload', '--all-spots'];
  if (forceFoot) footArgs.push('--force');
  run('snapOsmStoryFootprints.mjs', footArgs, { fatal: false });

  // Bullets nochmal nach Footprint-Tags
  run('polishMapBullets.mjs', ['--city', cityId], { fatal: false });
  run('forceFillMapBullets.mjs', ['--city', cityId], { fatal: false });

  const gateArgs = ['--city', cityId];
  if (strict) gateArgs.push('--strict');
  const gateOk = run('mapPerfectGate.mjs', gateArgs, { fatal: false });

  if (!skipUpload) {
    uploadCity(cityId);
  }

  if (!gateOk) {
    console.warn(`[map-perfect] ${cityId} gate soft-fail — Pack ggf. trotzdem hochgeladen`);
    process.exitCode = 0; // Nacht-Lauf nicht abbrechen; Report später
  } else {
    console.log(`[map-perfect] ✓ ${cityId}`);
  }
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exit(1);
}
