/**
 * Adaptive GPS-Frequenz: Akku sparen im Free-Roam zu Fuß,
 * hochschalten wenn Trigger nah oder Tempo hoch / Navigation aktiv.
 */

import {
  getGpsStreamProfile,
  setGpsStreamProfile,
  type GpsStreamProfile,
} from './locationService';
import { getAllPois } from '../db/database';
import { useFinnusStore } from '../store/useFinnusStore';

const WALK_MAX_MS = 2.2; // ~8 km/h
const NEAR_TRIGGER_M = 90;
const APPROACH_TRIGGER_M = 220;

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

/** Distanz zum nächsten ungesprochenen POI (Cache ~4s). */
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
    const pois = await getAllPois();
    let best = Infinity;
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
 * Wählt realtime / economy / throttled.
 * Fuß + weit vom nächsten Punkt → economy (~4s).
 * Nah / schnell / Nav → sofort realtime.
 */
export async function updateAdaptiveGpsProfile(opts: {
  lat: number;
  lng: number;
  speedMs?: number | null;
  audioBusy?: boolean;
}): Promise<GpsStreamProfile> {
  const store = useFinnusStore.getState();
  const speed =
    typeof opts.speedMs === 'number' && Number.isFinite(opts.speedMs)
      ? opts.speedMs
      : null;

  let next: GpsStreamProfile = 'realtime';

  if (opts.audioBusy || store.isPlayingAudio) {
    next = 'throttled';
  } else if (store.navActive) {
    next = 'realtime';
  } else if (speed != null && speed > WALK_MAX_MS) {
    next = 'realtime';
  } else {
    const dist = await distanceToNearestTriggerM(opts.lat, opts.lng);
    if (dist != null && dist <= NEAR_TRIGGER_M) {
      next = 'realtime';
    } else if (dist != null && dist <= APPROACH_TRIGGER_M) {
      next = 'realtime';
    } else if (speed == null || speed <= WALK_MAX_MS) {
      next = 'economy';
    } else {
      next = 'realtime';
    }
  }

  if (getGpsStreamProfile() !== next) {
    await setGpsStreamProfile(next);
  }
  return next;
}
