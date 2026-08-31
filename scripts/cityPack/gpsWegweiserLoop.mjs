#!/usr/bin/env node
/**
 * Pflicht-Schleife für jede Stadt nach Pack-Build / Research-Merge:
 *   1) Story-GPS → Google-Navigationspin / Haupteingang (--story-only)
 *   2) Wegweiser visuell härten (2 Approaches, Teaser, FAQ, Entrance-Sub)
 *   3) OSM-Gebäude-/Platz-Umrisse für Story-Orte (wie Prisdorf)
 *
 * Usage:
 *   node scripts/cityPack/gpsWegweiserLoop.mjs --city luebeck
 *   npm run city:gps-wegweiser -- --city luebeck
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, arg, hasFlag, loadEnvFile } from './lib.mjs';

loadEnvFile();

function runStep(scriptRel, args, { fatal = true } = {}) {
  const script = path.join(ROOT, 'scripts', 'cityPack', scriptRel);
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  if (r.status !== 0) {
    const msg = `${scriptRel} failed (exit ${r.status})`;
    if (fatal) throw new Error(msg);
    console.warn(`[gps-wegweiser] ${msg} — weiter mit nächstem Schritt`);
    return false;
  }
  return true;
}

export function runGpsWegweiserLoop(cityId) {
  if (!cityId) throw new Error('city id required');
  console.log(`\n[gps-wegweiser] ▶ ${cityId}`);
  runStep(
    'auditEntrances.mjs',
    ['--city', cityId, '--apply', '--story-only', '--max-delta', '120'],
    { fatal: false },
  );
  runStep(
    'hardenApproachesVisual.mjs',
    ['--city', cityId, '--apply', '--story-only'],
    { fatal: true },
  );
  runStep(
    'snapOsmStoryFootprints.mjs',
    ['--city', cityId, '--no-upload'],
    { fatal: false },
  );
  if (hasFlag('skip-map')) {
    console.log(`[gps-wegweiser] skip offline-map ${cityId}`);
  } else {
    runStep(
      'buildCityOfflineMap.mjs',
      ['--city', cityId, '--no-upload'],
      { fatal: false },
    );
  }
  console.log(`[gps-wegweiser] done ${cityId}`);
}

function main() {
  const cityId = arg('city');
  if (!cityId) {
    console.error(
      'Usage: node scripts/cityPack/gpsWegweiserLoop.mjs --city <id>',
    );
    process.exit(1);
  }
  runGpsWegweiserLoop(cityId);
}

const isDirect = process.argv[1]?.replace(/\\/g, '/').endsWith(
  'gpsWegweiserLoop.mjs',
);
if (isDirect) {
  try {
    main();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
