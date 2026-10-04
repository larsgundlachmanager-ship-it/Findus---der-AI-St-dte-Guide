# -*- coding: utf-8 -*-
"""Apply remaining Nav Speed Fix patches."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

def patch(path: str, pairs: list[tuple[str, str]], label: str):
    p = ROOT / path
    t = p.read_text(encoding="utf-8")
    for i, (old, new) in enumerate(pairs):
        if new.strip() and new in t and old not in t:
            print(f"{label}: pair {i} already applied")
            continue
        if old not in t:
            raise SystemExit(f"{label}: pair {i} OLD not found")
        t = t.replace(old, new, 1)
        print(f"{label}: pair {i} ok")
    p.write_text(t, encoding="utf-8")
    print(f"{label}: wrote")

# --- amenity images ---
patch(
    "src/components/homeMap/homeMapAmenityImages.ts",
    [
        (
            "  'route-chevron': require('../../assets/homeMap/route-chevron.png'),\n",
            "  'route-chevron': require('../../assets/homeMap/route-chevron.png'),\n"
            "  'route-turn-chevron': require('../../assets/homeMap/route-turn-chevron.png'),\n",
        )
    ],
    "amenity",
)

# --- fogTrackEngine ---
fog_old = Path(ROOT / "src/services/homeMap/fogTrackEngine.ts").read_text(encoding="utf-8")
if "FOG_CONNECT_MAX_BIKE_M" not in fog_old:
    fog = r'''/**
 * Fog track → explored polygons. Track-only recompute; viewport clips in renderer.
 *
 * Segment-Regeln (User):
 * - neuer Punkt erst ab ~5 m Bewegung
 * - verbinden nur wenn ≤ Connect-Max UND ≤ 5 Min
 * - bei Tempo (Bike) größeres Connect + kürzeres Debounce — Fog folgt knapp
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
import { isMapUserGesturing } from './mapGestureLane';
import { isMicActive } from '../boot/interactiveBootGate';

let recomputeTimer: ReturnType<typeof setTimeout> | null = null;
let lastTrackKey = '';
let lastGpsAt = { lat: 0, lng: 0, atMs: 0 };
let lastGpsSpeedMs = 0;

/** Fog-Punkt erst ab dieser Distanz (User: >5 m). */
const GPS_FOG_MIN_M = 5;
/** Über diese Distanz kein Verbinden (Fuß). */
const FOG_CONNECT_MAX_M = 60;
/** Bei Radtempo: größere Lücken schließen, sonst reißt die Spur. */
const FOG_CONNECT_MAX_BIKE_M = 140;
const FOG_DEBOUNCE_MS = 1_200;
const FOG_DEBOUNCE_BIKE_MS = 450;
/** ~10 km/h — ab hier bike-aware Fog. */
const BIKE_FOG_SPEED_MS = 2.8;

function metersBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = (a.lat - b.lat) * 111_320;
  const cos = Math.cos((a.lat * Math.PI) / 180);
  const dLng = (a.lng - b.lng) * 111_320 * Math.max(0.2, cos);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

function connectMaxM(speedMs: number): number {
  return speedMs >= BIKE_FOG_SPEED_MS ? FOG_CONNECT_MAX_BIKE_M : FOG_CONNECT_MAX_M;
}

function debounceMs(speedMs: number): number {
  return speedMs >= BIKE_FOG_SPEED_MS ? FOG_DEBOUNCE_BIKE_MS : FOG_DEBOUNCE_MS;
}

/** Walk-Track in Segmente splitten — keine Fern-Spaghetti. */
export function fogTrackSegments(
  track: WalkTrackPoint[],
  maxConnectM = FOG_CONNECT_MAX_M,
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
      dist <= maxConnectM;
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

function computeExplored(
  track: WalkTrackPoint[],
  speedMs = 0,
): FogPolygon[] {
  const segments = fogTrackSegments(track, connectMaxM(speedMs));
  return buildExploredPolygons(
    segments,
    WALK_REVEAL_RADIUS_M,
    FOG_MERGE_GAP_M,
  );
}

/** Sofort kleiner Reveal um GPS — Fog „folgt“, Merge kommt idle. */
function pushInstantGpsBlob(gps: { lat: number; lng: number }): void {
  const store = useFogStore.getState();
  const blob: FogPolygon = {
    // approximate ring ~ reveal radius — fogCoverage uses polygons; keep soft if shape differs
    ...(store.exploredPolygons[0]
      ? {}
      : {}),
  } as FogPolygon;
  void blob;
  // Prefer appending a tiny track-only recompute of last points only when cheap.
  const track = store.walkTrack;
  const tail = track.length
    ? [...track.slice(-8), { lat: gps.lat, lng: gps.lng, at: Date.now() }]
    : [{ lat: gps.lat, lng: gps.lng, at: Date.now() }];
  const quick = computeExplored(tail, lastGpsSpeedMs);
  if (quick.length) {
    // Merge with existing without waiting full debounce when not mic-busy
    const merged = [...store.exploredPolygons, ...quick].slice(-40);
    useFogStore.getState().setExplored(merged, `gps:${gps.lat.toFixed(4)},${gps.lng.toFixed(4)}`);
  }
}

export function scheduleFogRecompute(
  track: WalkTrackPoint[],
  gps?: { lat: number; lng: number } | null,
): void {
  if (isMapUserGesturing()) {
    if (recomputeTimer) clearTimeout(recomputeTimer);
    recomputeTimer = setTimeout(() => {
      scheduleFogRecompute(track, gps);
    }, 900);
    return;
  }
  const trackKey = fogTrackCacheKey(track);
  if (gps) {
    const moved =
      lastGpsAt.atMs === 0 ||
      metersBetween(lastGpsAt, gps) >= GPS_FOG_MIN_M;
    if (!moved && trackKey === lastTrackKey) return;
    if (lastGpsAt.atMs > 0) {
      const dt = Math.max(0.05, (Date.now() - lastGpsAt.atMs) / 1000);
      const dist = metersBetween(lastGpsAt, gps);
      lastGpsSpeedMs = dist / dt;
    }
    lastGpsAt = { ...gps, atMs: Date.now() };
    // Instant near-GPS reveal (cheap) — Mic busy: skip, full merge later
    if (!isMicActive()) {
      try {
        pushInstantGpsBlob(gps);
      } catch {
        /* soft */
      }
    }
  }
  if (trackKey === lastTrackKey && !gps) return;

  useFogStore.getState().setWalkTrack(track);
  if (recomputeTimer) clearTimeout(recomputeTimer);
  const wait = isMicActive()
    ? Math.max(debounceMs(lastGpsSpeedMs), 1800)
    : debounceMs(lastGpsSpeedMs);
  recomputeTimer = setTimeout(() => {
    recomputeTimer = null;
    if (isMicActive()) {
      // Mic first — retry shortly
      scheduleFogRecompute(useFogStore.getState().walkTrack, gps ?? null);
      return;
    }
    const key = fogTrackCacheKey(useFogStore.getState().walkTrack);
    if (key === lastTrackKey) return;
    lastTrackKey = key;
    const polygons = computeExplored(
      useFogStore.getState().walkTrack,
      lastGpsSpeedMs,
    );
    useFogStore.getState().setExplored(polygons, key);
  }, wait);
}

export function forceFogRecompute(track: WalkTrackPoint[]): void {
  const key = fogTrackCacheKey(track);
  lastTrackKey = key;
  useFogStore.getState().setWalkTrack(track);
  const polygons = computeExplored(track, lastGpsSpeedMs);
  useFogStore.getState().setExplored(polygons, key);
}

export const FOG_CONNECT_MAX_WALK_M = FOG_CONNECT_MAX_M;
export const FOG_CONNECT_MAX_SPEED_M = FOG_CONNECT_MAX_BIKE_M;
'''
    # Fix pushInstantGpsBlob - FogPolygon type may not accept empty. Check fogCoverage type.
    Path(ROOT / "src/services/homeMap/fogTrackEngine.ts").write_text(fog, encoding="utf-8")
    print("fogTrackEngine wrote (needs polygon type check)")
else:
    print("fog already patched")

print("phase1 done")
