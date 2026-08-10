/**
 * Modul 3 — Navigation Core (Phase 6).
 * Ziel → OSM first → Google Fallback
 * Route + Landmarken (Offline-DB → Street View)
 * Multi-Stop: Drag&Drop, Löschen, sofortige Reihenfolge
 */

import { getCachedUserProfile } from '../services/userProfileService';
import { useFinnusStore } from '../store/useFinnusStore';
import {
  fetchNearbyPlaceLandmarks,
  fetchRouteDirectionsResult,
  fetchStreetViewImageBase64,
  geocodePlaceNameOsmFirst,
  type GeocodeResult,
  type PedestrianTravelMode,
  type PlaceLandmark,
  type RouteDirectionsResult,
} from '../services/navigation/googleMapsNav';
import { getCachedGeocodeForNav } from '../services/navigation/landmarkCache';
import { lookupCachedDestinationByName } from '../services/navigation/offlineNavCache';
import { isDeviceOffline } from '../services/navigation/networkState';
import {
  resolveExistingPoiId,
  type NavStartResult,
  type NavTargetInput,
} from '../services/navigation/resolveNavTarget';
import { commitHandsFreeNavStart } from '../services/navigation/handsFreeNav';
import { stopNavigation } from '../services/navigation/navigationService';
import {
  advanceMultiStopTour,
  navigateToTourStopAt,
  removeTourStopAt,
  reorderTourStops,
  type MultiStopTour,
} from '../services/navigation/multiStopTour';

export type NavDestinationSource =
  | 'local_poi'
  | 'offline_cache'
  | 'osm'
  | 'google'
  | 'coords';

export type NavDestinationResolution = {
  lat: number;
  lng: number;
  label: string;
  source: NavDestinationSource;
};

export type NavRoutePlanResult = RouteDirectionsResult & {
  /** Which routing tier produced the result. */
  provider: 'osm' | 'google';
};

function biasFromStore(): {
  biasLat?: number;
  biasLng?: number;
  cityHint?: string | null;
} {
  const store = useFinnusStore.getState();
  const profile = getCachedUserProfile();
  return {
    biasLat: store.lastGpsLat ?? undefined,
    biasLng: store.lastGpsLng ?? undefined,
    cityHint: profile?.cityName ?? profile?.cityId ?? null,
  };
}

/** Resolve destination without starting nav — offline cache → local POI → OSM → Google. */
export async function resolveDestination(
  input: NavTargetInput,
): Promise<NavDestinationResolution | null> {
  const name = (input.name ?? '').trim();
  if (
    typeof input.lat === 'number' &&
    typeof input.lng === 'number' &&
    Number.isFinite(input.lat) &&
    Number.isFinite(input.lng)
  ) {
    return {
      lat: input.lat,
      lng: input.lng,
      label: name || 'Ziel',
      source: 'coords',
    };
  }

  const poiId = await resolveExistingPoiId(input.poiId ?? undefined);
  if (poiId != null) {
    const { getPoiWithFacts } = await import('../db/database');
    const poi = await getPoiWithFacts(poiId);
    if (poi) {
      return {
        lat: poi.lat,
        lng: poi.lng,
        label: poi.name,
        source: 'local_poi',
      };
    }
  }

  if (name.length >= 2) {
    const offline = await isDeviceOffline();
    if (offline) {
      const cached = await lookupCachedDestinationByName(name);
      if (cached) {
        return {
          lat: cached.lat,
          lng: cached.lng,
          label: cached.name,
          source: 'offline_cache',
        };
      }
      const geo = await getCachedGeocodeForNav(name);
      if (geo) {
        return {
          lat: geo.lat,
          lng: geo.lng,
          label: geo.label,
          source: 'offline_cache',
        };
      }
      return null;
    }

    const geo = await geocodePlaceNameOsmFirst(name, biasFromStore());
    if (geo) {
      return {
        lat: geo.lat,
        lng: geo.lng,
        label: geo.label,
        source: inferGeocodeSource(geo),
      };
    }
  }

  return null;
}

function inferGeocodeSource(_geo: GeocodeResult): NavDestinationSource {
  // geocodePlaceNameOsmFirst prefers Nominatim; we treat successful online hits as osm-first policy.
  return 'osm';
}

/** OSRM (OSM) primary → Google fallback for walking/bicycling. */
export async function planPedestrianRoute(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  mode: PedestrianTravelMode = 'walking',
): Promise<NavRoutePlanResult | null> {
  const result = await fetchRouteDirectionsResult(origin, destination, mode);
  if (!result) return null;
  return {
    ...result,
    provider: mode === 'transit' ? 'google' : 'osm',
  };
}

/** Local SQLite landmark cache → OSM Overpass → Google Places. */
export async function resolveLandmarksNear(
  lat: number,
  lng: number,
  radiusM = 55,
): Promise<PlaceLandmark[]> {
  return fetchNearbyPlaceLandmarks(lat, lng, radiusM);
}

/** Local Street View cache (6 months) → one-time Google fetch on miss. */
export async function resolveStreetViewForHeading(
  lat: number,
  lng: number,
  headingDeg: number,
): Promise<string | null> {
  return fetchStreetViewImageBase64(lat, lng, headingDeg);
}

/** Unified nav start — Hands-Free commit path. */
export async function startNavCore(
  input: NavTargetInput,
  opts?: { skipClosingGate?: boolean; offlineOnly?: boolean },
): Promise<NavStartResult> {
  return commitHandsFreeNavStart(input, opts);
}

export async function stopNavCore(opts?: { silent?: boolean }): Promise<void> {
  await stopNavigation(opts);
}

/** Multi-stop: reorder with immediate nav restart when active stop moved. */
export async function reorderMultiStop(
  fromIndex: number,
  toIndex: number,
): Promise<MultiStopTour | null> {
  const tour = useFinnusStore.getState().multiStopTour;
  if (!tour) return null;
  const wasCurrent = fromIndex === tour.currentIndex;
  const next = reorderTourStops(fromIndex, toIndex);
  if (wasCurrent && next) {
    await navigateToTourStopAt(toIndex);
  }
  return next;
}

/** Multi-stop: remove stop; restart nav when active stop removed. */
export async function removeMultiStopAt(
  index: number,
): Promise<MultiStopTour | null> {
  const tour = useFinnusStore.getState().multiStopTour;
  if (!tour) return null;
  const wasCurrent = index === tour.currentIndex;
  const wasActiveNav =
    useFinnusStore.getState().navActive &&
    tour.stops[index]?.name === useFinnusStore.getState().navTargetName;
  const next = removeTourStopAt(index);
  if ((wasCurrent || wasActiveNav) && next && next.stops.length > 0) {
    await navigateToTourStopAt(next.currentIndex);
  }
  return next;
}

export async function activateMultiStopAt(index: number): Promise<boolean> {
  return navigateToTourStopAt(index);
}

export async function advanceMultiStopCore(): Promise<boolean> {
  return advanceMultiStopTour();
}
