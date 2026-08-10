/**
 * Smart movement-pattern detection for landmark interest.
 * Replaces rigid “speed === 0” with deceleration, U-turn, and linger.
 */

import type { TransportMode } from './navigation/navigationTypes';
import { isTransitMode } from './navigation/transportMode';
import { distanceMeters } from './navigation/bearing';
import { APPROACH_MEMORY_MS } from './navigation/modulePriorityPolicy';

/** Generous interest geofence around the POI (m). */
export const INTEREST_ZONE_M = 28;
/** Linger inside zone before counting as interest (ms). */
export const INTEREST_LINGER_MS = 4_000;
/** Wegweiser → skip destination teaser if heard within this window. */
export const WEGWEISER_DEDUP_MS = APPROACH_MEMORY_MS;

const BIKE_TRAVEL_MS = 12 / 3.6; // ~3.3 m/s
const BIKE_SLOW_MS = 4 / 3.6; // ~1.1 m/s
const WALK_AVG_MS = 1.25;
const WALK_SLOW_MS = 0.55;

export type InterestReason =
  | 'linger'
  | 'deceleration'
  | 'uturn'
  | 'pace_drop'
  | 'orientation_pause';

export type InterestTickResult = InterestReason | 'abandoned' | null;

export type PendingInterestWatch = {
  poiId: number;
  name: string;
  lat: number;
  lng: number;
  /** Interest zone radius (typically 20–30 m). */
  zoneM: number;
  startedAtMs: number;
  /** Peak speed observed since watch started. */
  peakSpeedMs: number;
  /** Continuous time inside zone. */
  inZoneSinceMs: number | null;
  /** Closest approach so far. */
  minDistM: number;
  /** User got close then moved away (U-turn candidate). */
  passedClose: boolean;
  /** After pass, left the zone. */
  leftAfterPass: boolean;
  /** Samples of recent speeds (m/s). */
  recentSpeeds: number[];
  transportHint: TransportMode;
};

let watch: PendingInterestWatch | null = null;

/** spot_key → when approach/Wegweiser teaser was spoken. */
const approachSpokenAtMs = new Map<string, number>();
/** parent_poi_id → sibling approaches soft-locked until */
const siblingApproachLockUntilMs = new Map<number, number>();

export function noteApproachSpoken(spotKey: string | null | undefined): void {
  if (!spotKey) return;
  approachSpokenAtMs.set(spotKey, Date.now());
}

/** Soft-lock aller Wegweiser desselben Ortes (~10 Min). */
export function softLockSiblingApproaches(
  parentPoiId: number | null | undefined,
  withinMs = WEGWEISER_DEDUP_MS,
): void {
  if (parentPoiId == null || parentPoiId < 0) return;
  siblingApproachLockUntilMs.set(parentPoiId, Date.now() + withinMs);
}

export function areSiblingApproachesSoftLocked(
  parentPoiId: number | null | undefined,
): boolean {
  if (parentPoiId == null) return false;
  const until = siblingApproachLockUntilMs.get(parentPoiId);
  if (until == null) return false;
  if (Date.now() > until) {
    siblingApproachLockUntilMs.delete(parentPoiId);
    return false;
  }
  return true;
}

export function unlockSiblingApproaches(
  parentPoiId: number | null | undefined,
): void {
  if (parentPoiId == null) return;
  siblingApproachLockUntilMs.delete(parentPoiId);
}

export function wasApproachSpokenRecently(
  spotKey: string | null | undefined,
  withinMs = WEGWEISER_DEDUP_MS,
): boolean {
  if (!spotKey) return false;
  const at = approachSpokenAtMs.get(spotKey);
  if (at == null) return false;
  return Date.now() - at <= withinMs;
}

export function clearApproachSpokenMemory(): void {
  approachSpokenAtMs.clear();
  siblingApproachLockUntilMs.clear();
}

export function getPendingInterestWatch(): PendingInterestWatch | null {
  return watch;
}

export function clearInterestWatch(): void {
  watch = null;
}

export function startInterestWatch(opts: {
  poiId: number;
  name: string;
  lat: number;
  lng: number;
  zoneM?: number;
  transportHint?: TransportMode;
}): void {
  watch = {
    poiId: opts.poiId,
    name: opts.name,
    lat: opts.lat,
    lng: opts.lng,
    zoneM: opts.zoneM ?? INTEREST_ZONE_M,
    startedAtMs: Date.now(),
    peakSpeedMs: 0,
    inZoneSinceMs: null,
    minDistM: Number.POSITIVE_INFINITY,
    passedClose: false,
    leftAfterPass: false,
    recentSpeeds: [],
    transportHint: opts.transportHint ?? 'walk',
  };
}

function pushSpeed(w: PendingInterestWatch, speedMs: number): void {
  w.recentSpeeds.push(speedMs);
  if (w.recentSpeeds.length > 12) w.recentSpeeds.shift();
  if (speedMs > w.peakSpeedMs) w.peakSpeedMs = speedMs;
}

