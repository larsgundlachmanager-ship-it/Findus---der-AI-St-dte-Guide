/**
 * Offline-Suche für Orte + Adressen — dasselbe Index für Tastatur und Sprache.
 * Pack-POIs (Name, Kategorie, Review-Facetten) und Extract-Hausnummern.
 * Kein RN-Import — Smoke-Tests laufen in Node.
 */

import type { Poi } from '../../db/types';
import { inferGastroFacetTags } from '../../module2/pitch/gastroFacetTags';
import { parseStreetHouseQuery } from '../navigation/streetAddressQuery';

export type CitySearchHit = {
  kind: 'poi' | 'address';
  id?: number;
  name: string;
  subtitle?: string;
  lat: number;
  lng: number;
};

export type CityHousenumber = {
  lat: number;
  lng: number;
  n: string;
  s?: string;
};

function foldStreet(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/\bstra(?:ss|ß)e\b/g, 'str')
    .replace(/\bstr\.\b/g, 'str')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function houseKey(n: string): string {
  return n.replace(/\s+/g, '').toLowerCase();
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

function poiHaystack(poi: Poi): string {
  const name = (poi.name ?? '').replace(/\s*[·•|]\s*Wegweiser\s*$/i, '');
  let tags = '';
  try {
    const parsed = JSON.parse(poi.tags_json || '[]') as unknown;
    if (Array.isArray(parsed)) tags = parsed.map(String).join(' ');
    else if (parsed && typeof parsed === 'object') tags = JSON.stringify(parsed);
  } catch {
    tags = poi.tags_json || '';
  }
  const facets = inferGastroFacetTags(name, `${poi.category || ''} ${tags} ${poi.teaser_text || ''}`);
  return `${name} ${poi.category ?? ''} ${tags} ${poi.teaser_text ?? ''} ${facets.join(' ')}`.toLowerCase();
}

function streetMatches(want: string, have: string): boolean {
  const a = foldStreet(want);
  const b = foldStreet(have);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const at = a.split(' ').filter((t) => t.length > 2);
  const bt = b.split(' ').filter((t) => t.length > 2);
  if (!at.length || !bt.length) return false;
  return at.every((t) => bt.some((x) => x.includes(t) || t.includes(x)));
}

function searchAddresses(
  query: string,
  housenumbers: CityHousenumber[],
  origin: { lat: number; lng: number } | null,
  limit: number,
): CitySearchHit[] {
  const house = parseStreetHouseQuery(query);
  if (!house || !housenumbers.length) return [];
  const wantN = houseKey(house.housenumber);
  const scored: Array<CitySearchHit & { d: number }> = [];
  for (const row of housenumbers) {
    if (houseKey(row.n) !== wantN) continue;
    const street = (row.s || '').trim();
    if (street && !streetMatches(house.street, street)) continue;
    if (!street) continue;
    const name = `${street} ${row.n}`.trim();
    const d = origin ? metersBetween(origin, row) : 0;
    scored.push({
      kind: 'address',
      name,
      lat: row.lat,
      lng: row.lng,
      d,
    });
  }
  scored.sort((a, b) => a.d - b.d);
  return scored.slice(0, limit).map(({ d: _d, ...hit }) => hit);
}

function searchPois(
  query: string,
  pois: Poi[],
  origin: { lat: number; lng: number } | null,
  limit: number,
): CitySearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const house = parseStreetHouseQuery(query);
  const scored: Array<CitySearchHit & { d: number; rank: number }> = [];
  for (const poi of pois) {
    if (!Number.isFinite(poi.lat) || !Number.isFinite(poi.lng)) continue;
    const name = (poi.name ?? '').replace(/\s*[·•|]\s*Wegweiser\s*$/i, '').trim();
    const hay = poiHaystack(poi);
    let rank = 0;
    if (house) {
      const n = house.housenumber.toLowerCase();
      const street = house.street.toLowerCase();
      if (
        hay.includes(`${street} ${n}`) ||
        (hay.includes(street) && new RegExp(`\\b${n}\\b`, 'i').test(hay))
      ) {
        rank = 8;
      }
    } else if (name.toLowerCase() === q) {
      rank = 10;
    } else if (name.toLowerCase().includes(q)) {
      rank = 7;
    } else if (hay.includes(q)) {
      rank = 5;
    }
    if (!rank) continue;
    const d = origin ? metersBetween(origin, poi) : 0;
    scored.push({
      kind: 'poi',
      id: poi.id,
      name,
      lat: poi.lat,
      lng: poi.lng,
      d,
      rank,
    });
  }
  scored.sort((a, b) => b.rank - a.rank || a.d - b.d);
  return scored.slice(0, limit).map(({ d: _d, rank: _r, ...hit }) => hit);
}

export function searchCityIndex(opts: {
  query: string;
  pois?: Poi[];
  housenumbers?: CityHousenumber[] | null;
  origin?: { lat: number; lng: number } | null;
  limit?: number;
}): CitySearchHit[] {
  const query = (opts.query || '').replace(/\s+/g, ' ').trim();
  if (query.length < 2) return [];
  const limit = opts.limit ?? 12;
  const origin = opts.origin ?? null;
  const addresses = searchAddresses(
    query,
    opts.housenumbers || [],
    origin,
    limit,
  );
  if (addresses.length) return addresses.slice(0, limit);
  return searchPois(query, opts.pois || [], origin, limit);
}

export function lookupOfflineAddress(
  query: string,
  housenumbers?: CityHousenumber[] | null,
  origin?: { lat: number; lng: number } | null,
): CitySearchHit | null {
  const hits = searchCityIndex({
    query,
    pois: [],
    housenumbers,
    origin,
    limit: 1,
  });
  return hits[0]?.kind === 'address' ? hits[0] : null;
}
