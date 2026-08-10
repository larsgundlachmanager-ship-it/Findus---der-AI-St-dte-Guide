/**
 * Adaptive compass: snappy when rotating fast, damped when slow.
 * Pocket / screen-off → heading watch should be disabled (caller).
 */

import { HeadingLowPass } from '../sensorFilter';
import { shortestAngleDelta } from '../bearing';

/** Higher alpha = snappier. */
const ALPHA_FAST = 0.88;
const ALPHA_SLOW = 0.42;
const SNAP_ABS_DEG = 22;

let filter = new HeadingLowPass(ALPHA_FAST);
let lastRaw: number | null = null;
let lastPushAtMs = 0;

export function resetHandsFreeCompass(): void {
  filter = new HeadingLowPass(ALPHA_FAST);
  lastRaw = null;
  lastPushAtMs = 0;
}

/**
 * Push device heading. Returns filtered deg.
 * Large intentional turns snap quickly; micro jitter is damped.
 */
export function pushAdaptiveHeading(
  rawDeg: number,
  opts?: { speedMps?: number | null; nowMs?: number },
): number {
  const now = opts?.nowMs ?? Date.now();
  const raw = ((rawDeg % 360) + 360) % 360;
  const speed = opts?.speedMps ?? 0;

  if (lastRaw != null) {
    const delta = Math.abs(shortestAngleDelta(lastRaw, raw));
    if (delta >= SNAP_ABS_DEG) {
      // Intentional body turn — almost raw
      filter = new HeadingLowPass(ALPHA_FAST);
      const v = filter.push(raw);
      lastRaw = raw;
      lastPushAtMs = now;
      return v;
    }
    // Slow / pocket jitter
    const slow = speed < 0.4;
    filter = new HeadingLowPass(slow ? ALPHA_SLOW : ALPHA_FAST);
  }

  const v = filter.push(raw);
  lastRaw = raw;
  lastPushAtMs = now;
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
