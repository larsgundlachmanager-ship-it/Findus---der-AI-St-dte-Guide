/**
 * Adaptive GPS polling — Speed-Leiter (gpsCadence) + Trigger-Skip.
 */

import type { GpsPollPolicy, GpsSample } from './types';
import {
  gpsCadenceReason,
  gpsIntervalMsForSpeedMs,
  kmhFromSpeedMs,
} from './gpsCadence';

const MS_WALK = 1.25;
const MS_BIKE = 4.5;

export type GpsPolicyInput = {
  sample: GpsSample;
  nearestTriggerDistM: number | null;
  transportMode: 'walk' | 'bicycle' | 'transit' | 'unknown';
  tightUrbanHint?: boolean;
};

/**
 * GPS-Intervall nur nach Tempo. Distanz zum POI darf nicht 15–30 s erzwingen.
 */
export function resolveGpsPollPolicy(input: GpsPolicyInput): GpsPollPolicy {
  const speed = Math.max(0, input.sample.speedMs ?? 0);
  const kmh = kmhFromSpeedMs(speed);
  return {
    intervalMs: gpsIntervalMsForSpeedMs(speed),
    reason: gpsCadenceReason(kmh),
  };
}

/**
 * If user is too fast to realistically stop, skip firing (not hardcoded POI types).
 */
/** ≥ 50 km/h → Modul-1 Hard-Skip (Auto/Bahn). */
export const MODULE1_HARD_SKIP_SPEED_MS = 50 / 3.6;

export function shouldSkipTriggerForSpeed(input: {
  speedMs: number;
  triggerRadiusM: number;
  transportMode: 'walk' | 'bicycle' | 'transit' | 'unknown';
}): boolean {
  if (input.transportMode === 'transit') return false;
  const speed = Math.max(0, input.speedMs);
  // Reboot: ab 50 km/h nie Ortsstories / Wegweiser
  if (speed >= MODULE1_HARD_SKIP_SPEED_MS) return true;
  if (input.transportMode === 'bicycle' || speed >= MS_BIKE) {
    // ~2s reaction + stop distance heuristic
    const passThroughM = speed * 2.5;
    return passThroughM > input.triggerRadiusM * 1.8;
  }
  return false;
}
