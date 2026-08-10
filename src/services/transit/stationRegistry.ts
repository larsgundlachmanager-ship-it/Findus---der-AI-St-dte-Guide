/**
 * Haltestellen aus Stadt-Pack (_transit.stops) + IBNR/GTFS-IDs.
 */

export type PackTransitStop = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  ibnr?: string | null;
  gtfs_stop_id?: string | null;
  /** z. B. rail | bus | tram | ferry */
  mode?: string | null;
};

export type PackTransitConfig = {
  /** db_rest | hafas | gtfs_rt | delijn | none */
  provider?: string | null;
  default_ibnr?: string | null;
  /** Öffentlicher transport.rest Host (ohne Trailing Slash). */
  hafas_base_url?: string | null;
  /** GTFS-Realtime TripUpdates Feed-URL. */
  gtfs_rt_url?: string | null;
  /** Delijn / Verbund API-Basis. */
  delijn_base_url?: string | null;
  stops?: PackTransitStop[];
};

let config: PackTransitConfig | null = null;
const stopsById = new Map<string, PackTransitStop>();

export function clearTransitStationRegistry(): void {
  config = null;
  stopsById.clear();
}

export function setTransitPackConfig(cfg: PackTransitConfig | null | undefined): void {
  clearTransitStationRegistry();
  if (!cfg) return;
  config = { ...cfg, stops: cfg.stops ?? [] };
  for (const s of config.stops ?? []) {
    if (!s?.id || typeof s.lat !== 'number' || typeof s.lng !== 'number') continue;
    stopsById.set(s.id, s);
  }
}

export function getTransitPackConfig(): PackTransitConfig | null {
  return config;
}

export function getPackTransitStops(): PackTransitStop[] {
  return [...stopsById.values()];
}

export function findNearestPackStop(
  lat: number,
  lng: number,
  maxM = 800,
): PackTransitStop | null {
  let best: PackTransitStop | null = null;
  let bestD = maxM;
  for (const s of stopsById.values()) {
    const d = haversineM(lat, lng, s.lat, s.lng);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

export function resolveIbnrForCity(cityId: string): string | null {
  if (config?.default_ibnr?.trim()) return config.default_ibnr.trim();
  const first = [...stopsById.values()].find((s) => s.ibnr?.trim());
  if (first?.ibnr) return first.ibnr.trim();
  // Hardcoded Fallback für bekannte Städte ohne Pack-Feld
  const FALLBACK: Record<string, string> = { prisdorf: '8004888' };
  return FALLBACK[cityId.trim().toLowerCase()] ?? null;
}

/** MOTIS/DELFI Stop-ID aus Pack (überspringt Geocode). */
export function resolveTransitousStopIdForCity(
  cityId?: string | null,
): string | null {
  const fromStop = [...stopsById.values()].find((s) =>
    s.gtfs_stop_id?.trim(),
  );
  if (fromStop?.gtfs_stop_id?.trim()) return fromStop.gtfs_stop_id.trim();
  const FALLBACK: Record<string, string> = {
    prisdorf: 'de-DELFI_de:01056:8004888',
  };
  const key = (cityId ?? '').trim().toLowerCase();
  return FALLBACK[key] ?? null;
}

function haversineM(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
