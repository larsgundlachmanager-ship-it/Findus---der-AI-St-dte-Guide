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

const html = readFileSync(
  join(process.cwd(), 'src/components/homeMap/homePresenceMapHtml.ts'),
  'utf8',
);
assert(html.includes('peekMapLibreHtmlAssets'), 'HTML nutzt Disk-Cache');

const warmup = readFileSync(
  join(process.cwd(), 'src/services/homeMap/warmupHomeMap.ts'),
  'utf8',
);
assert(warmup.includes('warmupCityExtract'), 'Splash lädt Stadt-Extract vor der Map');
assert(warmup.includes('hydrateDisplayExtract'), 'Letzter Kartenausschnitt aus Disk');
assert(warmup.includes('setExtract'), 'Snapshot geht in Map-Store vor Map-Mount');
assert(warmup.includes('HOME_MAP_USE_NATIVE'), 'Native überspringt CDN-Warmup');
assert(
  warmup.includes('Kein Vollextract') || warmup.includes('Kein Vollextract'),
  'Splash parst nicht 10–28 MB',
);
assert(
  !warmup.includes('Promise.all([ensureMapLibreDiskCache(), warmupCityExtract()])'),
  'Native-Pfad wartet nicht auf MapLibre-CDN',
);

const extract = readFileSync(
  join(process.cwd(), 'src/services/homeMap/cityMapExtract.ts'),
  'utf8',
);
assert(extract.includes('peekDisplayExtract'), 'WebView bekommt Extract aus RAM');
assert(extract.includes('.map.display.json'), 'Kleiner Display-Snapshot auf Disk');

console.log('mapLibreDiskCache.smoke.test.ts OK');
