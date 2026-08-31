/**
 * Kompass für Karte + Free-Roam.
 *
 * Android: natives TYPE_ROTATION_VECTOR (wie Google Maps). iOS: trueHeading.
 * GPS-Kurs nur als Fallback wenn man wirklich geht.
 */

import { Platform } from 'react-native';
import { shortestAngleDelta } from './bearing';
import { HeadingLowPass } from './sensorFilter';
import {
  calibrationHintVisible,
  headingAccuracyIsPoor,
  lerpHeadingBias,
  magBiasFromWalkSamples,
  type MagGpsSample,
} from '../homeMap/homeMapCompass';
import {
  cityCompassIsHeld,
  COMPASS_CITY_LOCK_KEY,
  lockForCity,
  normalizeCityLockId,
  patchCityLockBias,
  upsertCityLock,
  type CityCompassLockBag,
} from '../homeMap/compassCityLock';

const STALE_MS = 45_000;
const GPS_COURSE_STALE_MS = 2_400;
const MOVE_MPS = 0.85;
const BIAS_LEARN_MPS = 1.05;
/** UI darf letzten guten Kurs länger halten als der Sensor-Stale. */
const STICKY_MS = 90_000;
const POOR_HOLD_DEG = 35;

let headingDeg: number | null = null;
let headingAtMs = 0;
let lastRawMag: number | null = null;
let gpsCourseDeg: number | null = null;
let gpsCourseAtMs = 0;
let gpsSpeedMs = 0;
let lastAccuracy: number | null = null;
let magBiasDeg = 0;
const biasSamples: MagGpsSample[] = [];
const mapHeadingFilter = new HeadingLowPass(0.16);
let lastFacingSensorAt = 0;
let poorSinceMs = 0;
let userCalibratedAtMs = 0;
let biasFrozen = false;
let activeCityId: string | null = null;
let cityLockBag: CityCompassLockBag = {};
let cityLocksHydrated = false;
let lastGpsNudgeAt = 0;

type HeadingListener = (deg: number) => void;
const listeners = new Set<HeadingListener>();

