/**
 * Wann die Abbiege-Ansage starten muss: fertig 2 s vor der Gabelung.
 * Distanz = (Redezeit + 2) × Tempo. TTS-Prefetch davor.
 * Reine Mathematik — kein React Native.
 */

import type { TransportMode } from './navigationTypes';

export const FINISH_BEFORE_TURN_SEC = 2;
export const FINAL_FLOOR_M = 8;
export const FINAL_CEILING_WALK_M = 80;
export const FINAL_CEILING_BIKE_M = 220;

const DEFAULT_WALK_MPS = 1.25;
const DEFAULT_BIKE_MPS = 5.0;

export function estimateSpeechSec(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(12, Math.max(1.8, words / 2.6 + 0.4));
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
