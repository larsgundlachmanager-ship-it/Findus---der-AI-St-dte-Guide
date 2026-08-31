/**
 * Shared weather cache key: one upstream fetch per city-district / geo-cell.
 * 1000 users in Hamburg Altona → 1 OWM/Open-Meteo call, not 1000.
 */

/**
 * Prefer city pack id + ~5 km Viertel-Zelle (Gewitter lokal).
 * Ohne cityId: ~11 km geo cell.
 */
export function weatherCacheKey(opts: {
  lat: number;
  lng: number;
  cityId?: string | null;
}): string {
  const city = (opts.cityId ?? '').toString().trim().toLowerCase();
  if (city) {
    const lat = Math.round(opts.lat * 20) / 20;
    const lng = Math.round(opts.lng * 20) / 20;
    return `city:${city}:${lat.toFixed(2)}:${lng.toFixed(2)}`;
  }
  const lat = Math.round(opts.lat * 10) / 10;
  const lng = Math.round(opts.lng * 10) / 10;
  return `geo:${lat.toFixed(1)}:${lng.toFixed(1)}`;
}

/** Representative coords for the cache cell (upstream query). */
export function weatherCacheCellCenter(lat: number, lng: number): {
  lat: number;
  lng: number;
} {
  // Match district precision when used without city (geo key still 0.1)
  return {
    lat: Math.round(lat * 10) / 10,
    lng: Math.round(lng * 10) / 10,
  };
}

/** Center for city+Viertel key (0.05°). */
export function weatherDistrictCenter(lat: number, lng: number): {
  lat: number;
  lng: number;
} {
  return {
    lat: Math.round(lat * 20) / 20,
    lng: Math.round(lng * 20) / 20,
  };
}
