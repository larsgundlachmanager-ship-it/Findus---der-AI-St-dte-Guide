/**
 * Lange Gerade ohne Abbiegung — Presence nach echter Stille.
 *
 * Takt: 7 Min → 15 Min → danach alle 20 Min bis zur echten Gabelung.
 * Nur wenn die nächste Abbiegung noch weit ist (≥150 m Fuß / ≥300 m Rad).
 *
 * Dies sind nur abstrakte Beispiele für den logischen Ablauf. Übernimm niemals
 * den genauen Wortlaut.
 */

import type { TransportMode } from './navigationTypes';

/** Erste Reassure nach so langer Stille. */
export const WALK_REASSURE_FIRST_MS = 7 * 60_000;
/** Zweite nach der ersten. */
export const WALK_REASSURE_SECOND_MS = 15 * 60_000;
/** Ab der dritten: fester Takt. */
export const WALK_REASSURE_LATER_MS = 20 * 60_000;

/** @deprecated Alias — erste Stille. */
export const WALK_REASSURE_SILENCE_MS = WALK_REASSURE_FIRST_MS;

/** Ab dieser Stretch-Länge nach Kreuzung: einmal „lauf X km geradeaus“. */
export const STRETCH_ANNOUNCE_MIN_M = 1_200;

export function bucketTeaserMeters(m: number): number {
  const n = Math.max(0, Math.round(m));
  if (n >= 950) return Math.round(n / 100) * 100;
  if (n >= 250) return Math.round(n / 100) * 100;
  if (n >= 80) return Math.round(n / 50) * 50;
  return n;
}

/** Nächste Abbiegung muss noch so weit sein, sonst kein Reassure. */
export function reassureMinTurnDistanceM(mode: TransportMode): number {
  return mode === 'bicycle' ? 300 : 150;
}

/**
 * Abstand bis zur nächsten Reassure-Ansage.
 * count = wie oft schon auf diesem Stretch gesprochen.
 */
export function walkReassureGapMs(opts: {
  stretchM?: number;
  speedMps?: number | null;
  transportMode?: TransportMode;
  isFirst?: boolean;
  /** 0 = noch keine Reassure auf dem Stretch */
  reassureCount?: number;
}): number {
  const n = Math.max(0, opts.reassureCount ?? (opts.isFirst === false ? 1 : 0));
  if (n <= 0) return WALK_REASSURE_FIRST_MS;
  if (n === 1) return WALK_REASSURE_SECOND_MS;
  return WALK_REASSURE_LATER_MS;
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
  /** Wie oft schon Reassure auf dieser Geraden. */
  reassureCount?: number;
}): boolean {
  if (!opts.userMoving) return false;
  if (
    opts.transportMode === 'transit_bus' ||
    opts.transportMode === 'transit_train'
  ) {
    return false;
  }
  if (opts.remainingRouteM < 220) return false;

  const minTurn = reassureMinTurnDistanceM(opts.transportMode);
  // Nur wenn nächste Abbiegung noch weit — sonst Final-Cue hat Vorfahrt.
  if (
    opts.distanceToTurnM != null &&
    opts.distanceToTurnM < minTurn
  ) {
    return false;
  }
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
  if (stretch < minTurn) return false;

  const silenceOrigin =
    opts.lastSpokenAtMs > 0
      ? opts.lastSpokenAtMs
      : opts.stretchArmedAtMs > 0
        ? opts.stretchArmedAtMs
        : 0;
  if (silenceOrigin <= 0) return false;

  const count = Math.max(0, opts.reassureCount ?? 0);
  // Erste: Stille seit letzter Nav-Ansage; Folgende: seit letzter Reassure.
  if (count === 0) {
    if (opts.nowMs - silenceOrigin < WALK_REASSURE_FIRST_MS) return false;
    return true;
  }
  if (opts.lastReassureAtMs <= 0) return false;
  const gap = walkReassureGapMs({ reassureCount: count });
  return opts.nowMs - opts.lastReassureAtMs >= gap;
}

export function walkReassureSpeech(opts: {
  remainingRouteM: number;
  distanceToNextTurnM: number | null;
}): string {
  const turn = opts.distanceToNextTurnM;
  if (turn != null && turn >= 150) {
    const m = bucketTeaserMeters(turn);
    if (m >= 900) {
      return `Du bist aktuell noch richtig. Die nächste Kreuzung ist in etwa ${(m / 1000).toFixed(1).replace('.', ',')} Kilometern.`;
    }
    return `Du bist aktuell noch richtig. Die nächste Kreuzung ist in ${m} Metern.`;
  }
  const left = bucketTeaserMeters(opts.remainingRouteM);
  if (left >= 900) {
    return `Du bist aktuell noch richtig. Noch etwa ${(left / 1000).toFixed(1).replace('.', ',')} Kilometer.`;
  }
  if (left >= 200) {
    return `Du bist aktuell noch richtig — noch etwa ${left} Meter.`;
  }
  return 'Du bist aktuell noch richtig.';
}

/**
 * Nach Kreuzung: lange Gerade ansagen (nur belegt, Wortlaut frei).
 */
export function stretchAfterTurnSpeech(opts: {
  distanceM: number;
  roadName?: string | null;
}): string | null {
  const m = Math.round(opts.distanceM);
  if (m < STRETCH_ANNOUNCE_MIN_M) return null;
  const km = (Math.round(m / 100) / 10).toFixed(1).replace('.', ',');
  const road = (opts.roadName || '').trim();
  const looksNamed =
    road.length >= 3 &&
    /(straße|strasse|str\.?|weg|allee|gasse|pfad|damm)/iu.test(road) &&
    !/unnamed|unknown|straße\s*$/iu.test(road);
  if (looksNamed) {
    return `Gut — lauf den ${road} etwa ${km} Kilometer entlang.`;
  }
  return `Gut — lauf jetzt etwa ${km} Kilometer geradeaus.`;
}
