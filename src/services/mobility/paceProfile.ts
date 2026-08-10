/**
 * Adaptive Planungsgeschwindigkeit — Fuß / Rad.
 *
 * Lernt aus GPS-Segmenten (≥1 km am Stück), merkt Mittel der letzten 5,
 * glättet per EMA gegen die bisherige Basis, persistiert lokal + optional Profil.
 *
 * Defaults: Gehen 3,5 km/h · Fahrrad 13 km/h
 * Clamp: Gehen 1–12 · Rad 6–35 km/h
 */

import * as FileSystem from 'expo-file-system';
import { distanceMeters } from '../navigation/bearing';

export type PaceMode = 'walk' | 'bike';

export type PaceSegment = {
  mode: PaceMode;
  distanceM: number;
  durationMs: number;
  /** km/h */
  speedKmh: number;
  atMs: number;
};

type PaceState = {
  walkKmh: number;
  bikeKmh: number;
  segments: PaceSegment[];
  /** laufendes Segment */
  active: {
    mode: PaceMode;
    startLat: number;
    startLng: number;
    lastLat: number;
    lastLng: number;
    startMs: number;
    lastMs: number;
    distanceM: number;
  } | null;
};

const PATH = `${FileSystem.documentDirectory}findus-pace-profile.json`;
const MAX_SEGMENTS = 5;
const MIN_SEGMENT_M = 1000;
/** Neue Segment-Mittel vs. bisherige Basis */
const LEARN_EMA = 0.55;

/** Defaults */
export const DEFAULT_WALK_KMH = 3.5;
export const DEFAULT_BIKE_KMH = 13;

/** Clamp: auch sehr langsam / sehr zügig messen dürfen */
export const WALK_KMH_MIN = 1;
export const WALK_KMH_MAX = 12;
export const BIKE_KMH_MIN = 6;
export const BIKE_KMH_MAX = 35;

/** Unter dieser Speed → Pause / Segment unterbrechen */
const STOP_MS = 0.35; // ~1,3 km/h
const BIKE_ENTER_MS = 2.2; // ~8 km/h
const WALK_MAX_MS = 2.0; // ~7,2 km/h

let state: PaceState = {
  walkKmh: DEFAULT_WALK_KMH,
  bikeKmh: DEFAULT_BIKE_KMH,
  segments: [],
  active: null,
};
let hydrated = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let onPaceChanged: ((mode: PaceMode, kmh: number) => void) | null = null;

export function setPaceChangeListener(
  fn: ((mode: PaceMode, kmh: number) => void) | null,
): void {
  onPaceChanged = fn;
}

function clampKmh(mode: PaceMode, kmh: number): number {
  if (mode === 'walk') {
    return Math.min(WALK_KMH_MAX, Math.max(WALK_KMH_MIN, kmh));
  }
  return Math.min(BIKE_KMH_MAX, Math.max(BIKE_KMH_MIN, kmh));
}

function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void FileSystem.writeAsStringAsync(
      PATH,
      JSON.stringify({
        walkKmh: state.walkKmh,
        bikeKmh: state.bikeKmh,
        segments: state.segments.slice(-MAX_SEGMENTS * 2),
        updatedAtMs: Date.now(),
      }),
    ).catch(() => {});
  }, 900);
}

function seedFromUserProfile(): void {
  try {
    const { getCachedUserProfile } = require('../userProfileService') as {
      getCachedUserProfile: () => {
        mobilityPrefs?: {
          learnedWalkKmh?: number | null;
          learnedBikeKmh?: number | null;
        };
      } | null;
    };
    const mp = getCachedUserProfile()?.mobilityPrefs;
    if (
      typeof mp?.learnedWalkKmh === 'number' &&
      Number.isFinite(mp.learnedWalkKmh)
    ) {
      state.walkKmh = clampKmh('walk', mp.learnedWalkKmh);
    }
    if (
      typeof mp?.learnedBikeKmh === 'number' &&
      Number.isFinite(mp.learnedBikeKmh)
    ) {
      state.bikeKmh = clampKmh('bike', mp.learnedBikeKmh);
    }
  } catch {
    /* soft */
  }
}

