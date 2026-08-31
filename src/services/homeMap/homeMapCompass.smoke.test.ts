/**
 * Run: npx --yes tsx src/services/homeMap/homeMapCompass.smoke.test.ts
 */

import {
  calibrationHintVisible,
  headingAccuracyIsPoor,
  magBiasFromWalkSamples,
  mapIsOffNorth,
  nextCompassTap,
  nextHudLockTap,
  facingHeadingFromAccelMag,
  headingFromDeviceMotionRotation,
  fuseGyroMagHeading,
  yawRateAroundUpDegPerSec,
  rotationMatrixFacingHeadingDeg,
} from './homeMapCompass';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const t0 = 1_000_000;
const pulse = nextHudLockTap({ locked: false, lastTapAt: 0 }, t0);
assert(pulse.action === 'pulse' && !pulse.locked, '1. Tipp: einmalig');
const lock = nextHudLockTap(pulse, t0 + 2_000);
assert(lock.action === 'lock' && lock.locked, '2. Tipp in 5 s: Follow an');
const tooLate = nextHudLockTap(pulse, t0 + 6_000);
assert(tooLate.action === 'pulse' && !tooLate.locked, 'nach 5 s wieder einmalig');
const unlock = nextHudLockTap(lock, t0 + 3_000);
assert(unlock.action === 'unlock' && !unlock.locked, 'Tipp bei Follow: aus');
const relock = nextHudLockTap(unlock, t0 + 4_000);
assert(relock.action === 'lock' && relock.locked, 'nach Aus in 5 s wieder Follow');

const idle = { follow: false, armedForFollow: false, mapOffNorth: false, lastTapAt: 0 };
const first = nextCompassTap(idle, t0);
assert(first.action === 'north' && !first.follow && first.armedForFollow, 'Tipp: Norden oben');
const second = nextCompassTap(
  { follow: first.follow, armedForFollow: first.armedForFollow, mapOffNorth: false, lastTapAt: first.lastTapAt },
  t0 + 1_200,
);
assert(second.action === 'follow' && second.follow, 'nochmal in 5 s: Karte folgt Blick');
const third = nextCompassTap(
  { follow: true, armedForFollow: false, mapOffNorth: true, lastTapAt: second.lastTapAt },
  t0 + 2_000,
);
assert(third.action === 'north' && !third.follow, 'Tipp bei Follow: Norden oben');

assert(mapIsOffNorth(45), '45° ist nicht Norden');
assert(!mapIsOffNorth(3), '3° gilt als Norden');
assert(!mapIsOffNorth(358), '358° gilt als Norden');

assert(headingAccuracyIsPoor(0, 'android'), 'Android 0 = unkalibriert');
assert(!headingAccuracyIsPoor(1, 'android'), 'Android 1 = Alltag, keine Acht');
assert(!headingAccuracyIsPoor(-1, 'android'), 'Android −1 = unbekannt, keine Acht');
assert(!headingAccuracyIsPoor(null, 'android'), 'null = keine Acht');
assert(!headingAccuracyIsPoor(3, 'android'), 'Android 3 = gut');
assert(headingAccuracyIsPoor(-1, 'ios'), 'iOS negativ = ungültig');
assert(!headingAccuracyIsPoor(8, 'ios'), 'iOS 8° ok');

assert(
  !calibrationHintVisible({
    accuracy: 0,
    os: 'android',
    nowMs: 10_000,
    poorSinceMs: 9_000,
    calibratedAtMs: 0,
  }),
  'Status 0 unter 8 s: Button bleibt aus',
);
assert(
  calibrationHintVisible({
    accuracy: 0,
    os: 'android',
    nowMs: 20_000,
    poorSinceMs: 1_000,
    calibratedAtMs: 0,
  }),
  'Status 0 länger als 8 s: Button an',
);
assert(
  !calibrationHintVisible({
    accuracy: 0,
    os: 'android',
    nowMs: 20_000,
    poorSinceMs: 1_000,
    calibratedAtMs: 19_000,
  }),
  'nach Acht: Button bleibt aus',
);
assert(
  !calibrationHintVisible({
    accuracy: 0,
    os: 'android',
    nowMs: 20_000,
    poorSinceMs: 1_000,
    calibratedAtMs: 0,
    cityHeld: true,
  }),
  'Stadt-Acht: Button bleibt aus, auch wenn der Sensor nörgelt',
);

