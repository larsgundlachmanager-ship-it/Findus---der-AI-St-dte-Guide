/**
 * Homescreen-Kompass: Tipp-Folge + Magnet-Bias (kein RN).
 *
 * GPS- und Kompass-Button: 1. Tipp = einmalig · 2. Tipp in 5 s = Follow-Lock.
 * Beim Gehen: GPS-Kurs gleicht einen konstanten Magnet-Offset aus.
 */

export const HUD_LOCK_REARM_MS = 5000;

export type HudLockTapState = {
  locked: boolean;
  lastTapAt: number;
};

export type HudLockAction = 'pulse' | 'lock' | 'unlock';

export type HudLockTapResult = HudLockTapState & {
  action: HudLockAction;
};

/**
 * 1. Tipp → einmalig (GPS: zentrieren · Kompass: Norden oben).
 * 2. Tipp innerhalb von 5 s → Follow bleibt an.
 * Tipp bei aktivem Follow → aus (GPS: frei · Kompass: Norden oben).
 * Unlock armiert wieder 5 s für erneutes Follow.
 */
export function nextHudLockTap(
  state: HudLockTapState,
  nowMs: number,
  windowMs = HUD_LOCK_REARM_MS,
): HudLockTapResult {
  if (state.locked) {
    return { locked: false, lastTapAt: nowMs, action: 'unlock' };
  }
  if (state.lastTapAt > 0 && nowMs - state.lastTapAt < windowMs) {
    return { locked: true, lastTapAt: nowMs, action: 'lock' };
  }
  return { locked: false, lastTapAt: nowMs, action: 'pulse' };
}

export type CompassTapState = {
  follow: boolean;
  armedForFollow: boolean;
  mapOffNorth: boolean;
  lastTapAt?: number;
};

export type CompassTapResult = {
  follow: boolean;
  armedForFollow: boolean;
  lastTapAt: number;
  action: 'north' | 'follow';
};

/** Karte gilt als „Norden oben“, solange Bearing unter diesem Wert bleibt. */
export const COMPASS_NORTH_SNAP_DEG = 8;

function shortestAngleDelta(fromDeg: number, toDeg: number): number {
  let d = ((toDeg - fromDeg + 540) % 360) - 180;
  if (d <= -180) d += 360;
  return d;
}

export function mapIsOffNorth(bearingDeg: number, snapDeg = COMPASS_NORTH_SNAP_DEG): boolean {
  const b = ((bearingDeg % 360) + 360) % 360;
  return Math.min(b, 360 - b) > snapDeg;
}

/**
 * Kompass-Button: 1. Tipp Norden oben · 2. Tipp in 5 s Follow.
 * Nochmal bei Follow: Norden oben.
 */
export function nextCompassTap(
  state: CompassTapState,
  nowMs = 0,
): CompassTapResult {
  const next = nextHudLockTap(
    { locked: state.follow, lastTapAt: state.lastTapAt ?? 0 },
    nowMs,
  );
  return {
    follow: next.locked,
    armedForFollow: next.action === 'pulse',
    lastTapAt: next.lastTapAt,
    action: next.action === 'lock' ? 'follow' : 'north',
  };
}

/**
 * Expo Heading.accuracy:
 * Android 0–3 (0 unreliable, 1 low, 2 medium, 3 high). −1 = unbekannt.
 * iOS: Abweichung in Grad, negativ = ungültig.
 *
 * Nur wirklich unbrauchbar zählt — Status 1 (low) ist auf Android der Alltag
 * und kein Grund, ständig die Acht zu verlangen.
 */
export function headingAccuracyIsPoor(
  accuracy: number | null | undefined,
  os: string,
): boolean {
  if (accuracy == null || !Number.isFinite(accuracy)) return false;
  if (os === 'ios') return accuracy < 0 || accuracy > 25;
  if (accuracy < 0) return false;
  return accuracy === 0;
}

/** Nach einer Acht: Button bleibt so lange aus, außer der Sensor ist dauerhaft tot. */
export const COMPASS_CALIBRATED_HOLD_MS = 8 * 60 * 60_000;
/** Status 0 muss so lange anliegen, bevor der Button leuchtet. */
export const COMPASS_POOR_SHOW_MS = 8_000;

export function calibrationHintVisible(opts: {
  accuracy: number | null | undefined;
  os: string;
  nowMs: number;
  poorSinceMs: number;
  calibratedAtMs: number;
  cityHeld?: boolean;
}): boolean {
  if (opts.cityHeld) return false;
  if (!headingAccuracyIsPoor(opts.accuracy, opts.os)) return false;
  if (
    opts.calibratedAtMs > 0 &&
    opts.nowMs - opts.calibratedAtMs < COMPASS_CALIBRATED_HOLD_MS
  ) {
    return false;
  }
  if (opts.poorSinceMs <= 0) return false;
  return opts.nowMs - opts.poorSinceMs >= COMPASS_POOR_SHOW_MS;
}

export type MagGpsSample = { mag: number; gps: number };

