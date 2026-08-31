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
  resolveCityCoverageBoundsSync,
} from './cityCoverageBounds';
import {
  isCityExplorePlaceSeen,
} from './cityExploreVisitMatch';
import type { WalkTrackPoint } from './walkTrackService';

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
  const cityId =
    (opts.cityId ?? profile?.cityId ?? '').toLowerCase() || null;
  const bounds = resolveCityCoverageBoundsSync(cityId);

  const explore = opts.pois.filter((p) => isCityExploreMapPoi(p));
  // Alle Story-Orte der geladenen Stadt zählen — auch Ausreißer außerhalb
  // der Coverage-Box (z. B. Arboretum / Pinneberg bei Prisdorf).
  // Bounds nur für Besuch-Matching (siehe isCityExplorePlaceSeen).

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
