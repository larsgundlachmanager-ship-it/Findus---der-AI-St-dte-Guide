/**
 * Run: npx --yes tsx src/services/homeMap/mapLibreDiskCache.smoke.test.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const src = readFileSync(
  join(process.cwd(), 'src/services/homeMap/mapLibreDiskCache.ts'),
  'utf8',
);
assert(src.includes('12 * 60 * 60_000'), 'Disk-Cache 12 h');
assert(src.includes('maplibre-gl@4.7.1'), 'MapLibre 4.7.1');
assert(src.includes('ensureMapLibreDiskCache'), 'Warmup lädt JS/CSS/Style');

const warmup = readFileSync(
  join(process.cwd(), 'src/services/homeMap/warmupHomeMap.ts'),
  'utf8',
);
assert(warmup.includes('warmupCityExtract'), 'Splash lädt Stadt-Extract vor der Map');
assert(warmup.includes('hydrateDisplayExtract'), 'Letzter Kartenausschnitt aus Disk');
assert(warmup.includes('setExtract'), 'Snapshot geht in Map-Store vor Map-Mount');
assert(warmup.includes('Native-only'), 'Native-only Warmup (kein WebView-CDN)');
assert(
  warmup.includes('Kein Vollextract'),
  'Splash parst nicht 10–28 MB',
);
assert(
  !warmup.includes('ensureMapLibreDiskCache'),
  'Native Warmup wartet nicht auf MapLibre-CDN',
);
assert(
  !warmup.includes('HOME_MAP_USE_NATIVE'),
  'kein WebView-Zweig mehr im Warmup',
);

const extract = readFileSync(
  join(process.cwd(), 'src/services/homeMap/cityMapExtract.ts'),
  'utf8',
);
assert(extract.includes('peekDisplayExtract'), 'Extract aus RAM');
assert(extract.includes('.map.display.json'), 'Kleiner Display-Snapshot auf Disk');

console.log('mapLibreDiskCache.smoke.test.ts OK');
