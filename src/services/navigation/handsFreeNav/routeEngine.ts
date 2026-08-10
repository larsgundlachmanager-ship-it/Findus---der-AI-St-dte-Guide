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

export async function fetchProgressiveRoute(opts: {
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
  });

  const raw = directionsToWaypoints(route.steps);
  const stations = transitStopsToNavWaypoints(route.stations ?? []);

  const pathPoints =
    route.pathPoints?.length >= 2
      ? route.pathPoints
      : [
          { lat: opts.originLat, lng: opts.originLng },
          ...raw.map((w) => ({ lat: w.lat, lng: w.lng })),
          { lat: opts.destLat, lng: opts.destLng },
        ];

  const spline = buildRouteSpline(
    route.overviewPolyline,
    pathPoints,
    raw,
    SPLINE_SPACING_M,
  );
  const dense = splineToNavWaypoints(spline);

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
