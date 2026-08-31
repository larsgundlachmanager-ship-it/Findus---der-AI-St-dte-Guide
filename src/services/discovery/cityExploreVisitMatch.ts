/**
 * Stadt-scoped Stempel↔POI-Match für Explore-Progress.
 * Pure (kein Expo/SQLite) — überlebt Pack-ID-Remap via lat/lng + cityId.
 */

import type { Poi } from '../../db/types';
import type { VisitedPlaceMemory } from '../ai/sessionMemory';

export type CityVisitMatchBounds = {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
};

/** Stempel↔POI-Match (wie Stempelkarte) — überlebt Pack-ID-Remap. */
export const CITY_EXPLORE_VISIT_MATCH_M = 80;

function approxMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = (lat2 - lat1) * 111_320;
  const dLng =
    (lng2 - lng1) * 111_320 * Math.cos(((lat1 + lat2) * 0.5 * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

function pointInBounds(
  lat: number,
  lng: number,
  b: CityVisitMatchBounds,
): boolean {
  return (
    lat >= b.latMin && lat <= b.latMax && lng >= b.lngMin && lng <= b.lngMax
  );
}

function normalizePlaceName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[„“"']/g, '')
    .trim();
}

function namesRoughlyMatch(a: string, b: string): boolean {
  const na = normalizePlaceName(a);
  const nb = normalizePlaceName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function stampInActiveCity(
  e: VisitedPlaceMemory,
  cityId: string | null,
  bounds: CityVisitMatchBounds | null,
): boolean {
  const stampCity = (e.cityId ?? '').trim().toLowerCase();
  if (stampCity) {
    if (!cityId) return false;
    return stampCity === cityId;
  }
  const lat = e.lat;
  const lng = e.lng;
  if (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
  ) {
    if (bounds) return pointInBounds(lat, lng, bounds);
    return true;
  }
  return true;
}

/**
 * Ob ein Erkunden-POI der aktiven Stadt als besucht gilt.
 * Primär: Stempel in dieser Stadt + Nähe (lat/lng) — nicht nur globale poiId.
 */
export function isCityExplorePlaceSeen(
  poi: Poi,
  visited: readonly VisitedPlaceMemory[],
  opts: {
    cityId: string | null;
    bounds: CityVisitMatchBounds | null;
  },
): boolean {
  const cityId = (opts.cityId ?? '').trim().toLowerCase() || null;
  const bounds = opts.bounds;

  for (const e of visited) {
    if (!stampInActiveCity(e, cityId, bounds)) continue;

    const lat = e.lat;
    const lng = e.lng;
    const hasCoords =
      typeof lat === 'number' &&
      typeof lng === 'number' &&
      Number.isFinite(lat) &&
      Number.isFinite(lng);

    if (hasCoords) {
      if (approxMeters(lat, lng, poi.lat, poi.lng) <= CITY_EXPLORE_VISIT_MATCH_M) {
        return true;
      }
      continue;
    }

    if (e.poiId !== poi.id) continue;
    const stampCity = (e.cityId ?? '').trim().toLowerCase();
    if (stampCity && cityId && stampCity === cityId) return true;
    if (!stampCity && namesRoughlyMatch(e.name, poi.name)) return true;
  }
  return false;
}

export function visitedPoiIdsForActiveCity(
  pois: readonly Poi[],
  visited: readonly VisitedPlaceMemory[],
  opts: { cityId: string | null; bounds: CityVisitMatchBounds | null },
): Set<number> {
  const ids = new Set<number>();
  for (const p of pois) {
    if (isCityExplorePlaceSeen(p, visited, opts)) ids.add(p.id);
  }
  return ids;
}
