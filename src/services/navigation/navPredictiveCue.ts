/**
 * Predictive nav trigger distances — Hands-Free time-based.
 * Finish speaking 2s before the maneuver (aligned with handsFreeNav/cueScheduler).
 */

import type { TransportMode } from './navigationTypes';
import { isTransitMode } from './transportMode';

export const FINISH_BEFORE_TURN_SEC = 2;
export const COMPLEX_WARN_FOOT_M = 20;

/** Legacy constants (approx defaults at 1.25 m/s walk / 5 m/s bike). */
export const PREDICT_WALK_SPEAK_M = 12;
export const PREDICT_BIKE_SPEAK_MIN_M = 40;
export const PREDICT_BIKE_SPEAK_MAX_M = 40;
export const PREDICT_WARM_WALK_M = 55;
export const PREDICT_WARM_BIKE_M = 120;

const DEFAULT_WALK_MPS = 1.25;
const DEFAULT_BIKE_MPS = 5.0;

function speakStartM(
  transportMode: TransportMode,
  speedMs: number | null | undefined,
  speechSec: number,
): number {
  const fallback =
    transportMode === 'bicycle' ? DEFAULT_BIKE_MPS : DEFAULT_WALK_MPS;
  const speed =
    typeof speedMs === 'number' && speedMs > 0.3 ? speedMs : fallback;
  const raw = (speechSec + FINISH_BEFORE_TURN_SEC) * speed;
  const ceil = transportMode === 'bicycle' ? 220 : 80;
  return Math.max(5, Math.min(ceil, Math.round(raw)));
}

/**
 * Distance (m) at which the spoken turn cue must fire.
 */
export function predictiveSpeakDistanceM(
  transportMode: TransportMode,
  speedMs?: number | null,
): number {
  if (isTransitMode(transportMode)) return 120;
  return speakStartM(transportMode, speedMs, 3.5);
}

/** Distance (m) to start background TTS warm for upcoming turn. */
export function predictiveWarmDistanceM(
  transportMode: TransportMode,
  speedMs?: number | null,
): number {
  if (isTransitMode(transportMode)) return 220;
  const pad = transportMode === 'bicycle' ? 45 : 25;
  return speakStartM(transportMode, speedMs, 3.5) + pad;
}

export function isTurnManeuver(maneuver: string | null | undefined): boolean {
  const m = (maneuver ?? '').toLowerCase();
  if (!m) return false;
  if (/^(straight|arrive|continue)$/.test(m)) return false;
  return /left|right|uturn|u-turn|roundabout|fork|ramp|keep|end of road/.test(
    m,
  );
}
