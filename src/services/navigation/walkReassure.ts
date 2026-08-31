/**
 * Lange Gerade ohne Abbiegung — kurze Presence-Teaser, kein Google-Stille.
 * Struktur, kein Skript.
 */

import type { TransportMode } from './navigationTypes';

export function bucketTeaserMeters(m: number): number {
  const n = Math.max(0, Math.round(m));
  if (n >= 950) return Math.round(n / 100) * 100;
  if (n >= 250) return Math.round(n / 100) * 100;
  if (n >= 80) return Math.round(n / 50) * 50;
  return n;
}

/**
 * Abstand zwischen Teasern: auf 1 km zu Fuß ~2–3×, erste Meldung früher.
 */
export function walkReassureGapMs(opts: {
  stretchM: number;
  speedMps: number | null;
  transportMode: TransportMode;
  isFirst: boolean;
}): number {
  const speed =
    typeof opts.speedMps === 'number' && opts.speedMps > 0.4
      ? opts.speedMps
      : opts.transportMode === 'bicycle'
        ? 5
        : 1.25;
  const stretch = Math.max(200, opts.stretchM);
  const intervalM = Math.max(
    opts.transportMode === 'bicycle' ? 350 : 220,
    Math.min(opts.transportMode === 'bicycle' ? 700 : 420, stretch / 3),
  );
  const fullMs = (intervalM / speed) * 1000;
  if (opts.isFirst) {
    const firstM = opts.transportMode === 'bicycle' ? 140 : 90;
    return Math.min(fullMs, (firstM / speed) * 1000);
  }
  return fullMs;
}

export function shouldFireWalkReassure(opts: {
  stretchM: number;
  distanceToTurnM: number | null;
  turnSpeakStartM: number;
  remainingRouteM: number;
  speedMps: number | null;
  transportMode: TransportMode;
  userMoving: boolean;
  nowMs: number;
  lastReassureAtMs: number;
  lastSpokenAtMs: number;
  stretchArmedAtMs: number;
}): boolean {
  if (!opts.userMoving) return false;
  if (opts.remainingRouteM < 220) return false;
  const turnSpeakPad = opts.turnSpeakStartM + 70;
  if (
    opts.distanceToTurnM != null &&
    opts.distanceToTurnM <= turnSpeakPad
  ) {
    return false;
  }
  const stretch =
    opts.distanceToTurnM != null && opts.distanceToTurnM > 80
      ? opts.distanceToTurnM
      : opts.stretchM;
  if (stretch < 280) return false;
  const origin =
    opts.lastReassureAtMs > 0 ? opts.lastReassureAtMs : opts.stretchArmedAtMs;
  if (origin <= 0) return false;
  const isFirst = opts.lastReassureAtMs <= 0;
  const gap = walkReassureGapMs({
    stretchM: stretch,
    speedMps: opts.speedMps,
    transportMode: opts.transportMode,
    isFirst,
  });
  if (opts.lastSpokenAtMs > 0 && opts.nowMs - opts.lastSpokenAtMs < 16_000) {
    return false;
  }
  return opts.nowMs - origin >= gap;
}

export function walkReassureSpeech(opts: {
  remainingRouteM: number;
  distanceToNextTurnM: number | null;
}): string {
  const turn = opts.distanceToNextTurnM;
  if (turn != null && turn >= 180) {
    const m = bucketTeaserMeters(turn);
    if (m >= 900) {
      return `Du bist richtig. Noch etwa ${(m / 1000).toFixed(1).replace('.', ',')} Kilometer bis zur nächsten Abbiegung.`;
    }
    return `Du bist richtig — noch etwa ${m} Meter bis zur nächsten Abbiegung.`;
  }
  const left = bucketTeaserMeters(opts.remainingRouteM);
  if (left >= 900) {
    return `Alles gut, du bist auf dem Weg. Noch etwa ${(left / 1000).toFixed(1).replace('.', ',')} Kilometer.`;
  }
  if (left >= 200) {
    return `Alles gut — noch etwa ${left} Meter.`;
  }
  return 'Alles gut — du bist richtig.';
}
