/**
 * GPS-Trail für Fog-of-War / Discovery-Map.
 * Reveal: 50 m Radius / 100 m Durchmesser, als vereinigte Fläche (fogCoverage.ts).
 * Lücken zwischen Bändern bis 20 m schließen. Fixes ≤ 5 Min auseinander verbinden.
 */

import * as FileSystem from 'expo-file-system';
import { haversineMeters } from '../../db/database';

export type WalkTrackPoint = { lat: number; lng: number; at: number };

const PATH = `${FileSystem.documentDirectory}findus-walk-track.json`;
const MIN_STEP_M = 5;
const MAX_POINTS = 5_000;
/** Fog-/Explore-Radius um User und Laufspur. */
export const WALK_REVEAL_RADIUS_M = 42;
/**
 * Zwischen zwei Fixes Lücke füllen — nur wenn ≤ 5 Minuten.
 * Längere Pausen (Auto, Zug, Flug) erzeugen KEINE Linie.
 */
export const GAP_FILL_MAX_MS = 5 * 60_000;
/** Gap-Fill nur bis 60 m — sonst Teleport-Spaghetti. */
const GAP_FILL_MAX_M = 60;
/** Dichter als Reveal-Radius/6 → keine Löcher im interpolierten Trail. */
const GAP_FILL_STEP_M = 10;
/** Fog-Korridor: Zeit ≤ 5 Min UND Distanz ≤ 60 m. */
export const FOG_SEGMENT_BREAK_MS = GAP_FILL_MAX_MS;
export const FOG_SEGMENT_BREAK_M = GAP_FILL_MAX_M;

let points: WalkTrackPoint[] = [];
let loaded = false;
let loadingPromise: Promise<WalkTrackPoint[]> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

async function persistSoon(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void FileSystem.writeAsStringAsync(
      PATH,
      JSON.stringify({ points: points.slice(-MAX_POINTS) }),
    )
      .then(() => notifyCloudSoon())
      .catch(() => undefined);
  }, 2_500);
}

function notifyCloudSoon(): void {
  void import('../account/userCloudSync')
    .then((m) => m.scheduleUserCloudPush())
    .catch(() => undefined);
}

function mergeWalkPoints(
  local: WalkTrackPoint[],
  remote: WalkTrackPoint[],
): WalkTrackPoint[] {
  const map = new Map<string, WalkTrackPoint>();
  const key = (p: WalkTrackPoint) =>
    `${p.at}:${p.lat.toFixed(5)}:${p.lng.toFixed(5)}`;
  for (const p of remote) map.set(key(p), p);
  for (const p of local) map.set(key(p), p);
  return pruneLongHaulWalkPoints(
    [...map.values()].sort((a, b) => a.at - b.at),
  ).slice(-MAX_POINTS);
}

export function snapshotWalkTrackForCloud(): WalkTrackPoint[] {
  return points.slice(-MAX_POINTS);
}

export async function applyWalkTrackFromCloud(
  remote: WalkTrackPoint[],
): Promise<void> {
  await loadWalkTrack();
  if (!Array.isArray(remote) || remote.length === 0) return;
  points = mergeWalkPoints(points, remote);
  loaded = true;
  try {
    await FileSystem.writeAsStringAsync(
      PATH,
      JSON.stringify({ points: points.slice(-MAX_POINTS) }),
    );
  } catch {
    /* soft */
  }
}

/**
 * Entfernt interpolierte „Brücken“ zwischen Fernzielen
 * (Punkte-Ketten mit zu großer Distanz pro Zeitschritt).
 */
export function pruneLongHaulWalkPoints(
  pts: WalkTrackPoint[],
): WalkTrackPoint[] {
  if (pts.length < 2) return pts;
  const out: WalkTrackPoint[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    const prev = out[out.length - 1]!;
    const cur = pts[i]!;
    const dt = cur.at - prev.at;
    const dist = haversineMeters(prev.lat, prev.lng, cur.lat, cur.lng);
    // Zu weit in zu kurzer Zeit = alte Gap-Fill-Artefakte oder Teleport
    if (dt > 0 && dt <= GAP_FILL_MAX_MS && dist > GAP_FILL_MAX_M) {
      // Segment-Bruch: Punkt behalten, aber kein Fill — Start neue Kette
      out.push(cur);
      continue;
    }
    // Unrealistische Geschwindigkeit (> ~120 km/h über >1 km) → Bruch
    if (dt > 0 && dist > 1000) {
      const kmh = dist / 1000 / (dt / 3_600_000);
      if (kmh > 120) {
        out.push(cur);
        continue;
      }
    }
    out.push(cur);
  }
  return out;
}

export async function loadWalkTrack(): Promise<WalkTrackPoint[]> {
  if (loaded) return points;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    try {
      const info = await FileSystem.getInfoAsync(PATH);
      if (!info.exists) {
        loaded = true;
        return points;
      }
      const raw = await FileSystem.readAsStringAsync(PATH);
      const parsed = JSON.parse(raw) as { points?: WalkTrackPoint[] };
      if (Array.isArray(parsed.points)) {
        const disk = pruneLongHaulWalkPoints(
          parsed.points
            .filter(
              (p) =>
                p &&
                Number.isFinite(p.lat) &&
                Number.isFinite(p.lng) &&
                Number.isFinite(p.at),
            )
            .slice(-MAX_POINTS),
        );
        if (points.length === 0) {
          points = disk;
        } else {
          const merged = pruneLongHaulWalkPoints([...disk, ...points]);
          merged.sort((a, b) => a.at - b.at);
          points = merged.slice(-MAX_POINTS);
        }
      }
    } catch {
      if (points.length === 0) points = [];
    } finally {
      loaded = true;
      loadingPromise = null;
    }
    return points;
  })();
  return loadingPromise;
}

