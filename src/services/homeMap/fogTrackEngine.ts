/**
 * Fog track → explored polygons. Track-only recompute; viewport clips in renderer.
 *
 * Segment-Regeln (User):
 * - neuer Punkt erst ab ~5 m Bewegung
 * - verbinden nur wenn ≤ 60 m UND ≤ 5 Min
 * - sonst neuer Fog-Blob (kein Spaghetti über Teleports)
 */

import {
  buildExploredPolygons,
  fogTrackCacheKey,
  FOG_MERGE_GAP_M,
  type FogPolygon,
} from '../discovery/fogCoverage';
import {
  FOG_SEGMENT_BREAK_MS,
  WALK_REVEAL_RADIUS_M,
  type WalkTrackPoint,
} from '../discovery/walkTrackService';
import { useFogStore } from '../../store/useFogStore';

let recomputeTimer: ReturnType<typeof setTimeout> | null = null;
let lastTrackKey = '';
let lastGpsAt = { lat: 0, lng: 0, atMs: 0 };

/** Fog-Punkt erst ab dieser Distanz (User: >5 m). */
const GPS_FOG_MIN_M = 5;
/** Über diese Distanz kein Verbinden (User: ~60–70 m). */
const FOG_CONNECT_MAX_M = 60;
const FOG_DEBOUNCE_MS = 1_200;

function metersBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = (a.lat - b.lat) * 111_320;
  const cos = Math.cos((a.lat * Math.PI) / 180);
  const dLng = (a.lng - b.lng) * 111_320 * Math.max(0.2, cos);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

/** Walk-Track in Segmente splitten — keine Fern-Spaghetti. */
export function fogTrackSegments(
  track: WalkTrackPoint[],
): Array<Array<{ lat: number; lng: number }>> {
  if (!track.length) return [];
  const segs: Array<Array<{ lat: number; lng: number }>> = [];
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
      dt >= 0 &&
      dt <= FOG_SEGMENT_BREAK_MS &&
      dist <= FOG_CONNECT_MAX_M;
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
  const segments = fogTrackSegments(track);
  return buildExploredPolygons(
    segments,
    WALK_REVEAL_RADIUS_M,
    FOG_MERGE_GAP_M,
  );
}

export function scheduleFogRecompute(
  track: WalkTrackPoint[],
  gps?: { lat: number; lng: number } | null,
): void {
  const trackKey = fogTrackCacheKey(track);
  if (gps) {
    const moved =
      lastGpsAt.atMs === 0 ||
      metersBetween(lastGpsAt, gps) >= GPS_FOG_MIN_M;
    if (!moved && trackKey === lastTrackKey) return;
    lastGpsAt = { ...gps, atMs: Date.now() };
  }
  if (trackKey === lastTrackKey && !gps) return;

  useFogStore.getState().setWalkTrack(track);
  if (recomputeTimer) clearTimeout(recomputeTimer);
  recomputeTimer = setTimeout(() => {
    recomputeTimer = null;
    const key = fogTrackCacheKey(useFogStore.getState().walkTrack);
    if (key === lastTrackKey) return;
    lastTrackKey = key;
    const polygons = computeExplored(useFogStore.getState().walkTrack);
    useFogStore.getState().setExplored(polygons, key);
  }, FOG_DEBOUNCE_MS);
}

export function forceFogRecompute(track: WalkTrackPoint[]): void {
  const key = fogTrackCacheKey(track);
  lastTrackKey = key;
  useFogStore.getState().setWalkTrack(track);
  const polygons = computeExplored(track);
  useFogStore.getState().setExplored(polygons, key);
}