export async function hydratePaceProfile(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  // Profil zuerst als Fallback, File überschreibt wenn vorhanden
  seedFromUserProfile();
  try {
    const info = await FileSystem.getInfoAsync(PATH);
    if (!info.exists) return;
    const raw = await FileSystem.readAsStringAsync(PATH);
    const data = JSON.parse(raw) as Partial<PaceState>;
    if (typeof data.walkKmh === 'number') {
      state.walkKmh = clampKmh('walk', data.walkKmh);
    }
    if (typeof data.bikeKmh === 'number') {
      state.bikeKmh = clampKmh('bike', data.bikeKmh);
    }
    if (Array.isArray(data.segments)) {
      state.segments = data.segments
        .filter(
          (s) =>
            s &&
            (s.mode === 'walk' || s.mode === 'bike') &&
            typeof s.speedKmh === 'number',
        )
        .slice(-MAX_SEGMENTS * 2);
    }
  } catch {
    /* soft */
  }
}

/** Session-Travel-Mode → Pace-Hint (wenn GPS-Speed unsicher). */
export function modeHintFromSessionTravel(): PaceMode | null {
  try {
    const { resolveActiveTravelMode } = require('../navigation/travelModeContext') as {
      resolveActiveTravelMode: () => { mode: string };
    };
    const m = resolveActiveTravelMode().mode;
    if (m === 'bike') return 'bike';
    if (m === 'foot') return 'walk';
  } catch {
    /* soft */
  }
  return null;
}

export function getPlanWalkKmh(): number {
  void hydratePaceProfile();
  return state.walkKmh;
}

export function getPlanBikeKmh(): number {
  void hydratePaceProfile();
  return state.bikeKmh;
}

export function getPlanKmh(mode: PaceMode): number {
  return mode === 'bike' ? getPlanBikeKmh() : getPlanWalkKmh();
}

/** m/min für Planung */
export function getPlanWalkMPerMin(): number {
  return (getPlanWalkKmh() * 1000) / 60;
}

export function getPlanBikeMPerMin(): number {
  return (getPlanBikeKmh() * 1000) / 60;
}

export function getPlanMPerMin(mode: PaceMode): number {
  return mode === 'bike' ? getPlanBikeMPerMin() : getPlanWalkMPerMin();
}

export function minPerKmWalk(): number {
  return 60 / getPlanWalkKmh();
}

export function minPerKmBike(): number {
  return 60 / getPlanBikeKmh();
}

/** true wenn mindestens ein gelerntes Segment vorliegt */
export function hasLearnedPace(mode?: PaceMode): boolean {
  void hydratePaceProfile();
  if (mode) return state.segments.some((s) => s.mode === mode);
  return state.segments.length > 0;
}

function averageLast5(mode: PaceMode): number | null {
  const segs = state.segments.filter((s) => s.mode === mode).slice(-MAX_SEGMENTS);
  if (!segs.length) return null;
  // Distanz-gewichtet: längere Segmente zählen mehr
  let wSum = 0;
  let vSum = 0;
  for (const s of segs) {
    const w = Math.max(1, s.distanceM / 1000);
    wSum += w;
    vSum += s.speedKmh * w;
  }
  return clampKmh(mode, vSum / wSum);
}

function finalizeActive(reason: string): void {
  const a = state.active;
  if (!a) return;
  state.active = null;
  if (a.distanceM < MIN_SEGMENT_M) return;
  const durationMs = Math.max(1, a.lastMs - a.startMs);
  const hours = durationMs / 3_600_000;
  if (hours < 0.02) return; // < ~1 Min
  const speedKmh = clampKmh(a.mode, a.distanceM / 1000 / hours);
  const seg: PaceSegment = {
    mode: a.mode,
    distanceM: a.distanceM,
    durationMs,
    speedKmh,
    atMs: a.lastMs,
  };
  state.segments = [...state.segments, seg].slice(-MAX_SEGMENTS * 4);
  const avg = averageLast5(a.mode);
  if (avg == null) return;
  const prev = a.mode === 'walk' ? state.walkKmh : state.bikeKmh;
  const blended = clampKmh(a.mode, prev * (1 - LEARN_EMA) + avg * LEARN_EMA);
  if (a.mode === 'walk') state.walkKmh = blended;
  else state.bikeKmh = blended;
  schedulePersist();
  if (Math.abs(prev - blended) >= 0.12) {
    onPaceChanged?.(a.mode, blended);
  }
  if (__DEV__) {
    console.log(
      `[pace] segment ${a.mode} ${Math.round(a.distanceM)}m @ ${speedKmh.toFixed(1)} km/h → basis ${blended.toFixed(1)} (avg5=${avg.toFixed(1)}, ${reason})`,
    );
  }
}

function inferMode(speedMs: number): PaceMode | 'stop' {
  if (speedMs < STOP_MS) return 'stop';
  if (speedMs >= BIKE_ENTER_MS) return 'bike';
  if (speedMs <= WALK_MAX_MS) return 'walk';
  const session = modeHintFromSessionTravel();
  if (session) return session;
  return speedMs >= 2.4 ? 'bike' : 'walk';
}

