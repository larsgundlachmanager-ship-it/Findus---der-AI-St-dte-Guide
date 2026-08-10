/**
 * Time-based nav cues: finish speaking 2s before the maneuver.
 * Stuck-safe: distances always recomputed from live remaining-to-turn.
 */

import { isTurnManeuver } from '../navPredictiveCue';
import {
  buildLandmarkFirstCue,
  buildPredictiveTurnCue,
  scrubRoboticNavSpeak,
} from '../spatialOrientation';
import type { NavWaypoint, TransportMode } from '../navigationTypes';
import type { CuePhase, ScheduledCue } from './types';

export const FINISH_BEFORE_TURN_SEC = 2;
export const COMPLEX_WARN_FOOT_M = 20;
export const FINAL_FLOOR_M = 5;
export const FINAL_CEILING_WALK_M = 80;
export const FINAL_CEILING_BIKE_M = 220;

const DEFAULT_WALK_MPS = 1.25;
const DEFAULT_BIKE_MPS = 5.0;

let lastSpokenPhaseKey: string | null = null;
let lastSpokenAtMs = 0;
let lastReassureAtMs = 0;
let confirmedTurnIndex: number | null = null;

export function resetCueScheduler(): void {
  lastSpokenPhaseKey = null;
  lastSpokenAtMs = 0;
  lastReassureAtMs = 0;
  confirmedTurnIndex = null;
}

export function estimateSpeechSec(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  // ~2.6 German words/sec casual TTS + small pad
  return Math.min(12, Math.max(1.8, words / 2.6 + 0.4));
}

export function speakStartDistanceM(opts: {
  speechSec: number;
  speedMps: number | null;
  transportMode: TransportMode;
}): number {
  const fallback =
    opts.transportMode === 'bicycle' ? DEFAULT_BIKE_MPS : DEFAULT_WALK_MPS;
  const speed =
    typeof opts.speedMps === 'number' && opts.speedMps > 0.3
      ? opts.speedMps
      : fallback;
  const raw = (opts.speechSec + FINISH_BEFORE_TURN_SEC) * speed;
  const ceil =
    opts.transportMode === 'bicycle'
      ? FINAL_CEILING_BIKE_M
      : FINAL_CEILING_WALK_M;
  return Math.max(FINAL_FLOOR_M, Math.min(ceil, Math.round(raw)));
}

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
  if (m.includes('fork')) {
    if (m.includes('left')) return 'links an der Gabelung';
    if (m.includes('right')) return 'rechts an der Gabelung';
    return 'an der Gabelung';
  }
  return 'geradeaus';
}

export function findNextTurnWaypoint(opts: {
  waypoints: NavWaypoint[];
  fromIndex: number;
}): { index: number; wp: NavWaypoint } | null {
  const start = Math.max(0, opts.fromIndex);
  for (let i = start; i < opts.waypoints.length; i++) {
    const wp = opts.waypoints[i];
    if (isTurnManeuver(wp.maneuver)) return { index: i, wp };
  }
  return null;
}

/** Remaining meters along dense waypoints from current index to target index. */
export function remainingAlongWaypointsM(
  waypoints: NavWaypoint[],
  fromIndex: number,
  toIndex: number,
  userLat: number,
  userLng: number,
  distanceFn: (
    aLat: number,
    aLng: number,
    bLat: number,
    bLng: number,
  ) => number,
): number {
  if (!waypoints.length) return 0;
  const from = Math.max(0, Math.min(fromIndex, waypoints.length - 1));
  const to = Math.max(from, Math.min(toIndex, waypoints.length - 1));
  let sum = distanceFn(
    userLat,
    userLng,
    waypoints[from].lat,
    waypoints[from].lng,
  );
  for (let i = from; i < to; i++) {
    sum += distanceFn(
      waypoints[i].lat,
      waypoints[i].lng,
      waypoints[i + 1].lat,
      waypoints[i + 1].lng,
    );
  }
  return Math.max(0, Math.round(sum));
}

export function buildFinalCueText(opts: {
  maneuver: string | null;
  landmark: string | null;
  roadName: string | null;
  distanceM: number;
}): string {
  const turn = turnWord(opts.maneuver);
  if (opts.landmark && turn !== 'geradeaus') {
    return scrubRoboticNavSpeak(
      buildLandmarkFirstCue({
        landmark: opts.landmark,
        relation: {
          side: 'front',
          bearingRelDeg: 0,
          sidePhrase: 'voraus',
          shortPhrase: 'vor dir',
        },
        turn,
        roadName: opts.roadName,
      }),
    );
  }
  return scrubRoboticNavSpeak(
    buildPredictiveTurnCue({
      turn,
      distanceM: opts.distanceM,
      landmark: opts.landmark,
      roadName: opts.roadName,
    }),
  );
}

export function buildComplexWarnText(landmark: string | null): string {
  if (landmark) {
    return scrubRoboticNavSpeak(
      `Gleich kommt eine unübersichtliche Stelle — bleib auf meiner Stimme. Orientierung: ${landmark}.`,
    );
  }
  return scrubRoboticNavSpeak(
    'Gleich kommt eine unübersichtliche Stelle — bleib auf meiner Stimme.',
  );
}