function norm(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function emit(): void {
  const d = getMapDisplayHeadingDeg();
  if (d == null) return;
  for (const cb of listeners) cb(d);
}

function osName(): string {
  return Platform.OS;
}

function nativeCompass(): {
  lockNativeMapCompass: () => void;
  unlockNativeMapCompass: () => void;
  nudgeNativeMapCompass: (courseDeg: number) => void;
  isNativeMapCompassLocked: () => boolean;
} | null {
  try {
    return require('./nativeMapCompass') as {
      lockNativeMapCompass: () => void;
      unlockNativeMapCompass: () => void;
      nudgeNativeMapCompass: (courseDeg: number) => void;
      isNativeMapCompassLocked: () => boolean;
    };
  } catch {
    return null;
  }
}

async function getStorage(): Promise<{
  getItem: (k: string) => Promise<string | null>;
  setItem: (k: string, v: string) => Promise<void>;
} | null> {
  try {
    const mod = require('@react-native-async-storage/async-storage');
    return mod?.default ?? mod;
  } catch {
    return null;
  }
}

async function hydrateCityLocks(): Promise<void> {
  if (cityLocksHydrated) return;
  cityLocksHydrated = true;
  try {
    const storage = await getStorage();
    if (!storage) return;
    const raw = await storage.getItem(COMPASS_CITY_LOCK_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as CityCompassLockBag;
    if (parsed && typeof parsed === 'object') cityLockBag = parsed;
  } catch {
    /* soft */
  }
}

async function persistCityLocks(): Promise<void> {
  try {
    const storage = await getStorage();
    if (!storage) return;
    await storage.setItem(COMPASS_CITY_LOCK_KEY, JSON.stringify(cityLockBag));
  } catch {
    /* soft */
  }
}

function learnMagBias(): void {
  if (lastRawMag == null || gpsCourseDeg == null) return;
  if (gpsSpeedMs < BIAS_LEARN_MPS) return;
  const now = Date.now();
  if (now - gpsCourseAtMs > 1400 || now - headingAtMs > 900) return;
  if (headingAccuracyIsPoor(lastAccuracy, osName())) return;
  biasSamples.push({ mag: lastRawMag, gps: gpsCourseDeg });
  if (biasSamples.length > 14) biasSamples.shift();
  const target = magBiasFromWalkSamples(biasSamples);
  if (target == null) return;
  if (biasFrozen) {
    const native = nativeCompass();
    if (native?.isNativeMapCompassLocked()) {
      if (now - lastGpsNudgeAt >= 800) {
        lastGpsNudgeAt = now;
        native.nudgeNativeMapCompass(gpsCourseDeg);
      }
      return;
    }
    magBiasDeg = lerpHeadingBias(magBiasDeg, target, 0.12);
    const city = activeCityId;
    if (city && now - lastGpsNudgeAt >= 5_000) {
      lastGpsNudgeAt = now;
      cityLockBag = patchCityLockBias(cityLockBag, city, magBiasDeg);
      void persistCityLocks();
    }
    return;
  }
  magBiasDeg = lerpHeadingBias(magBiasDeg, target, 0.28);
}

/** Expo Heading-Event → snelles, geografisch sinnvolles Azimut. */
export function headingFromExpoEvent(h: {
  magHeading: number;
  trueHeading: number;
}): number | null {
  const mag = h.magHeading;
  const tru = h.trueHeading;
  const magOk = typeof mag === 'number' && Number.isFinite(mag) && mag >= 0;
  const truOk = typeof tru === 'number' && Number.isFinite(tru) && tru >= 0;
  if (Platform.OS === 'ios') {
    if (truOk) return tru;
    if (magOk) return mag;
    return null;
  }
  if (magOk) return mag;
  if (truOk) return tru;
  return null;
}

/** Android 0–3 / iOS Grad. −1 = unbekannt (nicht nörgeln). */
export function noteHeadingAccuracy(accuracy: number): void {
  if (!Number.isFinite(accuracy)) return;
  lastAccuracy = accuracy;
  if (headingAccuracyIsPoor(accuracy, osName())) {
    if (!poorSinceMs) poorSinceMs = Date.now();
  } else {
    poorSinceMs = 0;
  }
}

export function getHeadingAccuracy(): number | null {
  return lastAccuracy;
}

/** User hat die Acht gemacht — Lock sitzt in dieser Stadt. */
export function markCompassUserCalibrated(cityId?: string | null): void {
  const id = normalizeCityLockId(cityId) ?? activeCityId;
  userCalibratedAtMs = Date.now();
  poorSinceMs = 0;
  biasFrozen = true;
  nativeCompass()?.lockNativeMapCompass();
  if (id) {
    activeCityId = id;
    cityLockBag = upsertCityLock(cityLockBag, id, userCalibratedAtMs, magBiasDeg);
    void persistCityLocks();
  }
}

export function needsCompassCalibration(): boolean {
  return calibrationHintVisible({
    accuracy: lastAccuracy,
    os: osName(),
    nowMs: Date.now(),
    poorSinceMs,
    calibratedAtMs: userCalibratedAtMs,
    cityHeld: cityCompassIsHeld(lockForCity(cityLockBag, activeCityId)),
  });
}

export function resetMapHeadingCalibration(): void {
  magBiasDeg = 0;
  biasSamples.length = 0;
  mapHeadingFilter.reset();
  biasFrozen = false;
}

/** Stadtwechsel: gespeicherte Acht laden, sonst Lock aus. */
export async function applyCompassLockForCity(
  cityId: string | null | undefined,
): Promise<void> {
  await hydrateCityLocks();
  const id = normalizeCityLockId(cityId);
  if (!id) return;
  activeCityId = id;
  const lock = lockForCity(cityLockBag, id);
  if (lock) {
    userCalibratedAtMs = lock.calibratedAtMs;
    magBiasDeg = lock.biasDeg;
    biasFrozen = true;
    poorSinceMs = 0;
    nativeCompass()?.lockNativeMapCompass();
    return;
  }
  userCalibratedAtMs = 0;
  magBiasDeg = 0;
  biasFrozen = false;
  nativeCompass()?.unlockNativeMapCompass();
}

/** Nach abgebrochener Acht: alten Stadt-Lock wieder an. */
export function restoreCompassLockForActiveCity(): void {
  const lock = lockForCity(cityLockBag, activeCityId);
  if (!lock) return;
  userCalibratedAtMs = lock.calibratedAtMs;
  magBiasDeg = lock.biasDeg;
  biasFrozen = true;
  nativeCompass()?.lockNativeMapCompass();
}

/** Tilt-kompensierte Blickrichtung (Rotation-Vector / Gyro-Fusion). */
export function noteFacingSensorHeading(deg: number): void {
  if (!Number.isFinite(deg)) return;
  lastFacingSensorAt = Date.now();
  headingDeg = norm(deg + magBiasDeg);
  headingAtMs = Date.now();
  emit();
}

/** Expo watchHeadingAsync — auf Android ignorieren, solange der Sensor-Heading frisch ist. */
export function noteExpoCompassHeading(deg: number): void {
  if (lastFacingSensorAt > 0 && Date.now() - lastFacingSensorAt < 800) return;
  noteLiveDeviceHeading(deg);
}

export function noteLiveDeviceHeading(
  deg: number,
  opts?: { fromSensor?: boolean },
): void {
  if (!Number.isFinite(deg) || deg < 0) return;
  const raw = norm(deg);
  lastRawMag = raw;
  const corrected = norm(raw + magBiasDeg);
  if (
    !opts?.fromSensor &&
    headingAccuracyIsPoor(lastAccuracy, osName()) &&
    headingDeg != null
  ) {
    const jump = Math.abs(shortestAngleDelta(headingDeg, corrected));
    if (jump < POOR_HOLD_DEG) {
      headingAtMs = Date.now();
      learnMagBias();
      return;
    }
  }
  headingDeg = mapHeadingFilter.push(corrected);
  headingAtMs = Date.now();
  learnMagBias();
  emit();
}

/** GPS-Kurs (Richtung der Bewegung), nicht Geräte-Kompass. */
export function noteGpsCourse(courseDeg: number, speedMs: number | null): void {
  if (!Number.isFinite(courseDeg) || courseDeg < 0) return;
  const speed =
    typeof speedMs === 'number' && Number.isFinite(speedMs) ? speedMs : 0;
  gpsCourseDeg = norm(courseDeg);
  gpsCourseAtMs = Date.now();
  gpsSpeedMs = speed;
  learnMagBias();
  emit();
}

export function getLiveDeviceHeadingDeg(): number | null {
  if (headingDeg == null) return null;
  if (Date.now() - headingAtMs > STALE_MS) return null;
  return headingDeg;
}

/** Karten-Keil: immer Magnetkompass (Handy-Ausrichtung). GPS-Kurs nur als Fallback. */
export function getMapDisplayHeadingDeg(): number | null {
  const live = getLiveDeviceHeadingDeg();
  if (live != null) return live;
  const now = Date.now();
  if (
    gpsCourseDeg != null &&
    now - gpsCourseAtMs < GPS_COURSE_STALE_MS &&
    gpsSpeedMs >= MOVE_MPS
  ) {
    return gpsCourseDeg;
  }
  return null;
}

/** Softer facing for UI — keeps last good heading briefly if sensor blips. */
let lastGoodDisplayDeg: number | null = null;
let lastGoodDisplayAt = 0;

export function getMapDisplayHeadingDegSticky(): number | null {
  const live = getMapDisplayHeadingDeg();
  if (live != null) {
    lastGoodDisplayDeg = live;
    lastGoodDisplayAt = Date.now();
    return live;
  }
  if (
    lastGoodDisplayDeg != null &&
    Date.now() - lastGoodDisplayAt < STICKY_MS
  ) {
    return lastGoodDisplayDeg;
  }
  return null;
}

export function subscribeMapHeading(cb: HeadingListener): () => void {
  listeners.add(cb);
  const now = getMapDisplayHeadingDegSticky();
  if (now != null) cb(now);
  return () => {
    listeners.delete(cb);
  };
}

export function clearLiveDeviceHeading(): void {
  headingDeg = null;
  headingAtMs = 0;
  lastRawMag = null;
  gpsCourseDeg = null;
  gpsCourseAtMs = 0;
  gpsSpeedMs = 0;
  lastAccuracy = null;
  lastGoodDisplayDeg = null;
  lastGoodDisplayAt = 0;
  lastFacingSensorAt = 0;
  poorSinceMs = 0;
  // Stadt-Locks bleiben — nur Session-Sensor leeren.
  mapHeadingFilter.reset();
}
