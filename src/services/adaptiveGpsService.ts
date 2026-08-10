/**
 * Adaptive GPS-Frequenz — Battery Saver Engine:
 * - >500 m from next WP → far (15 s)
 * - <100 m from next WP → realtime (1 s)
 * - Pedometer sleep handled separately (2 min stillness)
 */

import {
  getGpsStreamProfile,
  setGpsStreamProfile,
  type GpsStreamProfile,
} from './locationService';
import { getAllPois } from '../db/database';
import { useFinnusStore } from '../store/useFinnusStore';
import { isGpsDeepSleeping } from './battery/pedometerSleep';

/** Spec: <100 m → 1 s polling */
const NEAR_TRIGGER_M = 100;
/** Spec: >500 m → 15 s throttle */
const FAR_TRIGGER_M = 500;

function haversineM(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

let lastNearestM: number | null = null;
let lastComputeAt = 0;
const COMPUTE_EVERY_MS = 4_000;

/** Distanz zum nächsten ungesprochenen POI / Nav-Ziel (Cache ~4s). */
export async function distanceToNearestTriggerM(
  lat: number,
  lng: number,
): Promise<number | null> {
  const now = Date.now();
  if (lastNearestM != null && now - lastComputeAt < COMPUTE_EVERY_MS) {
    return lastNearestM;
  }
  lastComputeAt = now;
  try {
    const store = useFinnusStore.getState();
    let best = Infinity;

    // Active nav target distance takes priority
    if (
      store.navActive &&
      typeof store.navDistanceM === 'number' &&
      Number.isFinite(store.navDistanceM)
    ) {
      best = Math.min(best, store.navDistanceM);
    }
    if (
      store.navActive &&
      typeof store.navLegDistanceM === 'number' &&
      Number.isFinite(store.navLegDistanceM)
    ) {
      best = Math.min(best, store.navLegDistanceM);
    }

    const pois = await getAllPois();
    for (const p of pois) {
      if (p.kind === 'approach') continue;
      const d = haversineM(lat, lng, p.lat, p.lng);
      if (d < best) best = d;
    }
    lastNearestM = Number.isFinite(best) ? best : null;
    return lastNearestM;
  } catch {
    return lastNearestM;
  }
}

/**
 * Wählt realtime / far / economy / throttled.
 * Respects pedometer deep-sleep (does not override while sleeping).
 */
export async function updateAdaptiveGpsProfile(opts: {
  lat: number;
  lng: number;
  speedMs?: number | null;
  audioBusy?: boolean;
}): Promise<GpsStreamProfile> {
  if (isGpsDeepSleeping()) {
    return 'sleep';
  }

  const store = useFinnusStore.getState();

  let next: GpsStreamProfile = 'economy';

  if (opts.audioBusy || store.isPlayingAudio) {
    // Während Story: GPS drosseln
    next = 'throttled';
  } else if (store.navActive) {
    // Nur Navigation: scharfe Profile (BestForNavigation im locationService)
    const dist = await distanceToNearestTriggerM(opts.lat, opts.lng);
    if (dist != null && dist > FAR_TRIGGER_M) {
      next = 'far';
    } else if (dist != null && dist <= NEAR_TRIGGER_M) {
      next = 'realtime';
    } else {
      next = 'economy';
    }
  } else {
    // Free-Roam: sparsam — realtime nur nahe am nächsten POI (Geofence)
    const dist = await distanceToNearestTriggerM(opts.lat, opts.lng);
    if (dist != null && dist <= NEAR_TRIGGER_M) {
      next = 'realtime';
    } else if (dist != null && dist > FAR_TRIGGER_M) {
      next = 'far';
    } else {
      next = 'economy';
    }
  }

  if (getGpsStreamProfile() !== next) {
    await setGpsStreamProfile(next);
  }
  return next;
}
