/**
 * Fog: eine Erkundungsfläche, die nur wächst.
 *
 * Früher lag ein Tip-Blob über der Fläche, schnitt das letzte Polygon ab
 * oder stapelte sich darüber — Spur weg, nur der aktuelle Umriss, doppeltes
 * Eis-Cyan, und das Raster blockierte Mic/Karte.
 *
 * Jetzt:
 * - Publish ersetzt die Fläche atomar durch die Vereinigung des ganzen Tracks.
 * - Nichts wird abgeschnitten, nichts wird obendrauf gelegt.
 * - Rebuild nur mapIdle, höchstens alle paar Sekunden, nie auf dem GPS-Tick.
 * - Mic / Voice / Geste / Nav / Transit: Timer aus, letzte Fläche bleibt.
 */

import {
  buildExploredPolygons,
  fogTrackCacheKey,
  FOG_MERGE_GAP_M,
  type FogPolygon,
  type FogRing,
} from '../discovery/fogCoverage';
import {
  FOG_SEGMENT_BREAK_MS,
  WALK_REVEAL_RADIUS_M,
  type WalkTrackPoint,
} from '../discovery/walkTrackService';
import { useFogStore } from '../../store/useFogStore';
import { isMapUserGesturing } from './mapGestureLane';
import {
  chromeHoldsLoad,
  isMicActive,
  isVoiceLaneBusy,
  runMapIdleWhenFree,
} from '../boot/interactiveBootGate';
import {
  homeMapFogExploreIdleFrozen,
  homeMapLocationFollowActive,
  homeMapShouldPause,
} from '../ui/homeMapPause';

function navFogActive(): boolean {
  try {
    const { useFinnusStore } = require('../../store/useFinnusStore') as {
      useFinnusStore: {
        getState: () => { navActive?: boolean; navRouteLoading?: boolean };
      };
    };
    const s = useFinnusStore.getState();
    return s.navRouteLoading === true;
  } catch {
    return false;
  }
}

/** Nach Nav: eine Fläche nachziehen, sobald Mic/Thinking frei sind. */
let navFogWatchReady = false;
function ensureNavFogCatchupWatch(): void {
  if (navFogWatchReady) return;
  navFogWatchReady = true;
  try {
    const { useFinnusStore } = require('../../store/useFinnusStore') as {
      useFinnusStore: {
        getState: () => { navActive?: boolean };
        subscribe: (fn: (s: { navActive?: boolean }) => void) => () => void;
      };
    };
    let prev = useFinnusStore.getState().navActive === true;
    useFinnusStore.subscribe((s) => {
      const now = s.navActive === true;
      if (prev && !now) {
        const track = useFogStore.getState().walkTrack;
        useFogStore.getState().setWalkTrack(track);
        if (fogShouldYield() || homeMapShouldPause()) {
          pauseFogHotPath();
        } else {
          forceFogRecompute(track);
        }
      }
      prev = now;
    });
  } catch {
    navFogWatchReady = false;
  }
}

/**
 * Mic-Press / Thinking: Fog-Timer stoppen. Die gezeichnete Fläche bleibt.
 */
export function pauseFogHotPath(): void {
  if (recomputeTimer) {
    clearTimeout(recomputeTimer);
    recomputeTimer = null;
  }
  if (transitExitTimer) {
    clearTimeout(transitExitTimer);
    transitExitTimer = null;
  }
}

let recomputeTimer: ReturnType<typeof setTimeout> | null = null;
let lastTrackKey = '';
let lastGpsAt = { lat: 0, lng: 0, atMs: 0 };
let lastGpsSpeedMs = 0;
let lastFullAtMs = 0;

/** Tempo hoch: Fläche einfrieren, ein Merge erst nach dem Abbremsen. */
let inTransitFog = false;
let transitExitTimer: ReturnType<typeof setTimeout> | null = null;

/** Fog-Punkt erst ab dieser Distanz. */
const GPS_FOG_MIN_M = 5;
/** Bike: seltener Track-Punkt — kein Rebuild alle paar Meter. */
const GPS_FOG_MIN_BIKE_M = 18;
/** Über diese Distanz kein Verbinden (Fuß). */
const FOG_CONNECT_MAX_M = 60;
/** Bei Radtempo: größere Lücken schließen, sonst reißt die Spur. */
const FOG_CONNECT_MAX_BIKE_M = 140;
/** Bus/Auto: Connect nur innerhalb kurzer Abschnitte — kein Stadt-Spaghetti. */
const FOG_CONNECT_MAX_TRANSIT_M = 200;