function avgSpeed(w: PendingInterestWatch): number {
  if (!w.recentSpeeds.length) return 0;
  return w.recentSpeeds.reduce((a, b) => a + b, 0) / w.recentSpeeds.length;
}

function isBikeLike(mode: TransportMode, peak: number): boolean {
  return mode === 'bicycle' || peak >= BIKE_TRAVEL_MS * 0.85;
}

/**
 * Feed a GPS sample. Returns interest reason when pattern fires, else null.
 * Returns 'left' sentinel via clear when user leaves without interest for too long.
 */
export function tickInterestWatch(opts: {
  lat: number;
  lng: number;
  speedMs?: number | null;
  headingDeg?: number | null;
  transportMode?: TransportMode | null;
  nowMs?: number;
}): InterestTickResult {
  if (!watch) return null;
  const now = opts.nowMs ?? Date.now();
  const speed =
    typeof opts.speedMs === 'number' && Number.isFinite(opts.speedMs)
      ? Math.max(0, opts.speedMs)
      : 0;
  const mode = opts.transportMode ?? watch.transportHint;

  // On transit vehicle — don't treat as landmark interest
  if (isTransitMode(mode) && speed >= 3.5) {
    watch.inZoneSinceMs = null;
    return null;
  }

  pushSpeed(watch, speed);
  if (mode) watch.transportHint = mode;

  const dist = distanceMeters(opts.lat, opts.lng, watch.lat, watch.lng);
  if (dist < watch.minDistM) watch.minDistM = dist;

  const inZone = dist <= watch.zoneM;

  // Track pass → leave → return (U-turn)
  if (dist <= Math.min(16, watch.zoneM * 0.65)) {
    watch.passedClose = true;
  }
  if (watch.passedClose && !inZone) {
    watch.leftAfterPass = true;
  }

  if (inZone) {
    if (watch.inZoneSinceMs == null) watch.inZoneSinceMs = now;
  } else {
    watch.inZoneSinceMs = null;
    // Abandoned watch if far away for a while
    if (dist > watch.zoneM * 3 && now - watch.startedAtMs > 45_000) {
      clearInterestWatch();
      return 'abandoned';
    }
    return null;
  }

  const lingerMs =
    watch.inZoneSinceMs != null ? now - watch.inZoneSinceMs : 0;
  const bike = isBikeLike(mode, watch.peakSpeedMs);

  // 1) Linger ≥ 4 s inside zone (GPS drift ok)
  if (lingerMs >= INTEREST_LINGER_MS) {
    const reason: InterestReason = 'linger';
    clearInterestWatch();
    return reason;
  }

  // 2) Bike/scooter deceleration: travel pace → crawl
  if (
    bike &&
    watch.peakSpeedMs >= BIKE_TRAVEL_MS &&
    speed <= BIKE_SLOW_MS &&
    lingerMs >= 1_200
  ) {
    clearInterestWatch();
    return 'deceleration';
  }

  // 3) U-turn / return after passing
  if (
    watch.passedClose &&
    watch.leftAfterPass &&
    inZone &&
    dist <= watch.zoneM * 0.85 &&
    lingerMs >= 1_000
  ) {
    clearInterestWatch();
    return 'uturn';
  }

  // 4) Walk / jog: distinct pace drop or orientation pause
  if (!bike && !isTransitMode(mode)) {
    const avg = avgSpeed(watch);
    if (
      watch.peakSpeedMs >= WALK_AVG_MS * 0.75 &&
      speed <= WALK_SLOW_MS &&
      lingerMs >= 2_000
    ) {
      clearInterestWatch();
      return 'pace_drop';
    }
    // Linear progress stopped: very low speed while previously moving
    if (
      avg < WALK_SLOW_MS &&
      watch.peakSpeedMs >= 0.8 &&
      lingerMs >= 2_500
    ) {
      clearInterestWatch();
      return 'orientation_pause';
    }
  }

  void opts.headingDeg;
  return null;
}

export function interestAckLine(placeName: string): string {
  const short = placeName.replace(/\s*[·•|]\s*Wegweiser\s*$/i, '').trim();
  const lines = [
    `Cool, dass du dir ${short} anschaust — dann geh ich tiefer rein.`,
    `Schön, dass du kurz stehenbleibst. Ich erzähl dir jetzt richtig was zu ${short}.`,
    `Jo, merke ich — ${short} hat dein Interesse. Dann die volle Geschichte.`,
  ];
  return lines[Math.floor(Math.random() * lines.length)]!;
}

/** Appended once to the first teaser hook ever. */
export const INTEREST_ONBOARDING_HINT =
  'Übrigens: Wenn du mehr darüber wissen willst, werde einfach langsamer oder bleib kurz stehen—dann erzähle ich dir automatisch die ganze Geschichte!';