/**
 * GPS-Tick: baut 1-km-Segmente, updated Basisgeschwindigkeit.
 */
export function pushPaceSample(opts: {
  lat: number;
  lng: number;
  speedMs?: number | null;
  atMs?: number;
  /** hard override from transport classifier */
  modeHint?: PaceMode | null;
}): void {
  void hydratePaceProfile();
  const atMs = opts.atMs ?? Date.now();
  const speed =
    typeof opts.speedMs === 'number' && Number.isFinite(opts.speedMs)
      ? Math.max(0, opts.speedMs)
      : null;

  let mode: PaceMode | 'stop' =
    opts.modeHint ??
    (speed != null
      ? inferMode(speed)
      : state.active?.mode ?? modeHintFromSessionTravel() ?? 'stop');

  if (mode === 'stop') {
    if (state.active && state.active.distanceM >= MIN_SEGMENT_M) {
      finalizeActive('stop');
    } else if (state.active) {
      state.active = null;
    }
    return;
  }

  if (!state.active) {
    state.active = {
      mode,
      startLat: opts.lat,
      startLng: opts.lng,
      lastLat: opts.lat,
      lastLng: opts.lng,
      startMs: atMs,
      lastMs: atMs,
      distanceM: 0,
    };
    return;
  }

  if (state.active.mode !== mode) {
    finalizeActive('mode_switch');
    state.active = {
      mode,
      startLat: opts.lat,
      startLng: opts.lng,
      lastLat: opts.lat,
      lastLng: opts.lng,
      startMs: atMs,
      lastMs: atMs,
      distanceM: 0,
    };
    return;
  }

  const d = distanceMeters(
    state.active.lastLat,
    state.active.lastLng,
    opts.lat,
    opts.lng,
  );
  if (d < 1.5) {
    state.active.lastMs = atMs;
    return;
  }
  // GPS-Sprünge (>80 m in einem Tick) ignorieren
  if (d > 80) {
    state.active.lastLat = opts.lat;
    state.active.lastLng = opts.lng;
    state.active.lastMs = atMs;
    return;
  }
  state.active.distanceM += d;
  state.active.lastLat = opts.lat;
  state.active.lastLng = opts.lng;
  state.active.lastMs = atMs;

  if (state.active.distanceM >= MIN_SEGMENT_M) {
    finalizeActive('1km');
  }
}

export function formatPaceForPrompt(): string {
  void hydratePaceProfile();
  const lastWalk = state.segments
    .filter((s) => s.mode === 'walk')
    .slice(-MAX_SEGMENTS);
  const lastBike = state.segments
    .filter((s) => s.mode === 'bike')
    .slice(-MAX_SEGMENTS);
  const learned =
    lastWalk.length > 0 || lastBike.length > 0
      ? 'gelernt aus GPS-Segmenten (≥1 km)'
      : 'noch Default — lernt mit, sobald du ≥1 km am Stück unterwegs bist';
  return [
    '=== TEMPO-PROFIL (persönlich, für ETA/Routenzeit) ===',
    `Gehen: ${state.walkKmh.toFixed(1)} km/h (~${minPerKmWalk().toFixed(1)} Min/km)`,
    `Rad: ${state.bikeKmh.toFixed(1)} km/h (~${minPerKmBike().toFixed(1)} Min/km)`,
    `Status: ${learned}`,
    lastWalk.length
      ? `Letzte ${lastWalk.length} Fuß-Segmente: ${lastWalk.map((s) => s.speedKmh.toFixed(1)).join(', ')} km/h`
      : null,
    lastBike.length
      ? `Letzte ${lastBike.length} Rad-Segmente: ${lastBike.map((s) => s.speedKmh.toFixed(1)).join(', ')} km/h`
      : null,
    'Geh-/Radzeiten IMMER mit diesem Tempo rechnen — nicht pauschal „5 km/h“.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function getPaceSnapshot(): {
  walkKmh: number;
  bikeKmh: number;
  activeDistanceM: number;
  segmentsWalk: number;
  segmentsBike: number;
  learned: boolean;
} {
  return {
    walkKmh: state.walkKmh,
    bikeKmh: state.bikeKmh,
    activeDistanceM: state.active?.distanceM ?? 0,
    segmentsWalk: state.segments.filter((s) => s.mode === 'walk').length,
    segmentsBike: state.segments.filter((s) => s.mode === 'bike').length,
    learned: state.segments.length > 0,
  };
}
