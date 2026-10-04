/**
 * Homescreen / Stempelkarte: wie viele Erkunden-Orte der **aktiven Stadt**
 * gesehen + % der Stadt-Fläche — stadt-scoped, ID-Wechsel-sicher via lat/lng.
 */

import type { Poi } from '../../db/types';
import type { VisitedPlaceMemory } from '../ai/sessionMemory';
import { getCachedUserProfile } from '../userProfileService';
import { isCityExploreMapPoi } from '../navigation/stampMapModul1';
import { computeAreaCoverage } from './areaCoverageService';
import {
  cityContainsPoint,
  pointInCityBounds,
  resolveCityCoverageBoundsSync,
} from './cityCoverageBounds';
import {
  isCityExplorePlaceSeen,
} from './cityExploreVisitMatch';
import type { WalkTrackPoint } from './walkTrackService';
import { spotKeyBelongsToCity } from '../cityPack/cityLocalStorage';

export {
  CITY_EXPLORE_VISIT_MATCH_M,
  isCityExplorePlaceSeen,
  visitedPoiIdsForActiveCity,
} from './cityExploreVisitMatch';

export type CityExploreProgress = {
  seenPlaces: number;
  totalPlaces: number;
  placePercent: number;
  areaPercent: number;
  cityName: string | null;
  cityId: string | null;
  line: string;
};

/**
 * Story-POI gehört zur aktiven Stadt.
 * 1) spot_key-Prefix (Danzig-Reste zählen nie zu Prisdorf)
 * 2) sonst Coverage-Bounds (ältere Keys ohne Stadt-Prefix)
 */
function poiInActiveCity(
  p: Poi,
  cityId: string | null,
  bounds: ReturnType<typeof resolveCityCoverageBoundsSync>,
): boolean {
  const key = String(p.spot_key ?? '').trim().toLowerCase();
  if (cityId && key) {
    return spotKeyBelongsToCity(p.spot_key, cityId);
  }
  if (!bounds) return true;
  // Polygon wenn da, sonst BBox — leicht gepaddet für Rand-Stories.
  if (bounds.polygon && bounds.polygon.length >= 3) {
    if (cityContainsPoint(p.lat, p.lng, bounds)) return true;
    // ~400 m Pad: Arboretum o. ä. knapp außerhalb der Verwaltungsgrenze.
    const padLat = 400 / 111_320;
    const padLng =
      400 / (111_320 * Math.max(0.2, Math.cos((p.lat * Math.PI) / 180)));
    return (
      p.lat >= bounds.latMin - padLat &&
      p.lat <= bounds.latMax + padLat &&
      p.lng >= bounds.lngMin - padLng &&
      p.lng <= bounds.lngMax + padLng
    );
  }
  return pointInCityBounds(p.lat, p.lng, bounds);
}


/** Wenn Profile-cityId fehlt: Mehrheit der Spot-Key-Prefixe (prisdorf_…). */
function inferCityIdFromPois(pois: Poi[]): string | null {
  const counts = new Map<string, number>();
  for (const p of pois) {
    const k = String(p.spot_key ?? '').trim().toLowerCase();
    const m = /^([a-z][a-z0-9]*)[_:]/.exec(k);
    if (!m) continue;
    counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [id, n] of counts) {
    if (n > bestN) {
      best = id;
      bestN = n;
    }
  }
  return bestN >= 5 ? best : null;
}

export function computeCityExploreProgress(opts: {
  pois: Poi[];
  /** Bevorzugt: volle Stempelhistorie (stadt-scoped Matching). */
  visitedHistory?: readonly VisitedPlaceMemory[];
  /** @deprecated Nur noch Fallback — mischt Städte bei ID-Kollision. */
  visitedPoiIds?: ReadonlySet<number>;
  walkTrack?: WalkTrackPoint[];
  userLoc?: { lat: number; lng: number } | null;
  cityId?: string | null;
}): CityExploreProgress {
  const profile = getCachedUserProfile();
  const fromOpts = (opts.cityId ?? '').trim().toLowerCase();
  const fromProfile = (profile?.cityId ?? '').trim().toLowerCase();
  // Profile/Opts zuerst — sonst Prefix aus Store (verhindert 94 Danzig bei leerem cityId).
  const cityId =
    fromOpts ||
    fromProfile ||
    inferCityIdFromPois(opts.pois) ||
    null;
  const bounds = resolveCityCoverageBoundsSync(cityId);

  const explore = opts.pois.filter(
    (p) => isCityExploreMapPoi(p) && poiInActiveCity(p, cityId, bounds),
  );

  const totalPlaces = explore.length;
  const history = opts.visitedHistory;
  const seenPlaces =
    history != null
      ? explore.filter((p) =>
          isCityExplorePlaceSeen(p, history, { cityId, bounds }),
        ).length
      : explore.filter((p) => opts.visitedPoiIds?.has(p.id)).length;
  const placePercent =
    totalPlaces > 0
      ? Math.min(100, Math.round((seenPlaces / totalPlaces) * 100))
      : 0;

  const area = computeAreaCoverage({
    pois: opts.pois,
    walkTrack: opts.walkTrack,
    userLoc: opts.userLoc ?? null,
  });

  const cityName = area.cityName ?? bounds?.name ?? profile?.cityName ?? null;
  const areaPercent = area.percent;
  // Chip-% = Fog-Fläche (Stories allein ≠ 100 %)
  const displayPercent = areaPercent;

  const placesPart =
    totalPlaces > 0
      ? `${seenPlaces} von ${totalPlaces} Orten`
      : seenPlaces > 0
        ? `${seenPlaces} Orte`
        : null;
  const areaPart = `${displayPercent} % erkundet`;
  const line = placesPart ? `${placesPart} · ${areaPart}` : areaPart;

  return {
    seenPlaces,
    totalPlaces,
    placePercent,
    areaPercent,
    cityName,
    cityId,
    line,
  };
}
