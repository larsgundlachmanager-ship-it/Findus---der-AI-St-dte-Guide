/**
 * Run: npx --yes tsx src/runtime/gpsCadence.smoke.test.ts
 */

import {
  GPS_CADENCE,
  gpsIntervalMsForSpeedKmh,
  gpsIntervalMsForSpeedMs,
  resolveEffectiveSpeedMs,
} from './gpsCadence';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(gpsIntervalMsForSpeedKmh(0) === GPS_CADENCE.stillMs, '0 km/h → 15 s');
assert(gpsIntervalMsForSpeedKmh(0.9) === GPS_CADENCE.stillMs, '<1 km/h → 15 s');
assert(gpsIntervalMsForSpeedKmh(1) === GPS_CADENCE.crawlMs, '1 km/h → 8 s');
assert(gpsIntervalMsForSpeedKmh(3) === GPS_CADENCE.crawlMs, '3 km/h → 8 s');
assert(gpsIntervalMsForSpeedKmh(8) === GPS_CADENCE.walkMs, '8 km/h → 4 s');
assert(gpsIntervalMsForSpeedKmh(12) === GPS_CADENCE.briskMs, '12 km/h → 2 s');
assert(gpsIntervalMsForSpeedKmh(13) === GPS_CADENCE.fastMs, '13 km/h → 0.5 s');
assert(gpsIntervalMsForSpeedKmh(36) === GPS_CADENCE.fastMs, 'schnell → 0.5 s');
assert(gpsIntervalMsForSpeedMs(2.78) === GPS_CADENCE.briskMs, '10 km/h → 2 s');
assert(gpsIntervalMsForSpeedMs(null) === GPS_CADENCE.briskMs, 'kein Speed → nicht still');
assert(
  resolveEffectiveSpeedMs(0, 4.0, 0) !== null &&
    (resolveEffectiveSpeedMs(0, 4.0, 0) as number) >= 0.45,
  'GPS 0 + Track fährt → nicht still',
);
assert(
  gpsIntervalMsForSpeedMs(resolveEffectiveSpeedMs(0, 4.0, null)) ===
    GPS_CADENCE.fastMs,
  'Track ~14 km/h → fast 0.5s',
);

console.log('gpsCadence.smoke.test.ts OK');
