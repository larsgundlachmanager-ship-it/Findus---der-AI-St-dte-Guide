/**
 * Run: npx --yes tsx src/services/homeMap/compassCityLock.smoke.test.ts
 */

import {
  cityCompassIsHeld,
  gpsNudgeTowardCourse,
  lockForCity,
  normalizeCityLockId,
  patchCityLockBias,
  upsertCityLock,
} from './compassCityLock';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(normalizeCityLockId(' Prisdorf ') === 'prisdorf', 'Stadt-ID klein');
assert(normalizeCityLockId('  ') == null, 'leer = keine Stadt');

let bag = upsertCityLock({}, 'prisdorf', 1_000, 0);
const lock = lockForCity(bag, 'Prisdorf');
assert(lock != null && lock.calibratedAtMs === 1_000, 'Lock pro Stadt');
assert(cityCompassIsHeld(lock), 'Acht in der Stadt gilt');
assert(!cityCompassIsHeld(lockForCity(bag, 'laboe')), 'andere Stadt ohne Acht');

bag = patchCityLockBias(bag, 'prisdorf', 12);
assert(lockForCity(bag, 'prisdorf')?.biasDeg === 12, 'GPS-Bias speichern');
assert(
  patchCityLockBias(bag, 'laboe', 5) === bag,
  'Bias ohne Acht nicht anlegen',
);

const nudged = gpsNudgeTowardCourse(10, 20, 0.32);
assert(nudged != null && nudged > 10 && nudged < 20, 'GPS schubst den Lock');
assert(gpsNudgeTowardCourse(10, 200) == null, '180° GPS nicht übernehmen');
assert(gpsNudgeTowardCourse(350, 10, 1) != null, 'Mitternacht-Wrap ok');

console.log('compassCityLock.smoke.test.ts OK');
