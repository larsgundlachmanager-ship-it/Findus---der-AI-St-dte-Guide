/**
 * GPS-Takt nach Tempo — Akku sparen.
 * Puck flüssig: `gpsDeadReckoning.ts` (Extrapolieren zwischen Fixes).
 *
 * Unter 1 km/h → 15 s
 * bis 3 km/h → 8 s
 * bis 8 km/h → 4 s
 * bis 12 km/h → 2 s
 * ab 13 km/h → 0.5 s
 * ohne Speed-Wert → 2 s (nicht Stillstand)
 */

export const GPS_CADENCE = {
  stillKmh: 1,
  crawlKmh: 3,
  walkKmh: 8,
  briskKmh: 12,
  fastKmh: 13,
  stillMs: 15_000,
  crawlMs: 8_000,
  walkMs: 4_000,
  briskMs: 2_000,
  fastMs: 500,
} as const;

export function kmhFromSpeedMs(speedMs: number | null | undefined): number {
  if (typeof speedMs !== 'number' || !Number.isFinite(speedMs) || speedMs < 0) {
    return 0;
  }
  return speedMs * 3.6;
}

export function gpsIntervalMsForSpeedKmh(kmh: number): number {
  const k = Number.isFinite(kmh) ? Math.max(0, kmh) : 0;
  if (k < GPS_CADENCE.stillKmh) return GPS_CADENCE.stillMs;
  if (k <= GPS_CADENCE.crawlKmh) return GPS_CADENCE.crawlMs;
  if (k <= GPS_CADENCE.walkKmh) return GPS_CADENCE.walkMs;
  if (k < GPS_CADENCE.fastKmh) return GPS_CADENCE.briskMs;
  return GPS_CADENCE.fastMs;
}

/**
 * GPS liefert oft speed=0/-1 obwohl man fährt → Track/EMA/Displacement retten den Takt.
 * Still (15 s) nur wenn ALLE Quellen stehen.
 */
export function resolveEffectiveSpeedMs(
  reported: number | null | undefined,
  trackMs?: number | null,
  smoothedMs?: number | null,
  displacementMs?: number | null,
): number | null {
  const ok = (v: number | null | undefined): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0;
  if (ok(reported) && reported >= 0.45) return reported;
  if (ok(trackMs) && trackMs >= 0.45) return trackMs;
  if (ok(smoothedMs) && smoothedMs >= 0.45) return smoothedMs;
  if (ok(displacementMs) && displacementMs >= 0.45) return displacementMs;
  const allStill =
    (!ok(reported) || reported < 0.45) &&
    (!ok(trackMs) || trackMs < 0.4) &&
    (!ok(smoothedMs) || smoothedMs < 0.4) &&
    (!ok(displacementMs) || displacementMs < 0.4);
  if (allStill && ok(reported)) return 0;
  return null;
}

/**
 * Zug/Auto: Sensor-Speed oft 0 — Abstand/Zeit zwischen Fixes als Tempo nutzen.
 * dt < 0.4 s oder > 90 s → unbrauchbar (Boot/Pause).
 */
export function speedMsFromDisplacement(
  prevLat: number | null | undefined,
  prevLng: number | null | undefined,
  nextLat: number,
  nextLng: number,
  dtMs: number,
): number | null {
  if (
    prevLat == null ||
    prevLng == null ||
    !Number.isFinite(prevLat) ||
    !Number.isFinite(prevLng) ||
    !Number.isFinite(nextLat) ||
    !Number.isFinite(nextLng) ||
    !Number.isFinite(dtMs) ||
    dtMs < 400 ||
    dtMs > 90_000
  ) {
    return null;
  }
  const dLat = (nextLat - prevLat) * 111_320;
  const cos = Math.cos((nextLat * Math.PI) / 180);
  const dLng = (nextLng - prevLng) * 111_320 * Math.max(0.2, cos);
  const movedM = Math.sqrt(dLat * dLat + dLng * dLng);
  if (movedM < 4) return null;
  return movedM / (dtMs / 1000);
}

export function gpsIntervalMsForSpeedMs(
  speedMs: number | null | undefined,
): number {
  if (typeof speedMs !== 'number' || !Number.isFinite(speedMs) || speedMs < 0) {
    // Ohne Speed-Wert nicht als Stillstand werten (Rad/Auto sonst 15 s tot).
    return GPS_CADENCE.briskMs;
  }
  return gpsIntervalMsForSpeedKmh(kmhFromSpeedMs(speedMs));
}

/**
 * Aktive Navigation: Cadence nutzen, aber Free-Roam-Stillstand (15 s) vermeiden
 * und Rad nicht dauerhaft auf 0,5 s festnageln (lange Touren / Akku).
 * - Fuß: 1 s in Bewegung (Puck/Cues), 2 s bei Stillstand — DR coaste nur ~2,8 s
 * - Rad: Cadence, nie schärfer als 1 s; Still/Boarding max. 4 s
 */
export function gpsIntervalMsWhileNavigating(
  speedMs: number | null | undefined,
  opts?: { preferBike?: boolean },
): number {
  const raw = gpsIntervalMsForSpeedMs(speedMs);
  if (opts?.preferBike) {
    const slowest = GPS_CADENCE.walkMs; // 4 s Boarding
    const fastest = 1_000;
    if (raw >= GPS_CADENCE.stillMs) return slowest;
    return Math.min(slowest, Math.max(fastest, raw));
  }
  // Fuß-Nav: 4 s Cadence + kurzer Coast = sichtbarer Lag hinter dem Gehenden.
  if (raw >= GPS_CADENCE.stillMs) return GPS_CADENCE.briskMs; // 2 s
  return 1_000;
}

export function gpsCadenceReason(kmh: number): string {
  const ms = gpsIntervalMsForSpeedKmh(kmh);
  if (ms === GPS_CADENCE.stillMs) return 'still_under_1kmh';
  if (ms === GPS_CADENCE.crawlMs) return 'crawl_to_3kmh';
  if (ms === GPS_CADENCE.walkMs) return 'walk_to_8kmh';
  if (ms === GPS_CADENCE.briskMs) return 'brisk_to_12kmh';
  return 'fast_from_13kmh';
}