export function circularMeanDeg(degs: number[]): number {
  let x = 0;
  let y = 0;
  for (const d of degs) {
    const r = (d * Math.PI) / 180;
    x += Math.cos(r);
    y += Math.sin(r);
  }
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const BIAS_MIN_SAMPLES = 8;
const BIAS_MAX_SPREAD_DEG = 24;

/**
 * Konstanter Magnet-Offset aus GPS-Kurs beim Gehen.
 * null = noch zu wenig / zu unruhig.
 */
export function magBiasFromWalkSamples(samples: MagGpsSample[]): number | null {
  if (samples.length < BIAS_MIN_SAMPLES) return null;
  const meanMag = circularMeanDeg(samples.map((s) => s.mag));
  const meanGps = circularMeanDeg(samples.map((s) => s.gps));
  const target = shortestAngleDelta(meanMag, meanGps);
  let maxSpread = 0;
  for (const s of samples) {
    const sample = shortestAngleDelta(s.mag, s.gps);
    const d = Math.abs(shortestAngleDelta(sample, target));
    if (d > maxSpread) maxSpread = d;
  }
  if (maxSpread > BIAS_MAX_SPREAD_DEG) return null;
  return target;
}

export function lerpHeadingBias(current: number, target: number, t: number): number {
  const a = Math.max(0, Math.min(1, t));
  return current + a * shortestAngleDelta(current, target);
}

type Vec3 = { x: number; y: number; z: number };

function hypot3(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

function normalize3(v: Vec3): Vec3 | null {
  const n = hypot3(v);
  if (n < 1e-6) return null;
  return { x: v.x / n, y: v.y / n, z: v.z / n };
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/**
 * Blickrichtung aus Android-Rotation-Matrix (Gerät → Welt: X Ost, Y Nord, Z Himmel).
 * Flach: Oberkante (+Y). Aufrecht: durchs Display (−Z).
 */
export function rotationMatrixFacingHeadingDeg(
  r: number[],
  declinationDeg = 0,
): number | null {
  if (!Array.isArray(r) || r.length < 9) return null;
  const zUp = r[8];
  if (!Number.isFinite(zUp)) return null;
  const upright = Math.min(1, Math.max(0, 1 - Math.abs(zUp)));
  let t = 0;
  if (upright <= 0.18) t = 0;
  else if (upright >= 0.62) t = 1;
  else {
    const u = (upright - 0.18) / (0.62 - 0.18);
    t = u * u * (3 - 2 * u);
  }
  let dx = 0;
  let dy = 1 - t;
  let dz = -t;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return null;
  dx /= len;
  dy /= len;
  dz /= len;
  const worldEast = r[0] * dx + r[1] * dy + r[2] * dz;
  const worldNorth = r[3] * dx + r[4] * dy + r[5] * dz;
  if (!Number.isFinite(worldEast) || !Number.isFinite(worldNorth)) return null;
  if (Math.abs(worldEast) < 1e-8 && Math.abs(worldNorth) < 1e-8) return null;
  let heading = (Math.atan2(worldEast, worldNorth) * 180) / Math.PI;
  heading += declinationDeg;
  return ((heading % 360) + 360) % 360;
}

/**
 * Expo DeviceMotion (Android TYPE_ROTATION_VECTOR):
 * native sends alpha = -getOrientation()[0] (Azimut in rad).
 * 0 = Oberkante zeigt nach magnetisch Norden.
 */
export function headingFromDeviceMotionRotation(
  alphaRad: number,
  orientationDeg = 0,
): number | null {
  if (!Number.isFinite(alphaRad)) return null;
  const azimuthDeg = (-alphaRad * 180) / Math.PI;
  const orient = Number.isFinite(orientationDeg) ? orientationDeg : 0;
  return ((azimuthDeg + orient) % 360 + 360) % 360;
}

/**
 * Drehrate um Welt-Oben (Accel zeigt in Ruhe nach oben). Gyro in rad/s.
 */
export function yawRateAroundUpDegPerSec(
  gyroRadPerSec: Vec3,
  accel: Vec3,
): number | null {
  const g = normalize3(accel);
  if (!g) return null;
  const yawRateRad =
    gyroRadPerSec.x * g.x + gyroRadPerSec.y * g.y + gyroRadPerSec.z * g.z;
  if (!Number.isFinite(yawRateRad)) return null;
  return (yawRateRad * 180) / Math.PI;
}

/**
 * Gyro führt (flüssig), Magnet nur langsamer Nord-Lock.
 * Große Mag-Sprünge im Stillstand werden verworfen (keine 180°-Flips).
 */
export function fuseGyroMagHeading(
  fusedDeg: number,
  magDeg: number | null,
  yawRateDegPerSec: number,
  dtSec: number,
): number {
  const dt = Math.max(0.004, Math.min(0.08, dtSec));
  let next = fusedDeg + yawRateDegPerSec * dt;
  if (magDeg != null && Number.isFinite(magDeg)) {
    const err = shortestAngleDelta(next, magDeg);
    const turning = Math.abs(yawRateDegPerSec) > 28;
    if (!(Math.abs(err) > 48 && !turning)) {
      const a = turning ? 0.01 : 0.035;
      next += a * err;
    }
  }
  return ((next % 360) + 360) % 360;
}

/**
 * Blickrichtung = wo die Handy-Oberkante (bzw. bei aufrechtem Halt die Rückseite)
 * horizontal zeigt. Tilt-kompensiert — Expo magHeading ist das nicht.
 *
 * Gerät: X rechts, Y oben, Z aus dem Display.
 */
export function facingHeadingFromAccelMag(
  acc: Vec3,
  mag: Vec3,
): number | null {
  const magLen = hypot3(mag);
  if (magLen < 12 || magLen > 140) return null;
  const g = normalize3(acc);
  if (!g) return null;
  const east = normalize3(cross3(mag, g));
  if (!east) return null;
  const north = cross3(g, east);
  const yHoriz = Math.hypot(east.y, north.y);
  const headingRad =
    yHoriz >= 0.28
      ? Math.atan2(east.y, north.y)
      : Math.atan2(-east.z, -north.z);
  if (!Number.isFinite(headingRad)) return null;
  return ((headingRad * 180) / Math.PI + 360) % 360;
}

