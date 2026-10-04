/**
 * Regen-Nowcast Cache-Key: ~1 km Mikro-Zelle (0.01°).
 * Blankenese ≠ Wilhelmsburg ≠ Volksdorf — Ziel ±~3 Min am Standort.
 * 1000 User in derselben Zelle → 1 Upstream / TTL.
 */

/** ~1.1 km bei Mitteleuropa. */
export const RAIN_CACHE_DEG = 0.01;

export function rainCacheKey(opts: { lat: number; lng: number }): string {
  const lat = Math.round(opts.lat / RAIN_CACHE_DEG) * RAIN_CACHE_DEG;
  const lng = Math.round(opts.lng / RAIN_CACHE_DEG) * RAIN_CACHE_DEG;
  return `rain:${lat.toFixed(2)}:${lng.toFixed(2)}`;
}

/** Zell-Zentrum für Bright-Sky-Sample (Edge / Shared). */
export function rainCellCenter(
  lat: number,
  lng: number,
): { lat: number; lng: number } {
  return {
    lat: Math.round(lat / RAIN_CACHE_DEG) * RAIN_CACHE_DEG,
    lng: Math.round(lng / RAIN_CACHE_DEG) * RAIN_CACHE_DEG,
  };
}
