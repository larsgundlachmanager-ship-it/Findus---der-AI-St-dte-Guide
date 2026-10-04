/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/navigation/boardingDetector.smoke.test.ts
 */
import {
  ALIGHT_DWELL_MS,
  ALIGHT_TIME_GRACE_MS,
  BOARD_TIME_GRACE_MS,
  assessAlightReady,
  resetBoardingDetector,
  takeAlightAdvancePending,
  tickBoardingDetector,
} from './boardingDetector';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(
  !assessAlightReady({
    speedMs: 0.2,
    remainingStations: 3,
    nearStation: true,
    nearAlightDest: true,
    dwellStillMs: ALIGHT_DWELL_MS + 1000,
    transportIsTransit: true,
  }).ready,
  'mitte Fahrt: kein Ausstieg',
);

assert(
  assessAlightReady({
    speedMs: 0.2,
    remainingStations: 1,
    nearStation: false,
    nearAlightDest: true,
    dwellStillMs: ALIGHT_DWELL_MS + 500,
    transportIsTransit: true,
  }).reason === 'dwell_near_alight',
  'Stillstand am Ausstieg → dwell',
);

assert(
  !assessAlightReady({
    speedMs: 0.2,
    remainingStations: 1,
    nearStation: true,
    nearAlightDest: true,
    dwellStillMs: 1_000,
    transportIsTransit: true,
  }).ready,
  'zu kurzer Stillstand → noch nicht',
);

assert(
  assessAlightReady({
    speedMs: 1.5,
    remainingStations: 1,
    nearStation: true,
    nearAlightDest: false,
    dwellStillMs: 0,
    transportIsTransit: true,
  }).reason === 'walk_near_last',
  'zu Fuß am letzten Halt',
);

resetBoardingDetector();
const t0 = Date.parse('2026-09-13T16:00:00+02:00');
// Einsteigen
let phase = tickBoardingDetector({
  lat: 48.76,
  lng: 8.93,
  transportMode: 'transit_train',
  speedMs: 8,
  stations: [{ lat: 48.76, lng: 8.93, name: 'Start' }],
  remainingStations: 4,
  hasTransitLegs: true,
  alightLat: 48.77,
  alightLng: 8.94,
  nowMs: t0,
});
assert(phase === 'in_transit', `boarded → in_transit (war ${phase})`);

// Dünne Kette: nur Zielpunkt, Stillstand am Alight
phase = tickBoardingDetector({
  lat: 48.7701,
  lng: 8.9401,
  transportMode: 'transit_train',
  speedMs: 0.3,
  stations: [],
  remainingStations: 1,
  hasTransitLegs: true,
  alightLat: 48.77,
  alightLng: 8.94,
  nowMs: t0 + 1_000,
});
assert(phase === 'in_transit', '1s Stillstand noch in_transit');

phase = tickBoardingDetector({
  lat: 48.7701,
  lng: 8.9401,
  transportMode: 'transit_train',
  speedMs: 0.3,
  stations: [],
  remainingStations: 1,
  hasTransitLegs: true,
  alightLat: 48.77,
  alightLng: 8.94,
  nowMs: t0 + 1_000 + ALIGHT_DWELL_MS + 200,
});
assert(phase === 'post_transit_walk', `nach Dwell → Fuß (war ${phase})`);
assert(takeAlightAdvancePending() === true, 'Advance pending');
assert(takeAlightAdvancePending() === false, 'Advance nur 1×');


// --- GPS schlecht: Zeit-Fallback ---
assert(
  assessAlightReady({
    speedMs: 8,
    remainingStations: 1,
    nearStation: false,
    nearAlightDest: false,
    dwellStillMs: 0,
    transportIsTransit: true,
    gpsUnreliable: true,
    scheduledAlightMs: t0,
    nowMs: t0 + ALIGHT_TIME_GRACE_MS + 1_000,
  }).reason === 'schedule_time',
  'schlechtes GPS + Ankunftszeit → Ausstieg',
);

resetBoardingDetector();
phase = tickBoardingDetector({
  lat: 48.70,
  lng: 8.90,
  transportMode: 'walk',
  speedMs: 0.2,
  stations: [{ lat: 48.76, lng: 8.93, name: 'Start' }],
  remainingStations: 4,
  hasTransitLegs: true,
  gpsAccuracyM: 120,
  gpsAtMs: t0,
  scheduledBoardMs: t0,
  nowMs: t0 + BOARD_TIME_GRACE_MS + 2_000,
});
assert(phase === 'in_transit', `Board per Zeit bei schlechtem GPS (war ${phase})`);

console.log('boardingDetector.smoke.test.ts OK');
