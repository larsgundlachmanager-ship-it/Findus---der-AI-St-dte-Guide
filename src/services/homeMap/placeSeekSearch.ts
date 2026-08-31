/**
 * Orte-Suche: Pack-Treffer + Adressen (Nominatim) + Nearby-Places.
 * Kein RN-Import — in Smoke-Tests nutzbar.
 */

import type { Poi } from '../../db/types';
import {
  looksLikeStreetAddress,
  parseStreetHouseQuery,
} from '../navigation/streetAddressQuery';

export type PlaceSeekRemoteHit = {
  name: string;
  subtitle: string;
  lat: number;
  lng: number;
  source: 'address' | 'web';
};

export { looksLikeStreetAddress };

export function poiMatchesSeekQuery(poi: Poi, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return true;
  const name = (poi.name ?? '').replace(/\s*[·•|]\s*Wegweiser\s*$/i, '');
  const hay = `${name} ${poi.category ?? ''} ${poi.tags_json ?? ''} ${poi.teaser_text ?? ''}`.toLowerCase();
  const house = parseStreetHouseQuery(query);
  if (house) {
    const n = house.housenumber.toLowerCase();
    const street = house.street.toLowerCase();
    return (
      hay.includes(`${street} ${n}`) ||
      (hay.includes(street) && new RegExp(`\\b${n}\\b`, 'i').test(hay))
    );
  }
  return hay.includes(q);
}

function nominatimViewbox(lat: number, lng: number): string {
  const dLat = 0.06;
  const dLng = 0.1;
  return `${lng - dLng},${lat + dLat},${lng + dLng},${lat - dLat}`;
}