export function buildConfirmText(): string {
  return scrubRoboticNavSpeak('Genau, du bist richtig.');
}

export function buildReassureText(opts: {
  remainingRouteM: number;
  etaMin: number;
  speedMps: number | null;
}): string {
  const km =
    opts.remainingRouteM >= 1000
      ? `${(opts.remainingRouteM / 1000).toFixed(1)} km`
      : `${Math.round(opts.remainingRouteM)} m`;
  const tempo =
    opts.speedMps != null && opts.speedMps > 0.5
      ? opts.speedMps > 3
        ? ' Du bist gut unterwegs.'
        : ' Schritt für Schritt.'
      : '';
  return scrubRoboticNavSpeak(
    `Alles gut — du bist auf der richtigen Route. Noch etwa ${km}, rund ${opts.etaMin} Minuten.${tempo}`,
  );
}

function phaseKey(phase: CuePhase, turnIndex: number): string {
  return `${phase}:${turnIndex}`;
}

/**
 * Decide which cue to fire this tick (at most one).
 */
export function pickCueForTick(opts: {
  distanceToNextTurnM: number;
  nextTurnIndex: number;
  nextTurnManeuver: string | null;
  nextTurnLandmark: string | null;
  nextTurnRoadName: string | null;
  remainingRouteM: number;
  etaMin: number;
  speedMps: number | null;
  transportMode: TransportMode;
  onRoute: boolean;
  isComplexTurn?: boolean;
  nowMs?: number;
}): ScheduledCue | null {
  const now = opts.nowMs ?? Date.now();
  if (!opts.onRoute) return null;

  const turnIdx = opts.nextTurnIndex;
  if (turnIdx < 0 || !isTurnManeuver(opts.nextTurnManeuver)) {
    // Long straight — reassurance
    const silenceMs =
      opts.transportMode === 'bicycle' ? 3.5 * 60_000 : 6 * 60_000;
    if (
      opts.remainingRouteM > 400 &&
      now - lastReassureAtMs >= silenceMs &&
      now - lastSpokenAtMs >= silenceMs
    ) {
      const text = buildReassureText({
        remainingRouteM: opts.remainingRouteM,
        etaMin: opts.etaMin,
        speedMps: opts.speedMps,
      });
      const speechSec = estimateSpeechSec(text);
      lastReassureAtMs = now;
      lastSpokenAtMs = now;
      lastSpokenPhaseKey = phaseKey('reassure', -1);
      return {
        phase: 'reassure',
        waypointIndex: -1,
        text,
        speakStartDistanceM: opts.remainingRouteM,
        speechSec,
      };
    }
    return null;
  }

  const dist = opts.distanceToNextTurnM;
  const finalText = buildFinalCueText({
    maneuver: opts.nextTurnManeuver,
    landmark: opts.nextTurnLandmark,
    roadName: opts.nextTurnRoadName,
    distanceM: dist,
  });
  const speechSec = estimateSpeechSec(finalText);
  const startM = speakStartDistanceM({
    speechSec,
    speedMps: opts.speedMps,
    transportMode: opts.transportMode,
  });

  // Confirm after passing turn
  if (
    confirmedTurnIndex !== turnIdx &&
    dist < 8 &&
    lastSpokenPhaseKey?.startsWith('final:')
  ) {
    const key = phaseKey('confirm', turnIdx);
    if (lastSpokenPhaseKey !== key) {
      confirmedTurnIndex = turnIdx;
      const text = buildConfirmText();
      lastSpokenPhaseKey = key;
      lastSpokenAtMs = now;
      return {
        phase: 'confirm',
        waypointIndex: turnIdx,
        text,
        speakStartDistanceM: 8,
        speechSec: estimateSpeechSec(text),
      };
    }
  }

  // Complex warn ~20 m foot / time-equivalent bike
  if (opts.isComplexTurn) {
    const warnM =
      opts.transportMode === 'bicycle'
        ? Math.max(COMPLEX_WARN_FOOT_M * 3, startM + 25)
        : COMPLEX_WARN_FOOT_M;
    const key = phaseKey('warn', turnIdx);
    if (dist <= warnM + 8 && dist > startM + 3 && lastSpokenPhaseKey !== key) {
      const text = buildComplexWarnText(opts.nextTurnLandmark);
      lastSpokenPhaseKey = key;
      lastSpokenAtMs = now;
      return {
        phase: 'warn',
        waypointIndex: turnIdx,
        text,
        speakStartDistanceM: warnM,
        speechSec: estimateSpeechSec(text),
      };
    }
  }

  const finalKey = phaseKey('final', turnIdx);
  if (dist <= startM + 4 && dist >= 3 && lastSpokenPhaseKey !== finalKey) {
    lastSpokenPhaseKey = finalKey;
    lastSpokenAtMs = now;
    return {
      phase: 'final',
      waypointIndex: turnIdx,
      text: finalText,
      speakStartDistanceM: startM,
      speechSec,
    };
  }

  return null;
}

/** Warm distance for TTS prefetch (earlier than speak start). */
export function warmDistanceM(opts: {
  speechSec: number;
  speedMps: number | null;
  transportMode: TransportMode;
}): number {
  const start = speakStartDistanceM(opts);
  const pad = opts.transportMode === 'bicycle' ? 45 : 25;
  return start + pad;
}
