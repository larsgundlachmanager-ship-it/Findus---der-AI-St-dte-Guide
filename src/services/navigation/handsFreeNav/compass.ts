/**
 * Adaptive compass: snappy on real turns (°/s), stable when standing.
 * Pocket / screen-off → heading watch should be disabled (caller).
 *
 * Do NOT snap on absolute ~12° sample jumps — magnetometer noise does that
 * left/right while idle and caused the needle to twitch.
 */

import { HeadingLowPass } from '../sensorFilter';

/** Standing baseline — HeadingLowPass raises this via angular rate. */
const ALPHA_STAND = 0.14;
/** Walking: slightly livelier tracking of phone turns. */
const ALPHA_WALK = 0.28;

let filter = new HeadingLowPass(ALPHA_STAND);
let lastPushAtMs = 0;
/** Extra hold while standing — suppress magnetometer chatter before UI. */
let lastEmittedDeg: number | null = null;
let lastEmitAtMs = 0;

export function resetHandsFreeCompass(): void {
  filter = new HeadingLowPass(ALPHA_STAND);
  lastPushAtMs = 0;
  lastEmittedDeg = null;
  lastEmitAtMs = 0;
}

/**
 * Push device heading. Returns filtered deg.
 * Rate-aware: fast body turns catch up immediately; L↔R noise is held.
 */
export function pushAdaptiveHeading(
  rawDeg: number,
  opts?: { speedMps?: number | null; nowMs?: number },
): number {
  const now = opts?.nowMs ?? Date.now();
  const raw = ((rawDeg % 360) + 360) % 360;
  const speed = opts?.speedMps ?? 0;
  filter.setAlpha(speed >= 0.4 ? ALPHA_WALK : ALPHA_STAND);
  const v = filter.push(raw, now);
  lastPushAtMs = now;

  // Standing: don't emit micro-twitches to the map (≤4° / <180 ms)
  if (speed < 0.35 && lastEmittedDeg != null) {
    let d = Math.abs(v - lastEmittedDeg);
    if (d > 180) d = 360 - d;
    if (d < 4 && now - lastEmitAtMs < 180) {
      return lastEmittedDeg;
    }
  }
  lastEmittedDeg = v;
  lastEmitAtMs = now;
  return v;
}

export function getLastHeadingPushAgeMs(nowMs = Date.now()): number {
  return lastPushAtMs ? nowMs - lastPushAtMs : Number.POSITIVE_INFINITY;
}

/**
 * Heuristic: phone likely in pocket / nav UI not useful for compass.
 * Callers should stop watchHeadingAsync when true.
 */
export function shouldDisableCompassWatch(opts: {
  screenInteractive: boolean;
  appStateActive: boolean;
  /** Device roughly flat + face down / in pocket from orientation if available */
  pocketLikely?: boolean;
}): boolean {
  if (!opts.appStateActive) return true;
  if (!opts.screenInteractive) return true;
  if (opts.pocketLikely) return true;
  return false;
}
