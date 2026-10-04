/**
 * Während der ÖPNV-Fahrt: Live-Ausstiegs-ETA in Tour-Stop schreiben → Timeline.
 */

import { useFinnusStore } from '../../store/useFinnusStore';
import {
  applyLiveAlightArriveToStops,
  estimateLiveRideEtaSec,
} from '../transit/liveJourneyAdapt';
import { getNavPhase } from './boardingDetector';

let lastSyncAtMs = 0;
let lastArriveMs: number | null = null;

export function resetLiveRideEtaSync(): void {
  lastSyncAtMs = 0;
  lastArriveMs = null;
}

/**
 * Aktualisiert aktuellen alight-Stop (endMs / duration / hint) aus Distanz+Speed.
 * Spätere Bus-Abfahrten bleiben; Wartezeit auf der Timeline folgt daraus.
 */
export function syncLiveRideEtaToTour(opts: {
  nowMs?: number;
  distanceM?: number | null;
  speedMs?: number | null;
  remainingStations?: number | null;
  force?: boolean;
}): boolean {
  const now = opts.nowMs ?? Date.now();
  try {
    const phase = getNavPhase();
    if (phase !== 'in_transit' && phase !== 'walk_to_stop') return false;
  } catch {
    return false;
  }
  const st = useFinnusStore.getState();
  const tour = st.multiStopTour;
  if (!tour?.stops?.length) return false;
  const idx = tour.currentIndex ?? 0;
  const cur = tour.stops[idx];
  if (!cur || cur.role !== 'alight') return false;

  const etaSec = estimateLiveRideEtaSec({
    distanceM: opts.distanceM ?? st.navDistanceM,
    speedMs: opts.speedMs,
    remainingStations: opts.remainingStations,
    durationSec: cur.durationSec ?? null,
    stationCount: cur.stationCount ?? null,
    line: cur.line ?? null,
  });
  if (etaSec == null) return false;

  const arriveMs = now + etaSec * 1000;
  if (
    !opts.force &&
    lastSyncAtMs > 0 &&
    now - lastSyncAtMs < 18_000 &&
    lastArriveMs != null &&
    Math.abs(arriveMs - lastArriveMs) < 35_000
  ) {
    return false;
  }

  const patched = applyLiveAlightArriveToStops(tour.stops, {
    currentIndex: idx,
    liveAlightArriveMs: arriveMs,
    nowMs: now,
    minDeltaMs: opts.force ? 20_000 : 40_000,
  });
  if (!patched) return false;

  lastSyncAtMs = now;
  lastArriveMs = patched.arriveMs;

  const plannedArriveByMs =
    tour.liveMeta?.plannedArriveByMs != null &&
    Number.isFinite(tour.liveMeta.plannedArriveByMs) &&
    patched.deltaMs !== 0
      ? tour.liveMeta.plannedArriveByMs + patched.deltaMs
      : tour.liveMeta?.plannedArriveByMs ?? null;

  st.setMultiStopTour({
    ...tour,
    stops: patched.stops,
    liveMeta: tour.liveMeta
      ? {
          ...tour.liveMeta,
          plannedArriveByMs,
        }
      : tour.liveMeta,
  });

  try {
    const { upsertLiveNavFromStore } = require('../../module2/timeline/syncLiveNavToPlan') as {
      upsertLiveNavFromStore: (o?: { force?: boolean }) => void;
    };
    upsertLiveNavFromStore({ force: true });
  } catch {
    /* soft */
  }
  return true;
}
