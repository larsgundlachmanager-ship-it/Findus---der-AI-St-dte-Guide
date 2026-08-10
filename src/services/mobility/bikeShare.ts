/**
 * Bike-Share: nextbike + Call a Bike (DB, oft nextbike-Netz).
 * Öffentliche Live-Map ohne API-Key.
 */

import { getMobilityPackConfig } from './mobilityRegistry';

export type BikeShareStation = {
  provider: 'nextbike' | 'call_a_bike';
  name: string;
  lat: number;
  lng: number;
  bikesAvailable: number;
  /** Freie Docking-Plätze, falls bekannt. */
  freeSlots: number | null;
  distanceM: number;
};

const FETCH_MS = 5_000;
const NEXTBIKE_LIVE = 'https://api.nextbike.net/maps/nextbike-live.json';

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

type NextbikePlace = {
  name?: string;
  lat?: number;
  lng?: number;
  bikes?: number;
  free_racks?: number;
  bike_racks?: number;
  spot?: boolean;
};

type NextbikeCity = {
  name?: string;
  places?: NextbikePlace[];
};

function parseNextbikePlaces(
  data: { countries?: Array<{ cities?: NextbikeCity[]; domain?: string }> },
  origin: { lat: number; lng: number },
  radiusM: number,
  provider: 'nextbike' | 'call_a_bike',
): BikeShareStation[] {
  const out: BikeShareStation[] = [];
  for (const country of data.countries ?? []) {
    for (const city of country.cities ?? []) {
      for (const p of city.places ?? []) {
        if (typeof p.lat !== 'number' || typeof p.lng !== 'number') continue;
        const d = haversineM(origin.lat, origin.lng, p.lat, p.lng);
        if (d > radiusM) continue;
        out.push({
          provider,
          name: (p.name ?? 'Station').trim(),
          lat: p.lat,
          lng: p.lng,
          bikesAvailable: typeof p.bikes === 'number' ? p.bikes : 0,
          freeSlots:
            typeof p.free_racks === 'number'
              ? p.free_racks
              : typeof p.bike_racks === 'number'
                ? p.bike_racks
                : null,
          distanceM: Math.round(d),
        });
      }
    }
  }
  out.sort((a, b) => a.distanceM - b.distanceM);
  return out;
}

async function fetchNextbikeNear(
  lat: number,
  lng: number,
  radiusM: number,
  opts?: { cityId?: string | null; domain?: string | null },
): Promise<BikeShareStation[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const u = new URL(NEXTBIKE_LIVE);
    u.searchParams.set('lat', String(lat));
    u.searchParams.set('lng', String(lng));
    u.searchParams.set('distance', String(Math.min(radiusM, 10_000)));
    if (opts?.cityId) u.searchParams.set('city', String(opts.cityId));
    if (opts?.domain) u.searchParams.set('domains', String(opts.domain));
    const res = await fetch(u.toString(), { signal: ctrl.signal });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      countries?: Array<{ cities?: NextbikeCity[]; domain?: string }>;
    };
    const isCab =
      (opts?.domain ?? '').toLowerCase().includes('db') ||
      (opts?.domain ?? '').toLowerCase().includes('call');
    return parseNextbikePlaces(
      data,
      { lat, lng },
      radiusM,
      isCab ? 'call_a_bike' : 'nextbike',
    );
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Nächste Bike-Share-Stationen (nextbike + optional Call a Bike).
 */
export async function findNearbyBikeShare(opts: {
  lat: number;
  lng: number;
  radiusM?: number;
  limit?: number;
}): Promise<BikeShareStation[]> {
  const radiusM = opts.radiusM ?? 900;
  const limit = opts.limit ?? 5;
  const pack = getMobilityPackConfig();
  const providers = pack?.bike_share?.providers ?? ['nextbike', 'call_a_bike'];
  const nextbikeCity = pack?.bike_share?.nextbike_city_id ?? null;

  const tasks: Promise<BikeShareStation[]>[] = [];
  if (providers.includes('nextbike')) {
    tasks.push(
      fetchNextbikeNear(opts.lat, opts.lng, radiusM, {
        cityId: nextbikeCity,
      }),
    );
  }
  if (providers.includes('call_a_bike')) {
    // Call a Bike läuft oft unter nextbike domain "db" / "cab"
    tasks.push(
      fetchNextbikeNear(opts.lat, opts.lng, radiusM, { domain: 'db' }),
    );
  }

  const batches = await Promise.all(tasks);
  const merged = batches.flat();
  // Dedup by rounded coords
  const seen = new Set<string>();
  const uniq: BikeShareStation[] = [];
  for (const s of merged) {
    const key = `${s.lat.toFixed(4)}|${s.lng.toFixed(4)}|${s.provider}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(s);
  }
  uniq.sort((a, b) => a.distanceM - b.distanceM);
  return uniq.slice(0, limit);
}

/** Kurzer Sprach-Hinweis: „Rad hier abstellen?“ */
export function formatBikeParkHint(stations: BikeShareStation[]): string | null {
  const withSlots = stations.find(
    (s) => s.freeSlots != null && s.freeSlots > 0,
  );
  const nearest = withSlots ?? stations[0];
  if (!nearest) return null;
  const provider =
    nearest.provider === 'call_a_bike' ? 'Call a Bike' : 'nextbike';
  const dist =
    nearest.distanceM < 80
      ? 'direkt hier'
      : `ca. ${nearest.distanceM} Meter`;
  if (nearest.freeSlots != null && nearest.freeSlots > 0) {
    return `Rad hier abstellen? ${provider}-Station „${nearest.name}“ ${dist} — ${nearest.freeSlots} freie Plätze.`;
  }
  if (nearest.bikesAvailable > 0) {
    return `Rad-Sharing: ${provider} „${nearest.name}“ ${dist} (${nearest.bikesAvailable} Räder). Zum Abstellen schau auf freie Docking-Plätze.`;
  }
  return `Nächste ${provider}-Station „${nearest.name}“ liegt ${dist}.`;
}
