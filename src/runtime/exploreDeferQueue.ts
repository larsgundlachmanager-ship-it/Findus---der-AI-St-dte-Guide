/**
 * Modul-1 Cooldown-Defer: nicht permanent skippen.
 * Nach cooldownEnde + 3s einmal re-checken — noch im Radius → triggern.
 */

import { haversineMeters } from '../db/database';
import { getTriggerSession } from './triggerEngine';

export const EXPLORE_DEFER_RECHECK_EXTRA_MS = 3_000;

type DeferredExplore = {
  poiId: number;
  lat: number;
  lng: number;
  radiusM: number;
  readyAtMs: number;
  reason: string;
};

let pending: DeferredExplore | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let fireHandler:
  | ((poiId: number) => void | Promise<void>)
  | null = null;

export function registerExploreDeferHandler(
  handler: (poiId: number) => void | Promise<void>,
): void {
  fireHandler = handler;
}

export function clearExploreDefer(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  pending = null;
}

/**
 * Plant einen Recheck. Ersetzt älteren Pending für denselben POI.
 */
export function scheduleExploreDefer(opts: {
  poiId: number;
  lat: number;
  lng: number;
  radiusM: number;
  cooldownRemainingMs: number;
  reason: string;
}): void {
  const readyAtMs =
    Date.now() +
    Math.max(0, opts.cooldownRemainingMs) +
    EXPLORE_DEFER_RECHECK_EXTRA_MS;

  if (
    pending?.poiId === opts.poiId &&
    pending.readyAtMs <= readyAtMs + 50 &&
    pending.readyAtMs >= readyAtMs - 50
  ) {
    return;
  }

  if (timer) clearTimeout(timer);
  pending = {
    poiId: opts.poiId,
    lat: opts.lat,
    lng: opts.lng,
    radiusM: Math.max(20, opts.radiusM),
    readyAtMs,
    reason: opts.reason,
  };

  const wait = Math.max(0, readyAtMs - Date.now());
  timer = setTimeout(() => {
    void flushExploreDefer();
  }, wait);
}

async function flushExploreDefer(): Promise<void> {
  timer = null;
  const job = pending;
  pending = null;
  if (!job || !fireHandler) return;

  const sess = getTriggerSession();
  const lat = sess.lastLat;
  const lng = sess.lastLng;
  if (lat == null || lng == null) return;

  const d = haversineMeters(lat, lng, job.lat, job.lng);
  if (d > job.radiusM) {
    if (__DEV__) {
      console.log(
        `[explore-defer] drop #${job.poiId} — left radius (${Math.round(d)}m > ${job.radiusM}m, was ${job.reason})`,
      );
    }
    return;
  }

  if (__DEV__) {
    console.log(
      `[explore-defer] re-fire #${job.poiId} after ${job.reason}`,
    );
  }
  try {
    await fireHandler(job.poiId);
  } catch (err) {
    console.warn('[explore-defer] fire failed:', err);
  }
}

export function getPendingExploreDefer(): DeferredExplore | null {
  return pending;
}