export function getWalkTrackSnapshot(): WalkTrackPoint[] {
  return points;
}

function interpolateGap(
  from: WalkTrackPoint,
  to: WalkTrackPoint,
): WalkTrackPoint[] {
  const dist = haversineMeters(from.lat, from.lng, to.lat, to.lng);
  if (dist < GAP_FILL_STEP_M * 1.2) return [];
  const dt = to.at - from.at;
  if (dt <= 0 || dt > GAP_FILL_MAX_MS) return [];
  if (dist > GAP_FILL_MAX_M) return [];
  const steps = Math.min(48, Math.floor(dist / GAP_FILL_STEP_M));
  if (steps < 1) return [];
  const out: WalkTrackPoint[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / (steps + 1);
    out.push({
      lat: from.lat + (to.lat - from.lat) * t,
      lng: from.lng + (to.lng - from.lng) * t,
      at: Math.round(from.at + dt * t),
    });
  }
  return out;
}

/** Neuen Fix anhängen, wenn ≥ MIN_STEP_M vom letzten Punkt. */
export function recordWalkFix(lat: number, lng: number): WalkTrackPoint[] {
  if (!loaded) void loadWalkTrack();
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return points;
  const now = Date.now();
  const last = points[points.length - 1];
  if (last) {
    const d = haversineMeters(last.lat, last.lng, lat, lng);
    if (d < MIN_STEP_M) return points;
    // Nav-Watcher / stale Last-Known: kein 20-km-Teleport in den Nebel malen
    const dt = now - last.at;
    if (d > GAP_FILL_MAX_M && dt >= 0 && dt < 60_000) {
      return points;
    }
    const gap = interpolateGap(last, { lat, lng, at: now });
    if (gap.length) {
      points = [...points, ...gap].slice(-MAX_POINTS);
    }
  }
  points = [...points, { lat, lng, at: now }].slice(-MAX_POINTS);
  void persistSoon();
  return points;
}

/**
 * Dichte Stichprobe — bewahrt Zeitlücken (kein Überspringen zu Fernziel).
 */
export function sampleWalkTrackForMap(maxPoints = 1_200): WalkTrackPoint[] {
  void loadWalkTrack();
  if (points.length <= maxPoints) return points;
  const out: WalkTrackPoint[] = [];
  const step = Math.ceil(points.length / maxPoints);
  for (let i = 0; i < points.length; i += step) {
    out.push(points[i]!);
  }
  const last = points[points.length - 1];
  if (last && out[out.length - 1] !== last) out.push(last);
  return out;
}

/** Erster Karten-Paint: nur Spur um den User, Rest später. */
export function sampleWalkTrackNear(
  lat: number,
  lng: number,
  radiusM = 1_800,
  maxPoints = 400,
): WalkTrackPoint[] {
  void loadWalkTrack();
  const nearby = points.filter(
    (p) => haversineMeters(p.lat, p.lng, lat, lng) <= radiusM,
  );
  if (nearby.length <= maxPoints) return nearby;
  const out: WalkTrackPoint[] = [];
  const step = Math.ceil(nearby.length / maxPoints);
  for (let i = 0; i < nearby.length; i += step) out.push(nearby[i]!);
  const last = nearby[nearby.length - 1];
  if (last && out[out.length - 1] !== last) out.push(last);
  return out;
}

function dayBoundsMs(dateKey: string): { start: number; end: number } {
  const [y, m, d] = dateKey.split('-').map(Number);
  const start = new Date(y!, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0).getTime();
  return { start, end: start + 24 * 60 * 60_000 };
}

/** GPS-Pfad eines Kalendertags (Städte-Zeitachse). */
export function sampleWalkTrackForDay(
  dateKey: string,
  maxPoints = 1_200,
): WalkTrackPoint[] {
  void loadWalkTrack();
  const { start, end } = dayBoundsMs(dateKey);
  const dayPts = points.filter((p) => p.at >= start && p.at < end);
  if (dayPts.length <= maxPoints) return dayPts;
  const step = Math.ceil(dayPts.length / maxPoints);
  const out: WalkTrackPoint[] = [];
  for (let i = 0; i < dayPts.length; i += step) out.push(dayPts[i]!);
  const last = dayPts[dayPts.length - 1];
  if (last && out[out.length - 1] !== last) out.push(last);
  return out;
}

export function listWalkTrackDateKeys(): string[] {
  void loadWalkTrack();
  const keys = new Set<string>();
  for (const p of points) {
    const d = new Date(p.at);
    keys.add(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    );
  }
  return [...keys].sort();
}

/** Sollen zwei Punkte als zusammenhängendes Fog-Segment gelten? */
export function shouldConnectWalkSegment(
  a: WalkTrackPoint,
  b: WalkTrackPoint,
): boolean {
  const dt = b.at - a.at;
  if (dt < 0 || dt > FOG_SEGMENT_BREAK_MS) return false;
  const dist = haversineMeters(a.lat, a.lng, b.lat, b.lng);
  if (dist > FOG_SEGMENT_BREAK_M) return false;
  return true;
}
