/**
 * 2-Min-Dwell Ortslabel:
 * 1) Pack-POI / OSM
 * 2) Google Places / Maps
 * 3) 📍 Straße + Hausnummer
 */

import { getAllPois, haversineMeters } from '../../db/database';
import { searchOsmPlacesNearby } from '../navigation/overpassService';
import { hasGoogleMapsNavKey } from '../navigation/googleMapsNav';
import { env } from '../../config/env';
import {
  formatStreetPin,
  isVaguePlaceLabel,
  simplifyPlaceName,
} from './placeLabelClean';

export type DwellPlaceHit = {
  title: string;
  confidence: number;
  via: 'pack' | 'osm' | 'google' | 'address';
  poiId?: number | null;
};

const FETCH_MS = 7_000;
const GEOCODE = 'https://maps.googleapis.com/maps/api/geocode/json';
const PLACES_NEARBY =
  'https://maps.googleapis.com/maps/api/place/nearbysearch/json';

function mapsKey(): string {
  return (
    env.googleMapsApiKey?.() ||
    (typeof process !== 'undefined'
      ? String(process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '').trim()
      : '') ||
    ''
  ).trim();
}

async function fetchJson(
  url: string,
  signal: AbortSignal,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

type Addr = {
  road?: string;
  pedestrian?: string;
  footway?: string;
  path?: string;
  residential?: string;
  house_number?: string;
  amenity?: string;
  tourism?: string;
  shop?: string;
  building?: string;
  leisure?: string;
};

function streetFromAddr(addr?: Addr | null): {
  street: string;
  nr: string | null;
} | null {
  if (!addr) return null;
  const road =
    addr.road ||
    addr.pedestrian ||
    addr.footway ||
    addr.path ||
    addr.residential ||
    null;
  if (!road) return null;
  return { street: road, nr: addr.house_number?.trim() || null };
}

function namedHit(
  raw: string,
  via: DwellPlaceHit['via'],
  confidence: number,
  poiId?: number | null,
): DwellPlaceHit | null {
  const title = simplifyPlaceName(raw);
  if (!title || isVaguePlaceLabel(title)) return null;
  if (/straße|strasse|weg|allee|platz/i.test(title) && title.length < 8) {
    return null;
  }
  return { title, confidence, via, poiId: poiId ?? null };
}

async function resolveOsmPlace(
  lat: number,
  lng: number,
): Promise<{ place: DwellPlaceHit | null; address: DwellPlaceHit | null }> {
  let place: DwellPlaceHit | null = null;
  let address: DwellPlaceHit | null = null;

  try {
    const hits = await searchOsmPlacesNearby({
      lat,
      lng,
      placeType: 'dwell',
      radiusM: 45,
    });
    const best = hits[0];
    if (best?.name && best.distanceM <= 40) {
      place = namedHit(best.name, 'osm', 0.88);
    }
  } catch {
    /* soft */
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const u = new URL('https://nominatim.openstreetmap.org/reverse');
    u.searchParams.set('lat', String(lat));
    u.searchParams.set('lon', String(lng));
    u.searchParams.set('format', 'jsonv2');
    u.searchParams.set('addressdetails', '1');
    u.searchParams.set('zoom', '18');
    const res = await fetch(u.toString(), {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'FindusApp/1.0 (dwell-timeline)' },
    });
    if (res.ok) {
      const data = (await res.json()) as {
        name?: string;
        address?: Addr;
      };
      const addr = data.address;
      const placeHint = Boolean(
        addr?.amenity || addr?.tourism || addr?.shop || addr?.leisure,
      );
      const named = (data.name || '').trim();
      if (!place && named && placeHint) {
        place = namedHit(named, 'osm', 0.82);
      }
      const street = streetFromAddr(addr);
      if (street) {
        address = {
          title: formatStreetPin(street.street, street.nr),
          confidence: 0.55,
          via: 'address',
        };
      }
    }
  } catch {
    /* soft */
  } finally {
    clearTimeout(timer);
  }

  return { place, address };
}

