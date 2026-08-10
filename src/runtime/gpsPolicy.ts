/**
 * Adaptive GPS polling — bike vs foot, density, speed.
 * No hardcoded trigger examples; purely kinematic + proximity heuristics.
 */

import type { GpsPollPolicy, GpsSample } from './types';

const MS_WALK = 1.25;
const MS_BIKE = 4.5;
const MS_FAST = 8.0;

export type GpsPolicyInput = {
  sample: GpsSample;
  nearestTriggerDistM: number | null;
  transportMode: 'walk' | 'bicycle' | 'transit' | 'unknown';
  tightUrbanHint?: boolean;
};

/**
 * Far from triggers on bike → slow poll (30s).
 * Tight alleys / fast / near trigger → 1s.
 * Normal foot → 3–5s.
 */
export function resolveGpsPollPolicy(input: GpsPolicyInput): GpsPollPolicy {
  const speed = Math.max(0, input.sample.speedMs ?? 0);
  const dist = input.nearestTriggerDistM;
  const bike =
    input.transportMode === 'bicycle' || speed >= MS_BIKE * 0.85;
  const veryFast = speed >= MS_FAST;
  const near = dist != null && dist <= 100;
  const tight = input.tightUrbanHint === true || (near && speed < MS_WALK * 2);

  if (bike && dist != null && dist > 100 && !tight) {
    return { intervalMs: 30_000, reason: 'bike_open_100m_plus' };
  }
  if (veryFast && dist != null && dist < 40) {
    return {
      intervalMs: 1_000,
      reason: 'fast_pass_through_may_skip_trigger',
    };
  }
  if (tight || near) {
    return { intervalMs: 1_000, reason: 'tight_or_near_trigger' };
  }
  if (bike) {
    return { intervalMs: 1_000, reason: 'bike_active' };
  }
  if (speed <= MS_WALK * 0.3) {
    return { intervalMs: 5_000, reason: 'foot_slow' };
  }
  return { intervalMs: 3_500, reason: 'foot_normal' };
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