const FOG_DEBOUNCE_WALK_MS = 1_200;
/** Walk: volle Fläche höchstens so oft. Dazwischen bleibt die letzte Fläche. */
const FOG_WALK_FULL_EVERY_MS = 2_000;
/** Bike: deutlich länger — Polygon nicht bei jedem Rad-Tick. */
const FOG_DEBOUNCE_BIKE_MS = 3_200;
/** Bike Full-Merge höchstens so oft. */
const FOG_BIKE_FULL_EVERY_MS = 3_200;
/** Nach Tempo-Drop: kurz warten, dann einmal die ganze Fläche. */
const FOG_TRANSIT_EXIT_MS = 2_200;
/** Erste Fläche schnell, damit nicht minutenlang nur die GPS-Blase steht. */
const FOG_FIRST_SURFACE_MS = 450;

/** ~10 km/h — ab hier bike-aware Fog. */
export const BIKE_FOG_SPEED_MS = 2.8;
/** ~30 km/h — Bus/Auto: Fläche einfrieren. */
export const TRANSIT_FOG_SPEED_MS = 8.3;

export type FogSpeedTier = 'walk' | 'bike' | 'transit';

function metersBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = (a.lat - b.lat) * 111_320;
  const cos = Math.cos((a.lat * Math.PI) / 180);
  const dLng = (a.lng - b.lng) * 111_320 * Math.max(0.2, cos);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

export function fogSpeedTier(speedMs: number = lastGpsSpeedMs): FogSpeedTier {
  if (speedMs >= TRANSIT_FOG_SPEED_MS) return 'transit';
  if (speedMs >= BIKE_FOG_SPEED_MS) return 'bike';
  return 'walk';
}

function activeConnectMaxM(): number {
  const tier = fogSpeedTier();
  if (tier === 'transit') return FOG_CONNECT_MAX_TRANSIT_M;
  if (tier === 'bike') return FOG_CONNECT_MAX_BIKE_M;
  return FOG_CONNECT_MAX_M;
}

function fullEveryMs(): number {
  if (fogSpeedTier() === 'bike') return Math.max(FOG_DEBOUNCE_BIKE_MS, FOG_BIKE_FULL_EVERY_MS);
  return Math.max(FOG_DEBOUNCE_WALK_MS, FOG_WALK_FULL_EVERY_MS);
}

/** Mic / Modul-2 Speech — Fog stellt den Rebuild hinten an, löscht nichts. */
function fogShouldYield(): boolean {
  try {
    if (isMicActive()) return true;
    if (isVoiceLaneBusy()) return true;
    if (chromeHoldsLoad()) return true;
  } catch {
    /* soft */
  }
  return false;
}

function trackSampleCap(tier: FogSpeedTier): number {
  if (tier === 'transit') return 96;
  if (tier === 'bike') return 360;
  return 480;
}

/**
 * Stichprobe nach Metern, nicht nach Index.
 * Ein Index-Schritt auf einem langen Tag reißt die Spur (Abstand > Connect).
 */
function sampleTrackForFog(
  track: WalkTrackPoint[],
  tier: FogSpeedTier,
): WalkTrackPoint[] {
  const cap = trackSampleCap(tier);
  const minStep = tier === 'bike' ? 28 : tier === 'transit' ? 40 : 16;
  const spaced: WalkTrackPoint[] = [];
  for (const p of track) {
    const prev = spaced[spaced.length - 1];
    if (prev && metersBetween(prev, p) < minStep) continue;
    spaced.push(p);
  }
  const last = track[track.length - 1];
  if (last && spaced[spaced.length - 1] !== last) spaced.push(last);
  if (spaced.length <= cap) return spaced;
  const out: WalkTrackPoint[] = [];
  const step = Math.ceil(spaced.length / cap);
  for (let i = 0; i < spaced.length; i += step) out.push(spaced[i]!);
  if (last && out[out.length - 1] !== last) out.push(last);
  return out;
}

/** Connect mindestens so weit wie der größte Nicht-Teleport-Abstand der Stichprobe. */
function connectLimitFor(sampled: WalkTrackPoint[]): number {
  let maxGap = activeConnectMaxM();
  for (let i = 1; i < sampled.length; i++) {
    const prev = sampled[i - 1]!;
    const p = sampled[i]!;
    const dt = p.at - prev.at;
    if (dt < 0 || dt > FOG_SEGMENT_BREAK_MS) continue;
    const dist = metersBetween(prev, p);
    if (dist >= 400) continue;
    if (dist > maxGap) maxGap = dist;
  }
  return maxGap * 1.02;
}

