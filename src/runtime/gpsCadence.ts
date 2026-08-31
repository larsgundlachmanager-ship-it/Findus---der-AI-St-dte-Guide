/**
 * GPS-Takt nach Tempo — Akku sparen, Puck flüssig per Dead Reckoning.
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
 * GPS liefert oft speed=0/-1 obwohl man fährt → Track/EMA retten den Takt.
 * Still (15 s) nur wenn ALLE Quellen stehen.
 */
export function resolveEffectiveSpeedMs(
  reported: number | null | undefined,
  trackMs?: number | null,
  smoothedMs?: number | null,
): number | null {
  const ok = (v: number | null | undefined): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0;
  if (ok(reported) && reported >= 0.45) return reported;
  if (ok(trackMs) && trackMs >= 0.45) return trackMs;
  if (ok(smoothedMs) && smoothedMs >= 0.45) return smoothedMs;
  const allStill =
    (!ok(reported) || reported < 0.45) &&
    (!ok(trackMs) || trackMs < 0.4) &&
    (!ok(smoothedMs) || smoothedMs < 0.4);
  if (allStill && ok(reported)) return 0;
  return null;
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

export function gpsCadenceReason(kmh: number): string {
  const ms = gpsIntervalMsForSpeedKmh(kmh);
  if (ms === GPS_CADENCE.stillMs) return 'still_under_1kmh';
  if (ms === GPS_CADENCE.crawlMs) return 'crawl_to_3kmh';
  if (ms === GPS_CADENCE.walkMs) return 'walk_to_8kmh';
  if (ms === GPS_CADENCE.briskMs) return 'brisk_to_12kmh';
  return 'fast_from_13kmh';
}
