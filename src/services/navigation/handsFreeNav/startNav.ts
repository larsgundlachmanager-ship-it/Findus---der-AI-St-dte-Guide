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
let polishDestKey = '';

export function getLastProgressiveStartMeta(): ProgressiveStartMeta | null {
  return lastProgressiveMeta;
}

/** User-Stop: laufendes Progressive-Enrich / Polish killen. */
export function invalidateProgressiveNavEnrich(): void {
  polishEpoch += 1;
  polishDestKey = '';
  lastProgressiveMeta = null;
}

/** One commit auto-start path for explicit nav intents. */
export async function commitHandsFreeNavStart(
  input: NavTargetInput,
  opts?: {
    skipClosingGate?: boolean;
    offlineOnly?: boolean;
    skipDestVerify?: boolean;
    replaceRoute?: boolean;
    addStop?: boolean;
  },
): Promise<NavStartResult> {
  if (!opts?.addStop) {
    resetCueScheduler();
    resetHandsFreeCompass();
    resetHandsFreeEta('walk');
  }
  try {
    useFinnusStore.getState().setNavRouteLoading(true);
    useFinnusStore.getState().setIsGenerating(true);
  } catch {
    useFinnusStore.setState({ navRouteLoading: true, isGenerating: true });
  }
  try {
    const res = await resolveAndStartNavigation(input, opts);
    return res;
  } finally {
    try {
      useFinnusStore.getState().setIsGenerating(false);
      const st = useFinnusStore.getState();
      if (!st.navActive) st.setNavRouteLoading(false);
    } catch {
      useFinnusStore.setState({ isGenerating: false });
      const st = useFinnusStore.getState();
      if (!st.navActive) {
        useFinnusStore.setState({ navRouteLoading: false });
      }
    }
  }
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
  // Gleiches Ziel: Epoch nicht erhöhen — sonst killt Background-Retry den laufenden FOSSGIS-Call.
  const destKey = `${opts.destLat.toFixed(5)},${opts.destLng.toFixed(5)}`;
  if (destKey !== polishDestKey) {
    polishDestKey = destKey;
    polishEpoch += 1;
  }
  const myEpoch = polishEpoch;

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

  // Landmark / POI-DB nie auf dem kritischen Pfad — Straße + km/ETA sofort.
  lastProgressiveMeta = {
    distanceM: progressive.distanceM,
    etaMin: progressive.etaMin,
    startLandmark: null,
  };

  useFinnusStore.setState({
    navTotalDistanceM: progressive.distanceM,
    navDistanceM: progressive.distanceM,
    navEtaMin: progressive.etaMin,
  });

  // Karte sofort — nicht warten auf Landmark-Polish / Enrich-Commit (sonst HUD mit ETA, Linie fehlt).
  try {
    const { seedActiveNavRoute } = require('../navigationService') as {
      seedActiveNavRoute: (o: {
        waypoints: typeof progressive.waypoints;
        walkingDistanceM?: number;
      }) => boolean;
    };
    seedActiveNavRoute({
      waypoints: progressive.waypoints,
      walkingDistanceM: progressive.distanceM,
    });
  } catch {
    /* soft */
  }

  void resolveStartLandmark({
    lat: opts.originLat,
    lng: opts.originLng,
  }).then((startLandmark) => {
    if (myEpoch !== polishEpoch || !startLandmark) return;
    if (progressive.waypoints[0]) {
      progressive.waypoints[0] = {
        ...progressive.waypoints[0],
        landmark: startLandmark,
        visibleLandmark: startLandmark,
      };
    }
    lastProgressiveMeta = {
      distanceM: progressive.distanceM,
      etaMin: lastProgressiveMeta?.etaMin ?? progressive.etaMin,
      startLandmark,
    };
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
          startLandmark: lastProgressiveMeta?.startLandmark ?? null,
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

/** Invalidiert laufendes Fuß/Rad-Enrich (z. B. wenn ÖPNV übernimmt). */
export function bumpProgressiveEnrichEpoch(): void {
  polishEpoch += 1;
  polishDestKey = '';
}
