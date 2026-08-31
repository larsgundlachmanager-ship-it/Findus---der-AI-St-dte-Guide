/**
 * Last-3 GPS ring buffer → movement vector + prompt context.
 * Persisted so crashes/hangs don't wipe Yorro' sense of motion.
 */

import * as FileSystem from 'expo-file-system';
import { bearingDegrees, distanceMeters } from './bearing';

export type GpsFix = { lat: number; lng: number; atMs: number };

const MAX_FIXES = 3;
/** Ignore jitter under this distance when deriving movement. */
const MIN_TRACK_M = 4;
const PATH = `${FileSystem.documentDirectory}findus-gps-track3.json`;

const fixes: GpsFix[] = [];
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let hydrated = false;

function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void FileSystem.writeAsStringAsync(
      PATH,
      JSON.stringify({ fixes }),
    ).catch(() => {});
  }, 800);
}

export async function hydrateGpsTrackBuffer(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const info = await FileSystem.getInfoAsync(PATH);
    if (!info.exists) return;
    const raw = await FileSystem.readAsStringAsync(PATH);
    const data = JSON.parse(raw) as { fixes?: GpsFix[] };
    if (!Array.isArray(data.fixes)) return;
    fixes.length = 0;
    for (const f of data.fixes.slice(-MAX_FIXES)) {
      if (
        typeof f.lat === 'number' &&
        typeof f.lng === 'number' &&
        typeof f.atMs === 'number'
      ) {
        fixes.push(f);
      }
    }
  } catch {
    // ignore corrupt cache
  }
}

export function resetGpsTrackBuffer(): void {
  fixes.length = 0;
  schedulePersist();
}

export function pushGpsTrackFix(
  lat: number,
  lng: number,
  atMs: number = Date.now(),
): void {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  void hydrateGpsTrackBuffer();
  const last = fixes[fixes.length - 1];
  if (last && distanceMeters(last.lat, last.lng, lat, lng) < 1.2) {
    last.lat = lat;
    last.lng = lng;
    last.atMs = atMs;
    schedulePersist();
    return;
  }
  fixes.push({ lat, lng, atMs });
  while (fixes.length > MAX_FIXES) fixes.shift();
  schedulePersist();
}

export function getGpsTrackFixes(): readonly GpsFix[] {
  return fixes;
}

/**
 * Bearing of recent movement from oldest → newest of the last ≤3 fixes.
 * Returns null if track is too short / noisy.
 */
export function getTrackMovementBearingDeg(): number | null {
  if (fixes.length < 2) return null;
  const a = fixes[0];
  const b = fixes[fixes.length - 1];
  if (distanceMeters(a.lat, a.lng, b.lat, b.lng) < MIN_TRACK_M) return null;
  return bearingDegrees(a.lat, a.lng, b.lat, b.lng);
}

/** Approx speed m/s from oldest→newest fix. */
export function getTrackSpeedMs(): number | null {
  if (fixes.length < 2) return null;
  const a = fixes[0];
  const b = fixes[fixes.length - 1];
  const dt = (b.atMs - a.atMs) / 1000;
  if (dt < 1) return null;
  return distanceMeters(a.lat, a.lng, b.lat, b.lng) / dt;
}

function modeHint(speedMs: number | null): string {
  if (speedMs == null) return 'unbekannt / stehend';
  if (speedMs < 0.4) return 'stehend / sehr langsam';
  if (speedMs < 1.8) return 'zu Fuß';
  if (speedMs < 6) return 'Fahrrad / zügig';
  if (speedMs < 20) return 'ÖPNV / Auto (langsam)';
  return 'Fahrzeug / schnell';
}

/**
 * Inject into every Gemini answer turn so Yorro can reason about motion.
 */
export function formatGpsTrackForPrompt(): string {
  if (fixes.length === 0) {
    return 'Bewegungs-Track: noch keine GPS-Fixes gespeichert.';
  }
  const speed = getTrackSpeedMs();
  const bearing = getTrackMovementBearingDeg();
  const lines = fixes.map((f, i) => {
    const t = new Date(f.atMs).toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    return `${i + 1}) ${f.lat.toFixed(5)}, ${f.lng.toFixed(5)} · ${t}`;
  });
  const kmh =
    speed != null && Number.isFinite(speed)
      ? `${(speed * 3.6).toFixed(1)} km/h`
      : '—';
  const dir =
    bearing != null ? `${Math.round(bearing)}° (Bewegungsrichtung GPS)` : '—';
  return [
    '=== LETZTE 3 KOORDINATEN (Bewegungskontext) ===',
    ...lines,
    `Geschwindigkeit ~${kmh} → Modus-Hinweis: ${modeHint(speed)}.`,
    `Richtung: ${dir}.`,
    'Facing-Regel: bewegt → GPS-Vektor für links/rechts; steht → Compass.',
    'Nutze das für Tempo, Verkehrsmittel, wohin der User geht, und visuelle Anker — nicht laut vorlesen.',
  ].join('\n');
}

export function getMovementSummary(): {
  speedMs: number | null;
  speedKmh: number | null;
  bearingDeg: number | null;
  modeHint: string;
} {
  const speedMs = getTrackSpeedMs();
  const bearingDeg = getTrackMovementBearingDeg();
  return {
    speedMs,
    speedKmh: speedMs != null ? speedMs * 3.6 : null,
    bearingDeg,
    modeHint: modeHint(speedMs),
  };
}
