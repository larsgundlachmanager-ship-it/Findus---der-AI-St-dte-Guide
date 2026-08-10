/**
 * Shared weather cache key: one Open-Meteo fetch per city/geo-cell for ~3h.
 * 100 users in Hamburg → 1 upstream call, not 100.
 */

/** Server + client TTL for shared location weather. */
export const SHARED_WEATHER_TTL_MS = 3 * 60 * 60_000;

/**
 * Prefer city pack id (Findus always has one). Else ~11 km geo cell
 * so everyone downtown Hamburg shares the same slot.
 */
export function weatherCacheKey(opts: {
  lat: number;
  lng: number;
  cityId?: string | null;
}): string {
  const city = (opts.cityId ?? '').toString().trim().toLowerCase();
  if (city) return `city:${city}`;
  const lat = Math.round(opts.lat * 10) / 10;
  const lng = Math.round(opts.lng * 10) / 10;
  return `geo:${lat.toFixed(1)}:${lng.toFixed(1)}`;
}

/** Representative coords for a geo cell (for Open-Meteo query when caching). */
export function weatherCacheCellCenter(lat: number, lng: number): {
  lat: number;
  lng: number;
} {
  return {
    lat: Math.round(lat * 10) / 10,
    lng: Math.round(lng * 10) / 10,
  };
}
