/**
 * Run: npx --yes tsx src/services/cityPack/cityLocalStorage.smoke.test.ts
 */

import {
  formatLocalDatasetBytes,
  parseLocalCityStorageFile,
  poisLookLikeCity,
} from './cityLocalStorage';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(parseLocalCityStorageFile('amsterdam.json')?.kind === 'pack', 'Pack');
assert(parseLocalCityStorageFile('amsterdam.json')?.id === 'amsterdam', 'Pack-Id');
assert(parseLocalCityStorageFile('amsterdam.pins.json')?.kind === 'pins', 'Pins');
assert(parseLocalCityStorageFile('amsterdam.map.json')?.kind === 'map', 'Karte');
assert(parseLocalCityStorageFile('index.cache.json') == null, 'Index nicht Stadt');
assert(parseLocalCityStorageFile('versions.json') == null, 'Sidecar nicht Stadt');
assert(parseLocalCityStorageFile('_tmp_map_1.json') == null, 'Temp ignorieren');
assert(parseLocalCityStorageFile('foo.bar.json') == null, 'keine Dots in der Id');

assert(formatLocalDatasetBytes(800) === '800 B', 'Bytes');
assert(formatLocalDatasetBytes(1536).includes('KB'), 'KB');
assert(formatLocalDatasetBytes(3_200_000).includes('MB'), 'MB');

const amsterdamish = [
  { spot_key: 'amsterdam_rijksmuseum' },
  { spot_key: 'amsterdam_anne_frank' },
  { spot_key: 'amsterdam_centraal' },
  { spot_key: 'amsterdam_nemo' },
  { spot_key: 'amsterdam_westerkerk' },
];
assert(poisLookLikeCity('amsterdam', amsterdamish), 'SQLite gehört zu Amsterdam');
assert(!poisLookLikeCity('lisboa', amsterdamish), 'nicht Lissabon');

console.log('cityLocalStorage.smoke.test.ts OK');