/** Walk-Track in Segmente splitten — keine Fern-Spaghetti. */
export function fogTrackSegments(
  track: WalkTrackPoint[],
  maxConnect: number = activeConnectMaxM(),
): Array<Array<{ lat: number; lng: number }>> {
  if (!track.length) return [];
  const segs: Array<Array<{ lat: number; lng: number }> > = [];
  let cur: Array<{ lat: number; lng: number }> = [];
  let prev: WalkTrackPoint | null = null;
  for (const p of track) {
    if (!prev) {
      cur = [{ lat: p.lat, lng: p.lng }];
      prev = p;
      continue;
    }
    const dt = p.at - prev.at;
    const dist = metersBetween(prev, p);
    const connect =
      dt >= 0 && dt <= FOG_SEGMENT_BREAK_MS && dist <= maxConnect;
    if (!connect) {
      if (cur.length) segs.push(cur);
      cur = [{ lat: p.lat, lng: p.lng }];
    } else {
      cur.push({ lat: p.lat, lng: p.lng });
    }
    prev = p;
  }
  if (cur.length) segs.push(cur);
  return segs;
}

function computeExplored(track: WalkTrackPoint[]): FogPolygon[] {
  const tier = fogSpeedTier();
  const sampled = sampleTrackForFog(track, tier);
  const segments = fogTrackSegments(sampled, connectLimitFor(sampled));
  return buildExploredPolygons(
    segments,
    WALK_REVEAL_RADIUS_M,
    FOG_MERGE_GAP_M,
  );
}

/** Billiger GPS-Kreis — nur solange noch gar keine Fläche da ist. */
function cheapGpsRevealCircle(
  lat: number,
  lng: number,
  radiusM: number = WALK_REVEAL_RADIUS_M,
  steps = 36,
): FogPolygon {
  const mLng = Math.max(1, 111_320 * Math.cos((lat * Math.PI) / 180));
  const ring: FogRing = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    ring.push([
      lng + (Math.sin(a) * radiusM) / mLng,
      lat + (Math.cos(a) * radiusM) / 111_320,
    ]);
  }
  return [ring];
}

/** Eine Fläche. Leer überschreibt nie eine bestehende Spur. */
function commitFogSurface(polygons: FogPolygon[], key: string): void {
  if (!polygons.length) return;
  if (key === lastTrackKey && useFogStore.getState().exploredPolygons.length > 0) {
    return;
  }
  lastTrackKey = key;
  lastFullAtMs = Date.now();
  useFogStore.getState().setExplored(polygons, key);
}

/** Sofort Reveal um GPS — nur solange noch kein Fog da (sonst Doppel-Fläche). */
function pushInstantGpsBlob(gps: { lat: number; lng: number }): void {
  const store = useFogStore.getState();
  if (store.exploredPolygons.length > 0) return;
  if (isMapUserGesturing()) return;
  if (navFogActive()) return;
  const quick = [cheapGpsRevealCircle(gps.lat, gps.lng)];
  useFogStore
    .getState()
    .setExplored(quick, `gps:${gps.lat.toFixed(4)},${gps.lng.toFixed(4)}`);
}

function enterTransitLane(): void {
  if (inTransitFog) return;
  inTransitFog = true;
  if (transitExitTimer) {
    clearTimeout(transitExitTimer);
    transitExitTimer = null;
  }
}

function scheduleTransitExitFullMerge(track: WalkTrackPoint[]): void {
  if (!inTransitFog) return;
  if (transitExitTimer) clearTimeout(transitExitTimer);
  transitExitTimer = setTimeout(() => {
    transitExitTimer = null;
    if (fogSpeedTier() === 'transit') return;
    inTransitFog = false;
    forceFogRecompute(track);
  }, FOG_TRANSIT_EXIT_MS);
}

function runDeferredFullCompute(track: WalkTrackPoint[], key: string): void {
  // Schwere Vereinigung immer mapIdle — hinter Mic/Chrome, nie auf dem GPS-Tick.
  // Während Nav: kein Raster. Die letzte Fläche bleibt auf der Karte.
  if (navFogActive()) return;
  runMapIdleWhenFree(() => {
    if (navFogActive()) return;
    if (isMapUserGesturing() || fogShouldYield() || homeMapShouldPause()) {
      armRebuild();
      return;
    }
    if (fogSpeedTier() === 'transit') return;
    try {
      const latest = useFogStore.getState().walkTrack;
      const src = latest.length ? latest : track;
      const polygons = computeExplored(src);
      commitFogSurface(polygons, fogTrackCacheKey(src) || key);
    } catch {
      armRebuild();
    }
  });
}

/**
 * Timer nicht bei jedem GPS zurücksetzen — sonst läuft die Fläche beim
 * Gehen nie nach. Ein Lauf, danach bei Bedarf der nächste im Intervall.
 */
