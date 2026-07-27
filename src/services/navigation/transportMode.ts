/**
 * Realtime-Bewegungsmodus aus GPS-Speed (m/s) + dynamische Schwellen.
 * Getrennt von promptBuilder.TransportMode (Onboarding-Präferenz).
 */

export type MotionTransportMode =
  | 'walk'
  | 'bicycle'
  | 'transit_bus'
  | 'transit_train';

/** m/s-Grenzen (≈ 10 km/h / 30 km/h). */
export const SPEED_WALK_MAX_MS = 2.8;
export const SPEED_BIKE_MAX_MS = 8.3;

export type ModeDistanceThresholds = {
  /** Abbiege-Pulse / Waypoint-Advance. */
  waypointAdvanceM: number;
  /** Proximity / Geofence-Skalierung (Ziel-Radius-Äquivalent). */
  proximityTriggerM: number;
  /** Turn-imminent Distanz. */
  turnImminentM: number;
  /** Haltestelle als „passiert“ zählen. */
  stationPassM: number;
  /** Multiplikator auf Pack-POI-Radien im Free-Roam. */
  geofenceRadiusScale: number;
};

export const THRESHOLDS_BY_MODE: Record<
  MotionTransportMode,
  ModeDistanceThresholds
> = {
  walk: {
    waypointAdvanceM: 12,
    proximityTriggerM: 18,
    turnImminentM: 20,
    stationPassM: 30,
    geofenceRadiusScale: 1,
  },
  bicycle: {
    waypointAdvanceM: 35,
    proximityTriggerM: 45,
    turnImminentM: 40,
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
const MODE_HOLD_MS = 4000;

export function resetMotionTransportState(): void {
  speedEmaMs = null;
  stickyMode = 'walk';
  stickySinceMs = 0;
}

export function pushSpeedSample(speedMs: number | null | undefined): number {
  if (typeof speedMs !== 'number' || !Number.isFinite(speedMs) || speedMs < 0) {
    return speedEmaMs ?? 0;
  }
  // GPS liefert oft 0 im Stand / negative → clamp
  const s = Math.max(0, speedMs);
  speedEmaMs =
    speedEmaMs == null ? s : speedEmaMs * (1 - SPEED_EMA_ALPHA) + s * SPEED_EMA_ALPHA;
  return speedEmaMs;
}

export function getSmoothedSpeedMs(): number {
  return speedEmaMs ?? 0;
}

function rawModeFromSpeed(speedMs: number): MotionTransportMode {
  if (speedMs > SPEED_BIKE_MAX_MS) return 'transit_bus';
  if (speedMs >= SPEED_WALK_MAX_MS) return 'bicycle';
  return 'walk';
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
  const now = opts?.nowMs ?? Date.now();
  const speed =
    typeof opts?.speedMs === 'number' && Number.isFinite(opts.speedMs)
      ? pushSpeedSample(opts.speedMs)
      : getSmoothedSpeedMs();

  let next = rawModeFromSpeed(speed);

  // Profil-Hinweis: bei mittlerer Speed eher Bike; bei hoher eher Transit
  if (opts?.preferTransit && speed >= SPEED_WALK_MAX_MS) {
    next = speed > SPEED_BIKE_MAX_MS * 0.7 ? 'transit_bus' : next;
  }
  if (opts?.preferBike && next === 'walk' && speed >= 1.8) {
    next = 'bicycle';
  }

  if (next !== stickyMode) {
    if (stickySinceMs === 0) stickySinceMs = now;
    if (now - stickySinceMs >= MODE_HOLD_MS || stickyMode === 'walk') {
      stickyMode = next;
      stickySinceMs = now;
    }
  } else {
    stickySinceMs = now;
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

/**
 * Google Directions Mode — walking-first.
 * Nie driving/Autoverkehr. Bike nur bei Rad-Präferenz/erkanntem Rad;
 * Transit nur bei ÖPNV-Präferenz (nicht nur wegen hoher GPS-Speed).
 */
export function directionsModeForNav(opts?: {
  motion?: MotionTransportMode | null;
  preferTransit?: boolean;
  preferBike?: boolean;
}): 'walking' | 'bicycling' | 'transit' {
  const motion = opts?.motion ?? 'walk';
  if (opts?.preferTransit) return 'transit';
  if (opts?.preferBike || motion === 'bicycle') return 'bicycling';
  return 'walking';
}

/** Off-route Schwelle (m) je Modus — Abseits der Route → neu berechnen. */
export function offRouteThresholdM(mode: MotionTransportMode): number {
  if (mode === 'bicycle') return 90;
  if (isTransitMode(mode)) return 220;
  return 55;
}

export function formatRemainingStations(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n < 0) return '—';
  if (n === 0) return 'Ziel';
  if (n === 1) return 'Noch 1 Station';
  return `Noch ${Math.round(n)} Stationen`;
}

/** Typisches Tempo (m/s), wenn GPS-Speed fehlt oder Stand. */
const TYPICAL_SPEED_MS: Record<MotionTransportMode, number> = {
  walk: 1.35, // ≈ 4,9 km/h
  bicycle: 4.5, // ≈ 16 km/h
  transit_bus: 7.0, // ≈ 25 km/h
  transit_train: 11.0, // ≈ 40 km/h
};

/**
 * ETA in Minuten aus Distanz + GPS-Tempo (mit Modus-Floor).
 * Bei sehr niedriger Speed: typisches Tempo des aktuellen Modus.
 */
export function estimateEtaMinutes(
  distanceM: number,
  speedMs: number | null | undefined,
  mode: MotionTransportMode = 'walk',
): number | null {
  if (!Number.isFinite(distanceM) || distanceM <= 0) return null;
  const typical = TYPICAL_SPEED_MS[mode] ?? TYPICAL_SPEED_MS.walk;
  const raw =
    typeof speedMs === 'number' && Number.isFinite(speedMs) ? speedMs : 0;
  // Unter ~0,7 m/s: Stand/GPS-Rauschen → typisches Tempo
  const pace = raw >= 0.7 ? raw : typical;
  const minutes = distanceM / pace / 60;
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return Math.max(1, Math.round(minutes));
}

export function formatEtaMinutes(mins: number | null | undefined): string {
  if (mins == null || !Number.isFinite(mins) || mins <= 0) return '';
  if (mins < 60) return `ca. ${mins} Min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (m === 0) return `ca. ${h} Std`;
  return `ca. ${h} Std ${m} Min`;
}
