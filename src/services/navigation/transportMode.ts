/**
 * Realtime-Bewegungsmodus aus GPS-Speed (m/s) + Schrittfrequenz.
 * Getrennt von promptBuilder.TransportMode (Onboarding-Präferenz).
 *
 * Cut (User-Feedback):
 * - Gehen: typisch ~5 km/h, hart max ~10 km/h
 * - Jogging: hohe Schrittfrequenz + Tempo bis ~15 km/h
 * - Rad: darüber / schnell mit wenig Schritten
 * - ÖPNV: sehr schnell + kaum Schritte
 */

import {
  ensureMotionCadenceWatching,
  getRecentStepsPerMin,
  resetMotionCadence,
} from './motionCadence';

export type MotionTransportMode =
  | 'walk'
  | 'jog'
  | 'bicycle'
  | 'transit_bus'
  | 'transit_train';

/** ≈ 10 km/h — harte Fuß-Obergrenze (darüber Rad oder Jog). */
export const SPEED_WALK_MAX_MS = 2.78;
/** ≈ 15 km/h — darüber kaum noch Jog ohne Fahrzeug. */
export const SPEED_JOG_MAX_MS = 4.2;
/** ≈ 22 km/h — typisch ÖPNV / schnelles Rad; mit Steps weiter differenzieren. */
export const SPEED_BIKE_MAX_MS = 6.1;

/** Schritte/min: Jog vs. Gehen / Rad. */
export const JOG_MIN_STEPS_PER_MIN = 135;
/** Unter dieser spm bei Tempo ≥ Fuß-Max → eher Rad/ÖPNV. */
export const LOW_STEP_SPM = 35;

export type ModeDistanceThresholds = {
  waypointAdvanceM: number;
  proximityTriggerM: number;
  turnImminentM: number;
  stationPassM: number;
  geofenceRadiusScale: number;
};

export const THRESHOLDS_BY_MODE: Record<
  MotionTransportMode,
  ModeDistanceThresholds
> = {
  walk: {
    waypointAdvanceM: 12,
    proximityTriggerM: 18,
    turnImminentM: 25,
    stationPassM: 30,
    geofenceRadiusScale: 1,
  },
  jog: {
    waypointAdvanceM: 18,
    proximityTriggerM: 28,
    turnImminentM: 40,
    stationPassM: 35,
    geofenceRadiusScale: 1.35,
  },
  bicycle: {
    waypointAdvanceM: 35,
    proximityTriggerM: 45,
    turnImminentM: 75,
    stationPassM: 40,
    geofenceRadiusScale: 2.4,
  },
  transit_bus: {
    waypointAdvanceM: 175,
    proximityTriggerM: 150,
    turnImminentM: 160,
    stationPassM: 30,
    geofenceRadiusScale: 6,
  },
  transit_train: {
    waypointAdvanceM: 200,
    proximityTriggerM: 180,
    turnImminentM: 180,
    stationPassM: 40,
    geofenceRadiusScale: 7,
  },
};

/** EMA über Speed, damit Modus nicht bei jedem Spike springt. */
let speedEmaMs: number | null = null;
let stickyMode: MotionTransportMode = 'walk';
let stickySinceMs = 0;

const SPEED_EMA_ALPHA = 0.35;
const MODE_HOLD_MS = 4500;
/** Fuß→Rad nach ~4 s Tempo ≥ ~10 km/h. */
const WALK_TO_BIKE_HOLD_MS = 4_000;

export function resetMotionTransportState(): void {
  speedEmaMs = null;
  stickyMode = 'walk';
  stickySinceMs = 0;
  resetMotionCadence();
}

export function pushSpeedSample(speedMs: number | null | undefined): number {
  if (typeof speedMs !== 'number' || !Number.isFinite(speedMs) || speedMs < 0) {
    return speedEmaMs ?? 0;
  }
  const s = Math.max(0, speedMs);
  speedEmaMs =
    speedEmaMs == null ? s : speedEmaMs * (1 - SPEED_EMA_ALPHA) + s * SPEED_EMA_ALPHA;
  return speedEmaMs;
}

export function getSmoothedSpeedMs(): number {
  return speedEmaMs ?? 0;
}

