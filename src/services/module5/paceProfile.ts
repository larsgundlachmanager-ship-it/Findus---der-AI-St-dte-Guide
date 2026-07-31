/**
 * Adaptive Planungsgeschwindigkeit — Fuß / Rad.
 *
 * Defaults: Gehen 3,5 km/h · Fahrrad 13 km/h
 * Clamp: Gehen 3–6 · Rad 10–25 km/h
 * Nach ≥1 km am Stück: Segment speichern, Mittel aus letzten 5 Segmenten → neue Basis.
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

/** Defaults */
export const DEFAULT_WALK_KMH = 3.5;
export const DEFAULT_BIKE_KMH = 13;

/** Clamp-Bereiche (User-Beispiele) */
export const WALK_KMH_MIN = 3;
export const WALK_KMH_MAX = 6;
export const BIKE_KMH_MIN = 10;
export const BIKE_KMH_MAX = 25;

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
      }),
    ).catch(() => {});
  }, 900);
}

export async function hydratePaceProfile(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
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

export function getPlanWalkKmh(): number {
  void hydratePaceProfile();
  return state.walkKmh;
}

export function getPlanBikeKmh(): number {
  void hydratePaceProfile();
  return state.bikeKmh;
}

/** m/min für Planung */
export function getPlanWalkMPerMin(): number {
  return (getPlanWalkKmh() * 1000) / 60;
}

export function getPlanBikeMPerMin(): number {
  return (getPlanBikeKmh() * 1000) / 60;
}

export function minPerKmWalk(): number {
  return 60 / getPlanWalkKmh();
}

export function minPerKmBike(): number {
  return 60 / getPlanBikeKmh();
}

function averageLast5(mode: PaceMode): number | null {
  const segs = state.segments.filter((s) => s.mode === mode).slice(-MAX_SEGMENTS);
  if (!segs.length) return null;
  const sum = segs.reduce((a, s) => a + s.speedKmh, 0);
  return clampKmh(mode, sum / segs.length);
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
  if (a.mode === 'walk') state.walkKmh = avg;
  else state.bikeKmh = avg;
  schedulePersist();
  if (Math.abs(prev - avg) >= 0.15) {
    onPaceChanged?.(a.mode, avg);
  }
  if (__DEV__) {
    console.log(
      `[pace] segment ${a.mode} ${Math.round(a.distanceM)}m @ ${speedKmh.toFixed(1)} km/h → avg5=${avg.toFixed(1)} (${reason})`,
    );
  }
}

function inferMode(speedMs: number): PaceMode | 'stop' {
  if (speedMs < STOP_MS) return 'stop';
  if (speedMs >= BIKE_ENTER_MS) return 'bike';
  if (speedMs <= WALK_MAX_MS) return 'walk';
  // Zwischen Walk-Max und Bike-Enter: eher Walk wenn sticky walk, sonst bike
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
    (speed != null ? inferMode(speed) : state.active?.mode ?? 'stop');

  if (mode === 'stop') {
    if (state.active && state.active.distanceM >= MIN_SEGMENT_M) {
      finalizeActive('stop');
    } else if (state.active) {
      // kurze Pause: Segment abbrechen ohne Commit unter 1 km
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

  // Moduswechsel → Segment schließen
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
  const lastWalk = state.segments.filter((s) => s.mode === 'walk').slice(-MAX_SEGMENTS);
  const lastBike = state.segments.filter((s) => s.mode === 'bike').slice(-MAX_SEGMENTS);
  return [
    '=== TEMPO-PROFIL (Modul 5) ===',
    `Gehen Basis: ${state.walkKmh.toFixed(1)} km/h (~${minPerKmWalk().toFixed(1)} Min/km) — Default 3,5 · Clamp 3–6`,
    `Rad Basis: ${state.bikeKmh.toFixed(1)} km/h (~${minPerKmBike().toFixed(1)} Min/km) — Default 13 · Clamp 10–25`,
    lastWalk.length
      ? `Letzte ${lastWalk.length} Fuß-Segmente: ${lastWalk.map((s) => s.speedKmh.toFixed(1)).join(', ')} km/h`
      : 'Noch kein Fuß-1-km-Segment',
    lastBike.length
      ? `Letzte ${lastBike.length} Rad-Segmente: ${lastBike.map((s) => s.speedKmh.toFixed(1)).join(', ')} km/h`
      : 'Noch kein Rad-1-km-Segment',
  ].join('\n');
}

export function getPaceSnapshot(): {
  walkKmh: number;
  bikeKmh: number;
  activeDistanceM: number;
  segmentsWalk: number;
  segmentsBike: number;
} {
  return {
    walkKmh: state.walkKmh,
    bikeKmh: state.bikeKmh,
    activeDistanceM: state.active?.distanceM ?? 0,
    segmentsWalk: state.segments.filter((s) => s.mode === 'walk').length,
    segmentsBike: state.segments.filter((s) => s.mode === 'bike').length,
  };
}