const bias = magBiasFromWalkSamples(
  Array.from({ length: 10 }, () => ({ mag: 10, gps: 100 })),
);
assert(bias != null && Math.abs(bias - 90) < 2, `Bias ~90, war ${bias}`);

const noisy = magBiasFromWalkSamples([
  { mag: 0, gps: 10 },
  { mag: 0, gps: 90 },
  { mag: 0, gps: 180 },
  { mag: 0, gps: 270 },
  { mag: 0, gps: 20 },
  { mag: 0, gps: 200 },
  { mag: 0, gps: 40 },
  { mag: 0, gps: 220 },
]);
assert(noisy == null, 'unsteter GPS-Kurs wird nicht als Bias übernommen');

const near = (got: number | null, want: number, msg: string) => {
  assert(got != null, msg);
  const d = Math.abs(((got! - want + 540) % 360) - 180);
  assert(d < 8, `${msg} (got ${got}, want ${want})`);
};
near(
  facingHeadingFromAccelMag({ x: 0, y: 0, z: 1 }, { x: 0, y: 40, z: 8 }),
  0,
  'flach, Oberkante nach Norden',
);
near(
  facingHeadingFromAccelMag({ x: 0, y: 0, z: 1 }, { x: -40, y: 0, z: 8 }),
  90,
  'flach, Oberkante nach Osten',
);
near(
  facingHeadingFromAccelMag({ x: 0, y: 0, z: 1 }, { x: 0, y: -40, z: 8 }),
  180,
  'flach, Oberkante nach Süden',
);
near(
  facingHeadingFromAccelMag({ x: 0, y: 1, z: 0 }, { x: 0, y: 8, z: -40 }),
  0,
  'aufrecht, Blick nach Norden',
);
assert(
  facingHeadingFromAccelMag({ x: 0, y: 0, z: 1 }, { x: 0, y: 2, z: 0 }) == null,
  'zu schwaches Magnetfeld',
);

near(
  headingFromDeviceMotionRotation(0),
  0,
  'Rotation-Vector alpha 0 → Norden',
);
near(
  headingFromDeviceMotionRotation(-Math.PI / 2),
  90,
  'alpha = -π/2 → Osten (Azimut 90°)',
);
near(
  headingFromDeviceMotionRotation(Math.PI / 2),
  270,
  'alpha = π/2 → Westen',
);

const yawStill = yawRateAroundUpDegPerSec(
  { x: 0, y: 0, z: 0 },
  { x: 0, y: 0, z: 1 },
);
assert(yawStill != null && Math.abs(yawStill) < 0.01, 'kein Gyro → keine Yaw-Rate');

const held = fuseGyroMagHeading(10, 190, 0, 0.02);
const dHold = Math.abs(((held - 10 + 540) % 360) - 180);
assert(dHold < 2, `Mag-Flip im Stillstand ignorieren (got ${held})`);

const turned = fuseGyroMagHeading(10, 40, 80, 0.02);
assert(turned > 10 && turned < 40, 'Gyro-Drehung nimmt Mag mit');

near(
  rotationMatrixFacingHeadingDeg([1, 0, 0, 0, 1, 0, 0, 0, 1]),
  0,
  'flach, Oberkante nach Norden',
);
near(
  rotationMatrixFacingHeadingDeg([1, 0, 0, 0, 0, -1, 0, 1, 0]),
  0,
  'aufrecht in der Hand, Blick nach Norden',
);
near(
  rotationMatrixFacingHeadingDeg([0, 0, -1, -1, 0, 0, 0, 1, 0]),
  90,
  'aufrecht, Blick nach Osten',
);
assert(
  Math.abs(
    (rotationMatrixFacingHeadingDeg([1, 0, 0, 0, 1, 0, 0, 0, 1], 12) ?? 0) - 12,
  ) < 0.5,
  'Deklination (True North) wird addiert',
);

console.log('homeMapCompass.smoke.test.ts OK');