/**
 * Speed + optional Schrittfrequenz → Roh-Modus.
 * Ohne Steps: klarer Cut bei 9 km/h (Fuß) / ~22 km/h (ÖPNV).
 */
export function rawModeFromSpeedAndCadence(
  speedMs: number,
  stepsPerMin: number | null,
): MotionTransportMode {
  const spm = stepsPerMin;
  const hasSpm = typeof spm === 'number' && Number.isFinite(spm);

  // Sehr schnell + kaum Schritte → ÖPNV
  if (speedMs >= SPEED_BIKE_MAX_MS) {
    if (hasSpm && spm! >= JOG_MIN_STEPS_PER_MIN && speedMs < SPEED_JOG_MAX_MS + 0.5) {
      return 'jog';
    }
    if (hasSpm && spm! < LOW_STEP_SPM) return 'transit_bus';
    if (speedMs >= 8.3) return 'transit_bus'; // ~30 km/h
    return 'bicycle';
  }

  // Über Fuß-Max: Jog wenn hohe Frequenz, sonst Rad
  if (speedMs >= SPEED_WALK_MAX_MS) {
    if (hasSpm && spm! >= JOG_MIN_STEPS_PER_MIN && speedMs <= SPEED_JOG_MAX_MS) {
      return 'jog';
    }
    if (hasSpm && spm! < LOW_STEP_SPM) return 'bicycle';
    // Unklar ohne Steps: über 10 km/h = Rad (User-Cut), nicht „schnelles Gehen“
    return 'bicycle';
  }

  // Unter 10 km/h: Jog möglich bei sehr hoher Frequenz (Intervall)
  if (
    hasSpm &&
    spm! >= JOG_MIN_STEPS_PER_MIN &&
    speedMs >= 1.8 // ~6,5 km/h
  ) {
    return 'jog';
  }

  return 'walk';
}

function rawModeFromSpeed(speedMs: number): MotionTransportMode {
  return rawModeFromSpeedAndCadence(speedMs, getRecentStepsPerMin());
}

/**
 * Klassifiziert Bewegungsmodus. Optionaler Prefer-Hint aus Profil (ÖPNV/Rad).
 */
export function classifyMotionTransportMode(opts?: {
  speedMs?: number | null;
  preferTransit?: boolean;
  preferBike?: boolean;
  nowMs?: number;
}): MotionTransportMode {
  void ensureMotionCadenceWatching();
  const now = opts?.nowMs ?? Date.now();
  const speed =
    typeof opts?.speedMs === 'number' && Number.isFinite(opts.speedMs)
      ? pushSpeedSample(opts.speedMs)
      : getSmoothedSpeedMs();

  const spm = getRecentStepsPerMin(now);
  let next = rawModeFromSpeedAndCadence(speed, spm);

  // Profil-Hinweis
  if (opts?.preferTransit && speed >= SPEED_WALK_MAX_MS) {
    if (!spm || spm < LOW_STEP_SPM) {
      next = speed > SPEED_BIKE_MAX_MS * 0.85 ? 'transit_bus' : next;
    }
  }
  if (opts?.preferBike && next === 'walk' && speed >= 1.8) {
    next = 'bicycle';
  }
  // Explizit Rad: Jog nicht überschreiben wenn hohe Frequenz
  if (opts?.preferBike && next === 'jog' && (!spm || spm < JOG_MIN_STEPS_PER_MIN)) {
    next = 'bicycle';
  }

  if (next !== stickyMode) {
    // Timer startet beim ersten abweichenden Sample (nicht vom letzten Walk-Tick)
    if (stickySinceMs === 0) stickySinceMs = now;
    // Fuß→Rad: ~4 s ≥10 km/h; darunter wieder Fuß
    let hold = MODE_HOLD_MS;
    if (
      (stickyMode === 'walk' || stickyMode === 'jog') &&
      next === 'bicycle' &&
      speed >= SPEED_WALK_MAX_MS
    ) {
      hold = WALK_TO_BIKE_HOLD_MS;
    } else if (stickyMode === 'walk' || stickyMode === 'jog') {
      hold = Math.min(MODE_HOLD_MS, 2800);
    }
    if (now - stickySinceMs >= hold) {
      stickyMode = next;
      stickySinceMs = 0;
    }
  } else {
    stickySinceMs = 0;
  }

  return stickyMode;
}

