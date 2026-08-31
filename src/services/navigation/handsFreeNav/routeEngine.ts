/**
 * Hands-free route engine — OSRM primary, Google emergency only.
 */

import {
  fetchRouteDirectionsResult,
  walkingDistanceFromSteps,
  directionsToWaypoints,
  transitStopsToNavWaypoints,
  type PedestrianTravelMode,
  type RouteDirectionsResult,
} from '../googleMapsNav';
import { buildRouteSpline, splineToNavWaypoints, SPLINE_SPACING_M } from '../routeSpline';
import type { NavWaypoint } from '../navigationTypes';
import { initialEtaFromRoutedDistanceM } from './eta';

export type ProgressiveRouteResult = {
  distanceM: number;
  etaMin: number;
  waypoints: NavWaypoint[];
  stations: NavWaypoint[];
  travelMode: PedestrianTravelMode;
  overviewPolyline: string | null;
  pathPoints: Array<{ lat: number; lng: number }>;
  rawTurnWaypoints: NavWaypoint[];
};

/** Map-Tap seed + enrich teilen denselben FOSSGIS-Call (kein Doppel-Request). */
const inflightProgressive = new Map<
  string,
  Promise<ProgressiveRouteResult | null>
>();
const recentProgressive = new Map<
  string,
  { at: number; result: ProgressiveRouteResult | null }
>();
const PROGRESSIVE_CACHE_MS = 20_000;

function progressiveRouteKey(opts: {
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  travelMode?: PedestrianTravelMode;
}): string {
  const mode =
    opts.travelMode === 'bicycling' || opts.travelMode === 'transit'
      ? opts.travelMode
      : 'walking';
  return `${mode}:${opts.originLat.toFixed(5)},${opts.originLng.toFixed(5)}>${opts.destLat.toFixed(5)},${opts.destLng.toFixed(5)}`;
}

export async function fetchProgressiveRoute(opts: {
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  travelMode?: PedestrianTravelMode;
  lightBufferMin?: number;
}): Promise<ProgressiveRouteResult | null> {
  const key = progressiveRouteKey(opts);
  const cached = recentProgressive.get(key);
  if (cached && Date.now() - cached.at < PROGRESSIVE_CACHE_MS) {
    return cached.result;
  }
  const hit = inflightProgressive.get(key);
  if (hit) return hit;

  const pending = fetchProgressiveRouteUncached(opts).then((result) => {
    recentProgressive.set(key, { at: Date.now(), result });
    return result;
  });
  inflightProgressive.set(key, pending);
  void pending.finally(() => {
    if (inflightProgressive.get(key) === pending) {
      inflightProgressive.delete(key);
    }
  });
  return pending;
}

async function fetchProgressiveRouteUncached(opts: {
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  travelMode?: PedestrianTravelMode;
  lightBufferMin?: number;
}): Promise<ProgressiveRouteResult | null> {
  const mode: PedestrianTravelMode =
    opts.travelMode === 'bicycling' || opts.travelMode === 'transit'
      ? opts.travelMode
      : 'walking';

  const route: RouteDirectionsResult | null = await fetchRouteDirectionsResult(
    { lat: opts.originLat, lng: opts.originLng },
    { lat: opts.destLat, lng: opts.destLng },
    mode,
  );
  if (!route?.steps?.length) return null;

  const distanceM = walkingDistanceFromSteps(route.steps);
  const etaMin = initialEtaFromRoutedDistanceM(distanceM, {
    isBike: mode === 'bicycling',
    lightBufferMin: opts.lightBufferMin,
    providerDurationSec: route.durationSec ?? null,
  });

  const raw = directionsToWaypoints(route.steps);
  const stations = transitStopsToNavWaypoints(route.stations ?? []);

  const pathPointsRaw =
    route.pathPoints?.length >= 2
      ? route.pathPoints
      : [
          { lat: opts.originLat, lng: opts.originLng },
          ...raw.map((w) => ({ lat: w.lat, lng: w.lng })),
          { lat: opts.destLat, lng: opts.destLng },
        ];
  // Route muss am echten Ziel enden (nicht irgendwo in der Stadt)
  const pathPoints = pathPointsRaw.slice();
  const last = pathPoints[pathPoints.length - 1];
  if (
    !last ||
    Math.abs(last.lat - opts.destLat) > 1e-5 ||
    Math.abs(last.lng - opts.destLng) > 1e-5
  ) {
    const endDist = last
      ? Math.hypot(
          (last.lat - opts.destLat) * 111_320,
          (last.lng - opts.destLng) *
            111_320 *
            Math.cos((opts.destLat * Math.PI) / 180),
        )
      : Number.POSITIVE_INFINITY;
    if (endDist > 25) {
      pathPoints.push({ lat: opts.destLat, lng: opts.destLng });
    }
  }

  const spline = buildRouteSpline(
    route.overviewPolyline,
    pathPoints,
    raw,
    SPLINE_SPACING_M,
  );
  let dense = splineToNavWaypoints(spline);
  // Letzter Micro-WP = Zielkoordinate
  if (dense.length >= 1) {
    const tip = dense[dense.length - 1]!;
    const tipDist = Math.hypot(
      (tip.lat - opts.destLat) * 111_320,
      (tip.lng - opts.destLng) *
        111_320 *
        Math.cos((opts.destLat * Math.PI) / 180),
    );
    if (tipDist > 12) {
      dense = [
        ...dense,
        {
          lat: opts.destLat,
          lng: opts.destLng,
          maneuver: 'arrive',
          roadName: null,
          landmark: null,
          cue: null,
          instruction: null,
          isStation: false,
          splineAlongM:
            (typeof tip.splineAlongM === 'number' ? tip.splineAlongM : 0) +
            tipDist,
        },
      ];
    } else {
      dense = [
        ...dense.slice(0, -1),
        { ...tip, lat: opts.destLat, lng: opts.destLng, maneuver: 'arrive' },
      ];
    }
  }

  return {
    distanceM,
    etaMin,
    waypoints: dense.length >= 2 ? dense : raw,
    stations,
    travelMode: route.travelMode ?? mode,
    overviewPolyline: route.overviewPolyline ?? null,
    pathPoints,
    rawTurnWaypoints: raw,
  };
}
