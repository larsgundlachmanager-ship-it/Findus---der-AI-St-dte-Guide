/**
 * Run: npx --yes tsx src/services/homeMap/homeMapTilePrefetch.smoke.test.ts
 */

import {
  clampTileZoom,
  HOME_MAP_TILE_MAX_Z,
  parentZoomsForRing,
  tilesCoveringRadius,
  tilesForWarmupRing,
} from './homeMapTilePrefetch';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(clampTileZoom(16) === HOME_MAP_TILE_MAX_Z, 'Street-Zoom nutzt max 14');
assert(clampTileZoom(-2) === 0, 'Zoom nicht negativ');

const near = tilesCoveringRadius(53.55, 9.99, 500, 14);
assert(near.length >= 1 && near.length <= 9, '500 m bei z14 = wenige Kacheln');

const far = tilesCoveringRadius(53.55, 9.99, 10_000, 14);
assert(far.length > near.length, '10 km mehr Kacheln als 500 m');

const zooms = parentZoomsForRing(10_000, 16);
assert(zooms[0] === 14, 'Detail zuerst (cap 14)');
assert(zooms.includes(10) || zooms.includes(11), 'Eltern-Zoom für weiten Ring');

const ring = tilesForWarmupRing(53.55, 9.99, 10_000, 16);
assert(ring.length > 0 && ring.length <= 80, 'Ring gedeckelt');
assert(ring.every((t) => t.z <= 14), 'keine z>14 Requests');

console.log('homeMapTilePrefetch.smoke.test.ts OK');