export function thresholdsForMode(
  mode: MotionTransportMode,
): ModeDistanceThresholds {
  return THRESHOLDS_BY_MODE[mode];
}

export function isTransitMode(mode: MotionTransportMode): boolean {
  return mode === 'transit_bus' || mode === 'transit_train';
}

export function isPedestrianMode(mode: MotionTransportMode): boolean {
  return mode === 'walk' || mode === 'jog';
}

/**
 * Google Directions Mode — walking-first.
 * Jog → walking. Bike nur bei Rad. Transit bei ÖPNV.
 */
export function directionsModeForNav(opts?: {
  motion?: MotionTransportMode | null;
  preferTransit?: boolean;
  preferBike?: boolean;
}): 'walking' | 'bicycling' | 'transit' {
  const motion = opts?.motion ?? 'walk';
  if (
    opts?.preferTransit ||
    motion === 'transit_bus' ||
    motion === 'transit_train'
  ) {
    return 'transit';
  }
  if (opts?.preferBike || motion === 'bicycle') return 'bicycling';
  return 'walking';
}

export function offRouteThresholdM(mode: MotionTransportMode): number {
  if (mode === 'bicycle') return 90;
  if (isTransitMode(mode)) return 220;
  if (mode === 'jog') return 65;
  return 55;
}

export function formatRemainingStations(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n < 0) return '—';
  if (n === 0) return 'Ziel';
  if (n === 1) return 'Noch 1 Station';
  return `Noch ${Math.round(n)} Stationen`;
}

export function navTransportEmoji(
  mode: MotionTransportMode | null | undefined,
): string {
  if (mode === 'jog') return '🏃';
  if (mode === 'bicycle') return '🚴';
  if (mode === 'transit_bus') return '🚌';
  if (mode === 'transit_train') return '🚆';
  return '🚶';
}

export function shortenNavDestName(
  destName: string | null | undefined,
  maxChars = 48,
): string {
  const place = (destName ?? '').replace(/\s+/g, ' ').trim() || 'Ziel';
  if (place.length <= maxChars) return place;
  const cut = place.slice(0, Math.max(8, maxChars - 1));
  const sp = cut.lastIndexOf(' ');
  const base = (sp > 10 ? cut.slice(0, sp) : cut).trim();
  return `${base}…`;
}

export function formatNavHudTitle(
  destName: string | null | undefined,
  mode: MotionTransportMode | null | undefined,
): string {
  // Volle Breite nutzen — Kürzung nur als Notbremse; Text wrappt auf 2 Zeilen.
  const place = shortenNavDestName(destName, 56);
  return `${navTransportEmoji(mode)} → ${place}`;
}

const TYPICAL_SPEED_MS: Record<MotionTransportMode, number> = {
  walk: 1.35, // ≈ 4,9 km/h
  jog: 2.5, // ≈ 9 km/h
  bicycle: 4.5, // ≈ 16 km/h
  transit_bus: 7.0, // ≈ 25 km/h
  transit_train: 11.0, // ≈ 40 km/h
};

export function estimateEtaMinutes(
  distanceM: number,
  speedMs: number | null | undefined,
  mode: MotionTransportMode = 'walk',
): number | null {
  if (!Number.isFinite(distanceM) || distanceM <= 0) return null;
  const typical = TYPICAL_SPEED_MS[mode] ?? TYPICAL_SPEED_MS.walk;
  const raw =
    typeof speedMs === 'number' && Number.isFinite(speedMs) ? speedMs : 0;
  const pace = raw >= 0.7 ? raw : typical;
  const minutes = distanceM / pace / 60;
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return Math.max(1, Math.round(minutes));
}

export function formatEtaMinutes(mins: number | null | undefined): string {
  if (mins == null || !Number.isFinite(mins) || mins <= 0) return '';
  if (mins < 60) return `circa ${mins} Minuten`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (m === 0) return `circa ${h} Stunden`;
  return `circa ${h} Stunden ${m} Minuten`;
}

/** @deprecated use rawModeFromSpeedAndCadence */
export function __testRawModeFromSpeed(speedMs: number): MotionTransportMode {
  return rawModeFromSpeed(speedMs);
}