function armRebuild(): void {
  if (recomputeTimer) return;
  if (navFogActive() || fogShouldYield() || homeMapShouldPause()) return;
  const gap = fullEveryMs();
  const since = lastFullAtMs === 0 ? gap : Date.now() - lastFullAtMs;
  const delay = lastFullAtMs === 0 ? FOG_FIRST_SURFACE_MS : Math.max(400, gap - since);
  recomputeTimer = setTimeout(() => {
    recomputeTimer = null;
    if (fogShouldYield() || isMapUserGesturing() || homeMapShouldPause()) {
      armRebuild();
      return;
    }
    if (navFogActive() || fogSpeedTier() === 'transit') return;
    const track = useFogStore.getState().walkTrack;
    const key = fogTrackCacheKey(track);
    if (key === lastTrackKey && useFogStore.getState().exploredPolygons.length > 0) {
      return;
    }
    runDeferredFullCompute(track, key);
  }, delay);
}

export function scheduleFogRecompute(
  track: WalkTrackPoint[],
  gps?: { lat: number; lng: number } | null,
): void {
  // Mic / Thinking / Overlay: Track merken, Fläche nicht anfassen.
  if (fogShouldYield() || homeMapShouldPause()) {
    useFogStore.getState().setWalkTrack(track);
    pauseFogHotPath();
    return;
  }
  if (homeMapFogExploreIdleFrozen()) {
    useFogStore.getState().setWalkTrack(track);
    pauseFogHotPath();
    return;
  }
  if (isMapUserGesturing()) {
    if (recomputeTimer) clearTimeout(recomputeTimer);
    recomputeTimer = setTimeout(() => {
      recomputeTimer = null;
      scheduleFogRecompute(useFogStore.getState().walkTrack, gps ?? null);
    }, 900);
    return;
  }

  if (gps) {
    const minMoveM =
      fogSpeedTier() === 'bike' ? GPS_FOG_MIN_BIKE_M : GPS_FOG_MIN_M;
    const moved =
      lastGpsAt.atMs === 0 || metersBetween(lastGpsAt, gps) >= minMoveM;
    const trackKey = fogTrackCacheKey(track);
    if (!moved && trackKey === lastTrackKey) return;
    if (lastGpsAt.atMs > 0) {
      const dt = Math.max(0.05, (Date.now() - lastGpsAt.atMs) / 1000);
      const dist = metersBetween(lastGpsAt, gps);
      lastGpsSpeedMs = dist / dt;
    }
    lastGpsAt = { ...gps, atMs: Date.now() };
    if (!fogShouldYield() && !navFogActive()) {
      try {
        pushInstantGpsBlob(gps);
      } catch {
        /* soft */
      }
    }
  }

  useFogStore.getState().setWalkTrack(track);
  ensureNavFogCatchupWatch();

  // Live-Nav: kein Rebuild. Die letzte Fläche bleibt sichtbar.
  if (navFogActive()) {
    pauseFogHotPath();
    return;
  }

  const tier = fogSpeedTier();
  // Zug + GPS-Lock: kein Raster neben der Follow-Kamera.
  if (tier === 'transit' && homeMapLocationFollowActive()) {
    enterTransitLane();
    scheduleTransitExitFullMerge(track);
    return;
  }
  if (tier === 'transit') {
    enterTransitLane();
    scheduleTransitExitFullMerge(track);
    return;
  }

  if (inTransitFog) scheduleTransitExitFullMerge(track);

  armRebuild();
}

export function forceFogRecompute(track: WalkTrackPoint[]): void {
  useFogStore.getState().setWalkTrack(track);
  if (homeMapShouldPause() || fogShouldYield()) {
    pauseFogHotPath();
    return;
  }
  if (homeMapFogExploreIdleFrozen()) return;
  // Live-Nav: kein Raster — Catch-up erst nach Ende. Fläche bleibt.
  if (navFogActive()) {
    pauseFogHotPath();
    return;
  }
  const key = fogTrackCacheKey(track);
  if (recomputeTimer) clearTimeout(recomputeTimer);
  recomputeTimer = setTimeout(() => {
    recomputeTimer = null;
    if (isMapUserGesturing() || fogShouldYield() || homeMapShouldPause()) {
      armRebuild();
      return;
    }
    if (navFogActive()) return;
    runDeferredFullCompute(useFogStore.getState().walkTrack, key);
  }, 400);
}

export const FOG_CONNECT_MAX_WALK_M = FOG_CONNECT_MAX_M;
export const FOG_CONNECT_MAX_SPEED_M = FOG_CONNECT_MAX_BIKE_M;
export const FOG_DEBOUNCE_BIKE_MS_EXPORT = FOG_DEBOUNCE_BIKE_MS;