async function searchNominatimMany(
  query: string,
  opts: {
    lat?: number | null;
    lng?: number | null;
    cityHint?: string | null;
    unstructured?: boolean;
  },
): Promise<PlaceSeekRemoteHit[]> {
  const q = query.replace(/\s+/g, ' ').trim();
  if (q.length < 3) return [];
  const house = opts.unstructured ? null : parseStreetHouseQuery(q);
  const withCity =
    opts.cityHint && !q.toLowerCase().includes(opts.cityHint.toLowerCase())
      ? `${q}, ${opts.cityHint}`
      : q;
  const u = new URL('https://nominatim.openstreetmap.org/search');
  u.searchParams.set('format', 'json');
  u.searchParams.set('limit', '6');
  u.searchParams.set('addressdetails', '1');
  u.searchParams.set('countrycodes', 'de');
  if (house && opts.cityHint) {
    u.searchParams.set('street', `${house.housenumber} ${house.street}`);
    u.searchParams.set('city', opts.cityHint);
  } else {
    u.searchParams.set('q', withCity);
  }
  if (
    typeof opts.lat === 'number' &&
    typeof opts.lng === 'number' &&
    Number.isFinite(opts.lat) &&
    Number.isFinite(opts.lng)
  ) {
    u.searchParams.set('viewbox', nominatimViewbox(opts.lat, opts.lng));
    u.searchParams.set('bounded', '0');
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    const res = await fetch(u.toString(), {
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'FindusNav/2.0 (tourist walking guide)',
      },
    });
    if (!res.ok) return [];
    const rows = (await res.json()) as Array<{
      lat?: string;
      lon?: string;
      display_name?: string;
      address?: { house_number?: string; road?: string };
    }>;
    const out: PlaceSeekRemoteHit[] = [];
    for (const row of rows) {
      const lat = row.lat != null ? Number(row.lat) : NaN;
      const lng = row.lon != null ? Number(row.lon) : NaN;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const road = row.address?.road?.trim();
      const nr = row.address?.house_number?.trim();
      const label = (row.display_name ?? q).trim();
      const name =
        house && (nr || house.housenumber)
          ? `${road || house.street} ${nr || house.housenumber}`
          : label.split(',')[0]?.trim() || q;
      out.push({
        name,
        subtitle: label,
        lat,
        lng,
        source: 'address',
      });
    }
    if (house && out.length === 0 && u.searchParams.has('street')) {
      return searchNominatimMany(q, { ...opts, unstructured: true });
    }
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function amenitySeekRadiusM(q: string, asAddress: boolean): number {
  if (/briefkasten|packstation|postfiliale|parcel.?locker|post_box/i.test(q)) {
    return 4_000;
  }
  return asAddress ? 8_000 : 18_000;
}

function metersBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = (a.lat - b.lat) * 111_320;
  const dLng =
    (a.lng - b.lng) * 111_320 * Math.cos(((a.lat + b.lat) * 0.5 * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

export function formatSeekDistanceM(m: number): string {
  if (!Number.isFinite(m) || m < 0) return '';
  if (m < 1000) return `${Math.round(m)} m`;
  const km = m / 1000;
  return `${km.toFixed(km >= 10 ? 0 : 1).replace('.', ',')} km`;
}

function nearDup(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  meters = 45,
): boolean {
  return metersBetween(a, b) <= meters;
}

export function shouldFetchPlaceSeekRemote(opts: {
  query: string;
  localHits: number;
  hasAddressHit: boolean;
}): boolean {
  const q = opts.query.replace(/\s+/g, ' ').trim();
  if (q.length < 3) return false;
  if (opts.hasAddressHit) return false;
  if (opts.localHits > 0) return false;
  return true;
}

/** Adressen + Web-Places zum Eintippen (Hotel, Lasertag, Franzbrötchen…). */
export async function fetchPlaceSeekRemote(
  query: string,
  opts: {
    lat?: number | null;
    lng?: number | null;
    cityHint?: string | null;
  },
): Promise<PlaceSeekRemoteHit[]> {
  const q = query.replace(/\s+/g, ' ').trim();
  if (q.length < 3) return [];
  const lat = opts.lat;
  const lng = opts.lng;
  const tasks: Array<Promise<PlaceSeekRemoteHit[]>> = [
    searchNominatimMany(q, opts),
  ];
  if (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
  ) {
    tasks.push(
      (async () => {
        try {
          const { searchPlacesByText } = await import(
            '../navigation/googleMapsNav'
          );
          const origin = { lat, lng };
          const radiusM = amenitySeekRadiusM(q, looksLikeStreetAddress(q));
          const places = await searchPlacesByText({
            query: q,
            lat,
            lng,
            radiusM,
          });
          return places
            .slice()
            .sort((a, b) => a.distanceM - b.distanceM)
            .slice(0, 10)
            .map((p) => ({
              name: p.name,
              subtitle: formatSeekDistanceM(
                Number.isFinite(p.distanceM)
                  ? p.distanceM
                  : metersBetween(origin, p),
              ),
              lat: p.lat,
              lng: p.lng,
              source: 'web' as const,
            }));
        } catch {
          return [];
        }
      })(),
    );
  }
  const bags = await Promise.all(tasks);
  const merged: PlaceSeekRemoteHit[] = [];
  for (const bag of bags) {
    for (const hit of bag) {
      if (merged.some((m) => nearDup(m, hit))) continue;
      merged.push(hit);
    }
  }
  const origin =
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
      ? { lat, lng }
      : null;
  if (origin) {
    for (const hit of merged) {
      const m = metersBetween(origin, hit);
      const dist = formatSeekDistanceM(m);
      if (dist && (!hit.subtitle || hit.subtitle === 'Gefunden' || hit.source === 'address')) {
        hit.subtitle = dist;
      } else if (dist && hit.subtitle && !/\d+\s*(m|km)\b/i.test(hit.subtitle)) {
        hit.subtitle = `${dist} · ${hit.subtitle}`;
      }
    }
    merged.sort((a, b) => {
      if (looksLikeStreetAddress(q)) {
        if (a.source === 'address' && b.source !== 'address') return -1;
        if (b.source === 'address' && a.source !== 'address') return 1;
      }
      return metersBetween(origin, a) - metersBetween(origin, b);
    });
  } else if (looksLikeStreetAddress(q)) {
    merged.sort((a, b) => (a.source === 'address' ? -1 : 1) - (b.source === 'address' ? -1 : 1));
  }
  return merged.slice(0, 12);
}
