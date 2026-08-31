/**
 * Run: npx -p tsx@4.19.2 --yes tsx src/services/homeMap/homeMapBootMetrics.smoke.test.ts
 */

import {
  homeMapBootCoreOk,
  markHomeMapBoot,
  markHomeMapBootStart,
  peekHomeMapBootMarks,
  resetHomeMapBootMetrics,
} from './homeMapBootMetrics';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

resetHomeMapBootMetrics();
const t0 = 1_000_000;
markHomeMapBootStart(t0);
markHomeMapBoot('displayHydrate', t0 + 400);
markHomeMapBoot('mapReady', t0 + 900);
markHomeMapBoot('roads', t0 + 1_200);
markHomeMapBoot('places', t0 + 1_500);
markHomeMapBoot('buildings', t0 + 1_800);

const m = peekHomeMapBootMarks();
assert(m.roads === 1_200, `roads mark ${m.roads}`);
assert(m.places === 1_500, `places mark ${m.places}`);
assert(homeMapBootCoreOk(5_000), 'Kern unter 5 s');
assert(!homeMapBootCoreOk(1_000), '1 s Budget zu eng');

// Idempotent — zweiter Mark ändert nichts
markHomeMapBoot('roads', t0 + 9_000);
assert(peekHomeMapBootMarks().roads === 1_200, 'roads mark sticky');

console.log('homeMapBootMetrics.smoke.test.ts OK');
