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
  // Adress-Query: Pack-Orte nicht als Treffer (Geocode/Hausnummer ist SSOT).
  if (house) return false;
  return hay.includes(q);
}

function houseKey(n: string): string {
  return n.replace(/\s+/g, '').toLowerCase();
}

function nominatimViewbox(lat: number, lng: number, tight = false): string {
  const dLat = tight ? 0.08 : 0.06;
  const dLng = tight ? 0.14 : 0.1;
  return `${lng - dLng},${lat + dLat},${lng + dLng},${lat - dLat}`;
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

async function searchNominatimMany(
  query: string,
  opts: {
    lat?: number | null;
    lng?: number | null;
    cityHint?: string | null;
    unstructured?: boolean;
    /** Straße+Nr.: nicht in andere Stadt springen */
    forceLocal?: boolean;
  },
): Promise<PlaceSeekRemoteHit[]> {
  const q = query.replace(/\s+/g, ' ').trim();
  if (q.length < 3) return [];
  const house = opts.unstructured ? null : parseStreetHouseQuery(q);
  const hasGps =
    typeof opts.lat === 'number' &&
    typeof opts.lng === 'number' &&
    Number.isFinite(opts.lat) &&
    Number.isFinite(opts.lng);
  const withCity =
    opts.cityHint && !q.toLowerCase().includes(opts.cityHint.toLowerCase())
      ? `${q}, ${opts.cityHint}`
      : q;
  const u = new URL('https://nominatim.openstreetmap.org/search');
  u.searchParams.set('format', 'json');
  u.searchParams.set('limit', '6');
  u.searchParams.set('addressdetails', '1');
  u.searchParams.set('countrycodes', 'de');
  // Mit GPS: Straße+Nr. lokal suchen — cityHint allein darf nicht in andere Stadt ziehen.
  if (house && opts.cityHint && !hasGps) {
    u.searchParams.set('street', `${house.housenumber} ${house.street}`);
    u.searchParams.set('city', opts.cityHint);
  } else {
    u.searchParams.set('q', withCity);
  }
  if (hasGps) {
    const tight = Boolean(house) || opts.forceLocal === true;
    u.searchParams.set('viewbox', nominatimViewbox(opts.lat!, opts.lng!, tight));
    // Adresse: hart im Umkreis — sonst springt Nominatim zur gleichnamigen Straße woanders.
    u.searchParams.set('bounded', house || opts.forceLocal ? '1' : '0');
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
      if (house && nr && houseKey(nr) !== houseKey(house.housenumber)) continue;
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
    // Bounded leer → weicher Fallback, aber nur Treffer nah am GPS (< 25 km).
    if (house && out.length === 0 && hasGps && u.searchParams.get('bounded') === '1') {
      const softUrl = new URL('https://nominatim.openstreetmap.org/search');
      softUrl.searchParams.set('format', 'json');
      softUrl.searchParams.set('limit', '6');
      softUrl.searchParams.set('addressdetails', '1');
      softUrl.searchParams.set('countrycodes', 'de');
      softUrl.searchParams.set('q', withCity);
      softUrl.searchParams.set(
        'viewbox',
        nominatimViewbox(opts.lat!, opts.lng!, true),
      );
      softUrl.searchParams.set('bounded', '0');
      try {
        const softRes = await fetch(softUrl.toString(), {
          signal: ctrl.signal,
          headers: {
            Accept: 'application/json',
            'User-Agent': 'FindusNav/2.0 (tourist walking guide)',
          },
        });
        if (!softRes.ok) return [];
        const softRows = (await softRes.json()) as Array<{
          lat?: string;
          lon?: string;
          display_name?: string;
          address?: { house_number?: string; road?: string };
        }>;
        for (const row of softRows) {
          const lat = row.lat != null ? Number(row.lat) : NaN;
          const lng = row.lon != null ? Number(row.lon) : NaN;
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
          if (metersBetween({ lat: opts.lat!, lng: opts.lng! }, { lat, lng }) >= 25_000) {
            continue;
          }
          const road = row.address?.road?.trim();
          const nr = row.address?.house_number?.trim();
          if (house && nr && houseKey(nr) !== houseKey(house.housenumber)) continue;
          const label = (row.display_name ?? q).trim();
          out.push({
            name:
              house && (nr || house.housenumber)
                ? `${road || house.street} ${nr || house.housenumber}`
                : label.split(',')[0]?.trim() || q,
            subtitle: label,
            lat,
            lng,
            source: 'address',
          });
        }
      } catch {
        return [];
      }
    }
    if (hasGps && house && out.length > 1) {
      out.sort(
        (a, b) =>
          metersBetween({ lat: opts.lat!, lng: opts.lng! }, a) -
          metersBetween({ lat: opts.lat!, lng: opts.lng! }, b),
      );
    }
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function amenitySeekRadiusM(q: string): number {
  if (/briefkasten|packstation|postfiliale|parcel.?locker|post_box/i.test(q)) {
    return 4_000;
  }
  return 18_000;
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
  // Straße+Nr. ohne lokalen Treffer → trotzdem Geocode (kein Pack-Laden).
  if (looksLikeStreetAddress(q)) return true;
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
  const asAddress = looksLikeStreetAddress(q);
  const tasks: Array<Promise<PlaceSeekRemoteHit[]>> = [
    searchNominatimMany(q, { ...opts, forceLocal: asAddress }),
  ];
  // Straße+Hausnummer: nie Google Places (sonst „nächster Laden“ statt Punkt).
  if (
    !asAddress &&
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
          const radiusM = amenitySeekRadiusM(q);
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
      if (asAddress) {
        if (a.source === 'address' && b.source !== 'address') return -1;
        if (b.source === 'address' && a.source !== 'address') return 1;
      }
      return metersBetween(origin, a) - metersBetween(origin, b);
    });
  } else if (asAddress) {
    merged.sort((a, b) => (a.source === 'address' ? -1 : 1) - (b.source === 'address' ? -1 : 1));
  }
  return merged.slice(0, 12);
}
