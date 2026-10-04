from pathlib import Path

smoke = r'''/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/runtime/gpsCadence.smoke.test.ts
 */

import {
  GPS_CADENCE,
  gpsIntervalMsForSpeedKmh,
  gpsIntervalMsForSpeedMs,
  gpsIntervalMsWhileNavigating,
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
assert(
  resolveEffectiveSpeedMs(0, 0, 0, 5) !== null &&
    (resolveEffectiveSpeedMs(0, 0, 0, 5) as number) >= 0.45,
  'GPS 0 + Displacement fährt → nicht still',
);
{
  const { speedMsFromDisplacement } = require('./gpsCadence') as typeof import('./gpsCadence');
  const ms = speedMsFromDisplacement(53.55, 9.93, 53.56, 9.93, 2000);
  assert(ms != null && ms > 4, 'Displacement ~111 m / 2 s → Zugtempo');
  assert(speedMsFromDisplacement(53.55, 9.93, 53.55, 9.93, 2000) == null, 'kein Move → null');
}

// Nav: Stillstand nicht 15 s; Rad nicht dauerhaft 0,5 s
assert(gpsIntervalMsWhileNavigating(0) === GPS_CADENCE.walkMs, 'nav still → 4 s');
assert(gpsIntervalMsWhileNavigating(1.1) === GPS_CADENCE.walkMs, 'nav walk ~4 km/h → 4 s');
assert(
  gpsIntervalMsWhileNavigating(2.78) === GPS_CADENCE.briskMs,
  'nav ~10 km/h walk → 2 s floor',
);
assert(
  gpsIntervalMsWhileNavigating(5.5, { preferBike: true }) === 1_000,
  'nav bike fast → 1 s floor (not 0.5)',
);
assert(
  gpsIntervalMsWhileNavigating(2.78, { preferBike: true }) === GPS_CADENCE.briskMs,
  'nav bike ~10 km/h → 2 s cadence',
);

console.log('gpsCadence.smoke.test.ts OK');
'''

p = Path(r"C:\Users\larsf\Findus 2.0\src\runtime\gpsCadence.smoke.test.ts")
tmp = p.with_suffix(".ts.new")
tmp.write_text(smoke, encoding="utf-8", newline="\n")
tmp.replace(p)

# Strengthen nativeHomeMap smoke if present
nav_smoke_path = Path(r"C:\Users\larsf\Findus 2.0\src\components\homeMap\nativeHomeMap.smoke.test.ts")
ns = nav_smoke_path.read_text(encoding="utf-8")
if "gpsIntervalMsWhileNavigating" not in ns and "no duplicate watch" in ns:
    ns = ns.replace(
        "nav.includes('no duplicate watch'),",
        "nav.includes('no duplicate watch') &&\n      nav.includes('gpsIntervalMsWhileNavigating') &&\n      nav.includes('startWatchingLocation'),",
        1,
    )
    tmp2 = nav_smoke_path.with_suffix(".ts.new")
    tmp2.write_text(ns, encoding="utf-8", newline="\n")
    tmp2.replace(nav_smoke_path)
    print("nativeHomeMap smoke updated")
else:
    print("nativeHomeMap smoke skip")

print("smoke written")
