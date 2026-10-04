/**
 * Wann die Abbiege-Ansage starten muss.
 *
 * Ziel: fertig ca. 5 s vor der Gabelung — nicht erst in der Kurve.
 * Lieber etwas früher als zu spät.
 *
 * Beispiel zu Fuß (~1,25 m/s), Cue ~4 s Redezeit:
 *   Start bei (4 + 5) × 1,25 ≈ 11 m → fertig ~5 s vor der Kurve.
 * Beispiel Rad (~5 m/s), Cue ~4 s:
 *   Start bei (4 + 5) × 5 ≈ 45 m.
 */

import type { TransportMode } from './navigationTypes';

/** Soll-Ende der Ansage vor dem Maneuver (Sekunden). */
export const FINISH_BEFORE_TURN_SEC = 5;
export const FINAL_FLOOR_M = 18;
/** Zu Fuß früher ansagen — genug Zeit zum Hören + reagieren. */
export const FINAL_CEILING_WALK_M = 160;
export const FINAL_CEILING_BIKE_M = 280;

/** Konservativ: eher zu lange schätzen → früher starten. */
const WORDS_PER_SEC = 2.3;
const SPEECH_OVERHEAD_SEC = 0.55;

const DEFAULT_WALK_MPS = 1.25;
const DEFAULT_BIKE_MPS = 5.0;

export function estimateSpeechSec(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(12, Math.max(1.8, words / WORDS_PER_SEC + SPEECH_OVERHEAD_SEC));
}

function speedMps(
  speedMps: number | null,
  transportMode: TransportMode,
): number {
  const fallback =
    transportMode === 'bicycle' ? DEFAULT_BIKE_MPS : DEFAULT_WALK_MPS;
  return typeof speedMps === 'number' && speedMps > 0.3 ? speedMps : fallback;
}

export function speakStartDistanceM(opts: {
  speechSec: number;
  speedMps: number | null;
  transportMode: TransportMode;
}): number {
  const speed = speedMps(opts.speedMps, opts.transportMode);
  const raw = (opts.speechSec + FINISH_BEFORE_TURN_SEC) * speed;
  const ceil =
    opts.transportMode === 'bicycle'
      ? FINAL_CEILING_BIKE_M
      : FINAL_CEILING_WALK_M;
  return Math.max(FINAL_FLOOR_M, Math.min(ceil, Math.round(raw)));
}

export function warmDistanceM(opts: {
  speechSec: number;
  speedMps: number | null;
  transportMode: TransportMode;
}): number {
  const start = speakStartDistanceM(opts);
  const speed = speedMps(opts.speedMps, opts.transportMode);
  const pad = Math.max(
    opts.transportMode === 'bicycle' ? 70 : 40,
    Math.round(4 * speed),
  );
  return start + pad;
}
