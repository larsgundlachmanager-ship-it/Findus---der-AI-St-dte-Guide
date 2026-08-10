/**
 * Single commit path: resolve → progressive route → immediate km/ETA → landmarks async.
 */

import { useFinnusStore } from '../../../store/useFinnusStore';
import type { PedestrianTravelMode } from '../googleMapsNav';
import {
  resolveAndStartNavigation,
  type NavStartResult,
  type NavTargetInput,
} from '../resolveNavTarget';
import { scanRouteObstaclesWithFallback } from '../routeObstacleScan';
import { fetchProgressiveRoute } from './routeEngine';
import { resolveStartLandmark, polishAllTurnsOsmFirst } from './landmarks';
import { resetHandsFreeEta } from './eta';
import { resetCueScheduler } from './cueScheduler';
import { resetHandsFreeCompass } from './compass';

export type ProgressiveStartMeta = {
  distanceM: number;
  etaMin: number;
  startLandmark: string | null;
};

let lastProgressiveMeta: ProgressiveStartMeta | null = null;
let polishEpoch = 0;

export function getLastProgressiveStartMeta(): ProgressiveStartMeta | null {
  return lastProgressiveMeta;
}

/** One commit auto-start path for explicit nav intents. */
export async function commitHandsFreeNavStart(
  input: NavTargetInput,
  opts?: { skipClosingGate?: boolean; offlineOnly?: boolean },
): Promise<NavStartResult> {
  resetCueScheduler();
  resetHandsFreeCompass();
  resetHandsFreeEta('walk');
  return resolveAndStartNavigation(input, opts);
}

/**
 * Progressive enrich: OSRM → km/ETA on store → start landmark → OSM polish async.
 */
export async function progressiveEnrichRoute(opts: {
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  destinationName: string;
  travelMode?: PedestrianTravelMode;
}): Promise<{
  waypoints: import('../navigationTypes').NavWaypoint[];
  stations: import('../navigationTypes').NavWaypoint[];
  travelMode: PedestrianTravelMode;
  walkingDistanceM: number;
  etaMin: number;
} | null> {
  const myEpoch = ++polishEpoch;

  const progressive = await fetchProgressiveRoute({
    originLat: opts.originLat,
    originLng: opts.originLng,
    destLat: opts.destLat,
    destLng: opts.destLng,
    travelMode: opts.travelMode,
    lightBufferMin: 0,
  });
  if (!progressive || myEpoch !== polishEpoch) return null;

  resetHandsFreeEta(progressive.travelMode === 'bicycling' ? 'bike' : 'walk');

  const startLandmark = await resolveStartLandmark({
    lat: opts.originLat,
    lng: opts.originLng,
  });
  if (startLandmark && progressive.waypoints[0]) {
    progressive.waypoints[0] = {
      ...progressive.waypoints[0],
      landmark: startLandmark,
      visibleLandmark: startLandmark,
    };
  }

  lastProgressiveMeta = {
    distanceM: progressive.distanceM,
    etaMin: progressive.etaMin,
    startLandmark,
  };

  useFinnusStore.setState({
    navTotalDistanceM: progressive.distanceM,
    navDistanceM: progressive.distanceM,
    navEtaMin: progressive.etaMin,
  });

  void (async () => {
    try {
      await polishAllTurnsOsmFirst({
        dense: progressive.waypoints,
        raw: progressive.rawTurnWaypoints,
        isCancelled: () => myEpoch !== polishEpoch,
      });
      if (myEpoch !== polishEpoch) return;

      const obstacles = await scanRouteObstaclesWithFallback({
        points: progressive.pathPoints,
        instructions: progressive.rawTurnWaypoints.map((w) => w.instruction),
      });
      if (myEpoch !== polishEpoch) return;
      const lights = obstacles.bufferMin ?? 0;
      if (lights > 0) {
        const etaMin = Math.max(1, progressive.etaMin + lights);
        lastProgressiveMeta = {
          distanceM: progressive.distanceM,
          etaMin,
          startLandmark,
        };
        useFinnusStore.setState({ navEtaMin: etaMin });
      }
    } catch (err) {
      if (__DEV__) console.warn('[handsFree] async polish failed', err);
    }
  })();

  return {
    waypoints: progressive.waypoints,
    stations: progressive.stations,
    travelMode: progressive.travelMode,
    walkingDistanceM: progressive.distanceM,
    etaMin: progressive.etaMin,
  };
}
