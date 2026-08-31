/**
 * Predictive nav trigger distances — Hands-Free time-based.
 * Finish speaking 2s before the maneuver (aligned with handsFreeNav/cueScheduler).
 */

import type { TransportMode } from './navigationTypes';
import { isTransitMode } from './transportMode';
import {
  isTurnManeuver,
  isAlleyRoadName,
  isHandsFreeSpeakTurn,
} from './navSpeakTurn';

export { isTurnManeuver, isAlleyRoadName, isHandsFreeSpeakTurn };

export const FINISH_BEFORE_TURN_SEC = 2;
/** Aktuellen Yorro-Satz ausreden lassen, bevor Navi spricht. */
export const FINDUS_SENTENCE_YIELD_SEC = 3.2;
/** Akustische Pause vor dem Navi-Einschub (500ms). */
export const NAV_INSERT_GAP_SEC = 0.5;
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
    transportMode === 'bicycle'
      ? DEFAULT_BIKE_MPS
      : transportMode === 'jog'
        ? 2.5
        : DEFAULT_WALK_MPS;
  const speed =
    typeof speedMs === 'number' && speedMs > 0.3 ? speedMs : fallback;
  // Fertig 2 s vor dem Maneuver — Yield liegt in der Audio-Queue, nicht in Metern.
  const raw = (speechSec + FINISH_BEFORE_TURN_SEC) * speed;
  const ceil =
    transportMode === 'bicycle' ? 220 : transportMode === 'jog' ? 110 : 80;
  return Math.max(8, Math.min(ceil, Math.round(raw)));
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
  const pad = transportMode === 'bicycle' ? 70 : 40;
  return speakStartM(transportMode, speedMs, 3.5) + pad;
}
