/**
 * Parking: Parkopedia (wenn Key) + Google Places Fallback + Pack-Hints.
 */

import { env } from '../../config/env';
import { hasGoogleMapsNavKey } from '../navigation/googleMapsNav';
import { getMobilityPackConfig, type PackParkingHint } from './mobilityRegistry';

export type ParkingSpot = {
  source: 'parkopedia' | 'google_places' | 'pack';
  name: string;
  lat: number;
  lng: number;
  distanceM: number;
  /** free | paid | unknown */
  pricing: 'free' | 'paid' | 'unknown';
  /** bike_rack | car | mixed */
  kind: 'bike_rack' | 'car' | 'mixed';
};

const FETCH_MS = 5_000;
const PLACES_NEARBY =
  'https://maps.googleapis.com/maps/api/place/nearbysearch/json';

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

function mapsKey(): string {
  return (
    env.googleMapsApiKey?.() ||
    env.get('EXPO_PUBLIC_GOOGLE_MAPS_API_KEY') ||
    ''
  ).trim();
}

async function fetchParkopediaNear(
  lat: number,
  lng: number,
  radiusM: number,
): Promise<ParkingSpot[]> {
  const key = env.get('EXPO_PUBLIC_PARKOPEDIA_API_KEY').trim();
  if (!key || key.includes('your-')) return [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    // Parkopedia Places Search (Partner-API)
    const u = new URL('https://api.parkopedia.com/v2/places/');
    u.searchParams.set('apikey', key);
    u.searchParams.set('lat', String(lat));
    u.searchParams.set('lng', String(lng));
    u.searchParams.set('radius', String(Math.round(radiusM)));
    u.searchParams.set('maxresults', '8');
    const res = await fetch(u.toString(), { signal: ctrl.signal });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      places?: Array<{
        name?: string;
        lat?: number;
        lng?: number;
        distance?: number;
        pricing?: { currency?: string };
      }>;
      result?: Array<{
        name?: string;
        lat?: number;
        lng?: number;
        distance?: number;
      }>;
    };
    const rows = data.places ?? data.result ?? [];
    return rows
      .filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number')
      .map((p) => ({
        source: 'parkopedia' as const,
        name: (p.name ?? 'Parkplatz').trim(),
        lat: p.lat!,
        lng: p.lng!,
        distanceM: Math.round(
          typeof p.distance === 'number'
            ? p.distance
            : haversineM(lat, lng, p.lat!, p.lng!),
        ),
        pricing: 'unknown' as const,
        kind: 'car' as const,
      }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGoogleParkingNear(
  lat: number,
  lng: number,
  radiusM: number,
): Promise<ParkingSpot[]> {
  if (!hasGoogleMapsNavKey()) return [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const u = new URL(PLACES_NEARBY);
    u.searchParams.set('location', `${lat},${lng}`);
    u.searchParams.set('radius', String(Math.min(radiusM, 1500)));
    u.searchParams.set('type', 'parking');
    u.searchParams.set('language', 'de');
    u.searchParams.set('key', mapsKey());
    const res = await fetch(u.toString(), { signal: ctrl.signal });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      results?: Array<{
        name?: string;
        geometry?: { location?: { lat?: number; lng?: number } };
      }>;
    };
    const out: ParkingSpot[] = [];
    for (const r of data.results ?? []) {
      const plat = r.geometry?.location?.lat;
      const plng = r.geometry?.location?.lng;
      if (plat == null || plng == null) continue;
      out.push({
        source: 'google_places',
        name: (r.name ?? 'Parkplatz').trim(),
        lat: plat,
        lng: plng,
        distanceM: Math.round(haversineM(lat, lng, plat, plng)),
        pricing: 'unknown',
        kind: 'car',
      });
    }
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function packHintsNear(
  lat: number,
  lng: number,
  radiusM: number,
): ParkingSpot[] {
  const hints: PackParkingHint[] =
    getMobilityPackConfig()?.parking?.hint_spots ?? [];
  return hints
    .filter((h) => typeof h.lat === 'number' && typeof h.lng === 'number')
    .map((h) => ({
      source: 'pack' as const,
      name: h.name.trim(),
      lat: h.lat,
      lng: h.lng,
      distanceM: Math.round(haversineM(lat, lng, h.lat, h.lng)),
      pricing: (h.pricing as ParkingSpot['pricing']) ?? 'unknown',
      kind: (h.type as ParkingSpot['kind']) ?? 'mixed',
    }))
    .filter((h) => h.distanceM <= radiusM);
}

/**
 * Parking / Abstellplätze in der Nähe.
 */
export async function findNearbyParking(opts: {
  lat: number;
  lng: number;
  radiusM?: number;
  preferBike?: boolean;
  limit?: number;
}): Promise<ParkingSpot[]> {
  const radiusM = opts.radiusM ?? 700;
  const limit = opts.limit ?? 5;
  const [parkopedia, google, pack] = await Promise.all([
    fetchParkopediaNear(opts.lat, opts.lng, radiusM),
    fetchGoogleParkingNear(opts.lat, opts.lng, radiusM),
    Promise.resolve(packHintsNear(opts.lat, opts.lng, radiusM)),
  ]);

  let merged = [...pack, ...parkopedia, ...google];
  if (opts.preferBike) {
    merged = [
      ...merged.filter((p) => p.kind === 'bike_rack'),
      ...merged.filter((p) => p.kind !== 'bike_rack'),
    ];
  }
  const seen = new Set<string>();
  const uniq: ParkingSpot[] = [];
  for (const p of merged) {
    const key = `${p.lat.toFixed(4)}|${p.lng.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(p);
  }
  uniq.sort((a, b) => a.distanceM - b.distanceM);
  return uniq.slice(0, limit);
}

export function formatParkingHint(
  spots: ParkingSpot[],
  opts?: { forBike?: boolean },
): string | null {
  const bike = spots.find((s) => s.kind === 'bike_rack');
  const pick = opts?.forBike ? bike ?? spots[0] : spots[0];
  if (!pick) return null;
  const dist =
    pick.distanceM < 60 ? 'direkt hier' : `ca. ${pick.distanceM} Meter`;
  if (pick.kind === 'bike_rack' || opts?.forBike) {
    return `Rad hier abstellen? Fahrradständer „${pick.name}“ ${dist}.`;
  }
  return `Parken: „${pick.name}“ ${dist}.`;
}
