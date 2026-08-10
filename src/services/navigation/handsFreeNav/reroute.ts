/**
 * Silent OSRM reroute — no Places burst; reuse progressive route engine.
 */

import type { PedestrianTravelMode } from '../googleMapsNav';
import { isDeviceOffline } from '../networkState';
import { fetchProgressiveRoute, type ProgressiveRouteResult } from './routeEngine';

export async function silentOsrmReroute(opts: {
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  travelMode?: PedestrianTravelMode;
}): Promise<ProgressiveRouteResult | null> {
  if (await isDeviceOffline()) return null;
  return fetchProgressiveRoute({
    originLat: opts.originLat,
    originLng: opts.originLng,
    destLat: opts.destLat,
    destLng: opts.destLng,
    travelMode: opts.travelMode,
  });
}
