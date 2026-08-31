/**
 * GPS → aktive Stadt für Concierge/Geofencing (nicht Profil-Stadt).
 */

import {
  listKnownCityCoverageBounds,
  smallestCityIdContainingPoint,
  resolveCityCoverageBoundsSync,
} from '../discovery/cityCoverageBounds';
import { peekCityIndexCache } from '../cityCatalogService';

export function resolveCityIdFromGps(
  lat: number | null | undefined,
  lng: number | null | undefined,
): string | null {
  if (lat == null || lng == null) return null;
  const known = listKnownCityCoverageBounds();
  const hit = smallestCityIdContainingPoint(lat, lng, known);
  if (hit) return hit.toLowerCase();
  return null;
}

export function resolveCityNameFromGps(
  lat: number | null | undefined,
  lng: number | null | undefined,
): string | null {
  const id = resolveCityIdFromGps(lat, lng);
  if (!id) return null;
  const bounds = resolveCityCoverageBoundsSync(id);
  if (bounds?.name) return bounds.name;
  const idx = peekCityIndexCache() ?? [];
  const row = idx.find((c) => c.id.trim().toLowerCase() === id);
  return row?.name ?? id;
}
