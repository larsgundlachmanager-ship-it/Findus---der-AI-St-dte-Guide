/**
 * Zwei nahe Abbiegungen → eine Ansage (Queue/kein Doppel-Sprechen).
 *
 * Struktur (Wortlaut frei): jetzt Richtung A — und gleich danach (~X m) Richtung B.
 * Dies sind nur abstrakte Beispiele für den logischen Ablauf.
 */

import { isHandsFreeSpeakTurn } from './navSpeakTurn';
import type { NavWaypoint } from './navigationTypes';
import { scrubRoboticNavSpeak } from './spatialOrientation';

/** Unter diesem Abstand (m) werden zwei Speak-Turns zusammengefasst. */
export const CHAIN_TURN_MERGE_MAX_M = 45;

function turnWord(maneuver: string | null | undefined): string {
  const m = (maneuver ?? '').toLowerCase();
  if (m.includes('sharp-left') || m.includes('sharp_left')) return 'scharf links';
  if (m.includes('sharp-right') || m.includes('sharp_right'))
    return 'scharf rechts';
  if (m.includes('slight-left') || m.includes('slight_left')) return 'leicht links';
  if (m.includes('slight-right') || m.includes('slight_right'))
    return 'leicht rechts';
  if (m.includes('left')) return 'links';
  if (m.includes('right')) return 'rechts';
  if (m.includes('uturn') || m.includes('u-turn')) return 'umdrehen';
  if (m.includes('roundabout')) return 'im Kreisverkehr';
  if (m.includes('fork') || m.includes('keep')) {
    if (m.includes('left')) return 'links an der Gabelung';
    if (m.includes('right')) return 'rechts an der Gabelung';
    return 'an der Gabelung';
  }
  return 'geradeaus';
}

function alongGapM(a: NavWaypoint, b: NavWaypoint): number | null {
  const aa = a.splineAlongM;
  const bb = b.splineAlongM;
  if (
    typeof aa === 'number' &&
    typeof bb === 'number' &&
    Number.isFinite(aa) &&
    Number.isFinite(bb)
  ) {
    return Math.max(0, Math.round(bb - aa));
  }
  return null;
}

export type ChainedNextTurn = {
  index: number;
  wp: NavWaypoint;
  gapM: number;
};

/**
 * Nächste Speak-Abbiegung nach `turnIndex`, wenn nah genug für eine Doppel-Cue.
 */
export function findChainedNextTurn(
  waypoints: NavWaypoint[],
  turnIndex: number,
  maxGapM: number = CHAIN_TURN_MERGE_MAX_M,
): ChainedNextTurn | null {
  if (turnIndex < 0 || turnIndex >= waypoints.length) return null;
  const first = waypoints[turnIndex]!;
  for (let i = turnIndex + 1; i < waypoints.length; i++) {
    const wp = waypoints[i]!;
    if (
      !isHandsFreeSpeakTurn({
        maneuver: wp.maneuver,
        roadName: wp.roadName,
        turnComplexity: wp.turnComplexity,
      })
    ) {
      continue;
    }
    let gap = alongGapM(first, wp);
    if (gap == null) {
      // Grober Fallback: Luftlinie zwischen den Pins.
      const dLat = (wp.lat - first.lat) * 111_320;
      const dLng =
        (wp.lng - first.lng) *
        111_320 *
        Math.cos((first.lat * Math.PI) / 180);
      gap = Math.round(Math.hypot(dLat, dLng));
    }
    if (gap <= 0 || gap > maxGapM) return null;
    return { index: i, wp, gapM: gap };
  }
  return null;
}

/**
 * Eine Cue für zwei enge Abbiegungen.
 * Beispiel-Struktur: „Jetzt rechts — und in etwa 30 Metern sofort wieder links.“
 */
export function buildChainedTurnCue(opts: {
  firstManeuver: string | null;
  secondManeuver: string | null;
  gapM: number;
  landmark?: string | null;
}): string {
  const a = turnWord(opts.firstManeuver);
  const b = turnWord(opts.secondManeuver);
  const gap = Math.max(5, Math.round(opts.gapM / 5) * 5);
  const land = (opts.landmark || '').trim();
  if (a === 'geradeaus' && b === 'geradeaus') {
    return scrubRoboticNavSpeak('Weiter geradeaus — du bist richtig.');
  }
  if (land && a !== 'geradeaus') {
    return scrubRoboticNavSpeak(
      `An ${land} jetzt ${a} — und in etwa ${gap} Metern sofort wieder ${b}.`,
    );
  }
  return scrubRoboticNavSpeak(
    `Jetzt ${a} abbiegen — und in etwa ${gap} Metern sofort wieder ${b}.`,
  );
}

export { turnWord as chainedTurnWord };
