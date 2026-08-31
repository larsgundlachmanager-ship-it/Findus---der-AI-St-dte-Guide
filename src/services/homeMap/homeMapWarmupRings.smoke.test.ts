/**
 * Run: npx --yes tsx src/services/homeMap/homeMapWarmupRings.smoke.test.ts
 */

import {
  capMapPlacesForView,
  cityRestRadiusM,
  HOME_MAP_WARMUP_RINGS_M,
  placeCapForMapView,
  placeCapForRadiusM,
  skipPlaceRingsForView,
  warmupRingListM,
  warmupSettleRingsM,
} from './homeMapWarmupRings';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(HOME_MAP_WARMUP_RINGS_M[0] === 500, 'erster Ring 500 m');
assert(HOME_MAP_WARMUP_RINGS_M[1] === 2_000, 'zweiter Ring 2 km');
assert(HOME_MAP_WARMUP_RINGS_M[2] === 10_000, 'dritter Ring 10 km');
assert(placeCapForMapView(18_000, 14_000) === 180, 'Übersicht behält genug Orte');
assert(placeCapForMapView(18_000, 14_000) < placeCapForRadiusM(18_000), 'Stadt-Übersicht weniger Pins');
assert(skipPlaceRingsForView(8_000) === false, 'Gebäude-Ringe bleiben in der Übersicht');
assert(skipPlaceRingsForView(800) === false, 'Street-Zoom mit Ringen');
{
  const capped = capMapPlacesForView(
    [
      { id: 'story-far', story: 1, keepPin: false, d: 400 },
      { id: 'halt', story: 0, keepPin: true, d: 80 },
      { id: 'cafe', story: 0, keepPin: false, d: 50 },
    ],
    2,
    (p) => p.d,
  );
  assert(capped.some((p) => p.id === 'halt'), 'ÖPNV-Halt überlebt den Pin-Cap');
  assert(capped.length === 2, 'Cap bleibt 2');
}
assert(cityRestRadiusM(null) >= 12_000, 'ohne Bounds mind. 12 km');
const rings = warmupRingListM({
  latMin: 53.65,
  latMax: 53.7,
  lngMin: 9.73,
  lngMax: 9.8,
});
assert(rings[0] === 500 && rings.includes(10_000), 'Ringe + Stadt-Rest');
assert(
  warmupSettleRingsM().length === 1 && warmupSettleRingsM()[0] === 500,
  'Settled-Warmup nur 500 m',
);

console.log('homeMapWarmupRings.smoke.test.ts OK');