async function resolveGooglePlace(
  lat: number,
  lng: number,
): Promise<{ place: DwellPlaceHit | null; address: DwellPlaceHit | null }> {
  if (!hasGoogleMapsNavKey()) return { place: null, address: null };
  let place: DwellPlaceHit | null = null;
  let address: DwellPlaceHit | null = null;

  // Places Nearby — nächster benannter Ort
  const ctrlN = new AbortController();
  const timerN = setTimeout(() => ctrlN.abort(), FETCH_MS);
  try {
    const u = new URL(PLACES_NEARBY);
    u.searchParams.set('location', `${lat},${lng}`);
    u.searchParams.set('rankby', 'distance');
    u.searchParams.set('language', 'de');
    u.searchParams.set('key', mapsKey());
    const data = await fetchJson(u.toString(), ctrlN.signal);
    const results =
      (data?.results as Array<{
        name?: string;
        vicinity?: string;
        types?: string[];
        geometry?: { location?: { lat?: number; lng?: number } };
      }>) ?? [];
    for (const r of results.slice(0, 6)) {
      const plat = r.geometry?.location?.lat;
      const plng = r.geometry?.location?.lng;
      if (plat == null || plng == null) continue;
      if (haversineMeters(lat, lng, plat, plng) > 50) continue;
      const types = r.types ?? [];
      if (types.includes('route') || types.includes('political')) continue;
      const hit = namedHit(r.name || '', 'google', 0.84);
      if (hit) {
        place = hit;
        break;
      }
    }
  } catch {
    /* soft */
  } finally {
    clearTimeout(timerN);
  }

  // Geocode → establishment oder Straße+Nr.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const u = new URL(GEOCODE);
    u.searchParams.set('latlng', `${lat},${lng}`);
    u.searchParams.set('language', 'de');
    u.searchParams.set('key', mapsKey());
    const data = await fetchJson(u.toString(), ctrl.signal);
    const results =
      (data?.results as Array<{
        formatted_address?: string;
        types?: string[];
        address_components?: Array<{
          long_name?: string;
          types?: string[];
        }>;
      }>) ?? [];

    if (!place) {
      const placeTypes = new Set([
        'point_of_interest',
        'establishment',
        'premise',
        'tourist_attraction',
        'store',
        'restaurant',
        'cafe',
        'bar',
        'museum',
        'park',
        'church',
      ]);
      for (const r of results) {
        if (!(r.types ?? []).some((t) => placeTypes.has(t))) continue;
        const nameComp = r.address_components?.find((c) =>
          c.types?.some((t) => placeTypes.has(t) || t === 'premise'),
        );
        const raw =
          nameComp?.long_name?.trim() ||
          r.formatted_address?.split(',')[0]?.trim() ||
          '';
        const hit = namedHit(raw, 'google', 0.8);
        if (hit) {
          place = hit;
          break;
        }
      }
    }

    for (const r of results) {
      const comps = r.address_components ?? [];
      const route = comps.find((c) => c.types?.includes('route'))?.long_name;
      const nr = comps.find((c) => c.types?.includes('street_number'))
        ?.long_name;
      if (route) {
        address = {
          title: formatStreetPin(route, nr),
          confidence: 0.5,
          via: 'address',
        };
        break;
      }
    }
  } catch {
    /* soft */
  } finally {
    clearTimeout(timer);
  }

  return { place, address };
}

async function resolvePackPoi(
  lat: number,
  lng: number,
): Promise<DwellPlaceHit | null> {
  try {
    const pois = await getAllPois();
    let best: { id: number; name: string; d: number } | null = null;
    for (const p of pois) {
      if (p.kind === 'approach') continue;
      const d = haversineMeters(lat, lng, p.lat, p.lng);
      if (d > 35) continue;
      if (!best || d < best.d) best = { id: p.id, name: p.name, d };
    }
    if (best) {
      return namedHit(best.name, 'pack', 0.95, best.id);
    }
  } catch {
    /* soft */
  }
  return null;
}

/**
 * OSM → Google → 📍 Straße+Hausnummer.
 * Nie vage Labels wie „hier in der Gegend“.
 */
export async function resolveDwellPlace(
  lat: number,
  lng: number,
): Promise<DwellPlaceHit> {
  const pack = await resolvePackPoi(lat, lng);
  if (pack) return pack;

  const osm = await resolveOsmPlace(lat, lng);
  if (osm.place) return osm.place;

  const google = await resolveGooglePlace(lat, lng);
  if (google.place) return google.place;

  if (google.address) return google.address;
  if (osm.address) return osm.address;

  return {
    title: formatStreetPin('Unbekannte Straße'),
    confidence: 0.2,
    via: 'address',
  };
}
