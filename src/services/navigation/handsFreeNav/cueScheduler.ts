/**
 * Time-based nav cues: finish speaking 2s before the maneuver.
 * Stuck-safe: distances always recomputed from live remaining-to-turn.
 */

import {
  isHandsFreeSpeakTurn,
  isAlleyRoadName,
} from '../navSpeakTurn';
import {
  FINISH_BEFORE_TURN_SEC,
  FINAL_FLOOR_M,
  FINAL_CEILING_WALK_M,
  FINAL_CEILING_BIKE_M,
  estimateSpeechSec,
  speakStartDistanceM,
  warmDistanceM,
} from '../speakStartDistance';
import {
  buildLandmarkFirstCue,
  buildPredictiveTurnCue,
  scrubRoboticNavSpeak,
} from '../spatialOrientation';
import type { NavWaypoint, TransportMode } from '../navigationTypes';
import type { CuePhase, ScheduledCue } from './types';
import { walkReassureSpeech, shouldFireWalkReassure } from '../walkReassure';

export {
  FINISH_BEFORE_TURN_SEC,
  FINAL_FLOOR_M,
  FINAL_CEILING_WALK_M,
  FINAL_CEILING_BIKE_M,
  estimateSpeechSec,
  speakStartDistanceM,
  warmDistanceM,
};

export const COMPLEX_WARN_FOOT_M = 20;

let lastSpokenPhaseKey: string | null = null;
let lastSpokenAtMs = 0;
let lastReassureAtMs = 0;
let stretchArmedAtMs = 0;
let confirmedTurnIndex: number | null = null;

export function resetCueScheduler(): void {
  lastSpokenPhaseKey = null;
  lastSpokenAtMs = 0;
  lastReassureAtMs = 0;
  stretchArmedAtMs = 0;
  confirmedTurnIndex = null;
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
  if (m.includes('fork') || m.includes('keep')) {
    if (m.includes('left')) return 'links an der Gabelung';
    if (m.includes('right')) return 'rechts an der Gabelung';
    return 'an der Gabelung';
  }
  return 'geradeaus';
}

function visualKindOf(opts: {
  maneuver: string | null;
  roadName: string | null;
  isComplexTurn?: boolean;
}): 'fork' | 'alley' | 'complex' | null {
  const m = (opts.maneuver ?? '').toLowerCase();
  if (m.includes('fork') || m.includes('keep')) return 'fork';
  if (isAlleyRoadName(opts.roadName)) return 'alley';
  if (opts.isComplexTurn) return 'complex';
  return null;
}

export function findNextTurnWaypoint(opts: {
  waypoints: NavWaypoint[];
  fromIndex: number;
}): { index: number; wp: NavWaypoint } | null {
  const start = Math.max(0, opts.fromIndex);
  for (let i = start; i < opts.waypoints.length; i++) {
    const wp = opts.waypoints[i];
    if (
      isHandsFreeSpeakTurn({
        maneuver: wp.maneuver,
        roadName: wp.roadName,
        turnComplexity: wp.turnComplexity,
      })
    ) {
      return { index: i, wp };
    }
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
  isComplexTurn?: boolean;
}): string {
  const turn = turnWord(opts.maneuver);
  const visualKind = visualKindOf({
    maneuver: opts.maneuver,
    roadName: opts.roadName,
    isComplexTurn: opts.isComplexTurn,
  });
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
        visualKind,
      }),
    );
  }
  return scrubRoboticNavSpeak(
    buildPredictiveTurnCue({
      turn,
      distanceM: opts.distanceM,
      landmark: opts.landmark,
      roadName: opts.roadName,
      visualKind,
    }),
  );
}

export function buildComplexWarnText(landmark: string | null): string {
  if (landmark) {
    return scrubRoboticNavSpeak(
      `Gleich ${landmark} — ich sag dir, wohin.`,
    );
  }
  return scrubRoboticNavSpeak('Gleich Kreuzung — ich sag dir, wohin.');
}

export function buildConfirmText(): string {
  return scrubRoboticNavSpeak('Genau, du bist richtig.');
}

export function buildReassureText(opts: {
  remainingRouteM: number;
  etaMin: number;
  speedMps: number | null;
  nextTurnHint?: string | null;
  distanceToNextTurnM?: number | null;
}): string {
  void opts.etaMin;
  void opts.speedMps;
  void opts.nextTurnHint;
  return scrubRoboticNavSpeak(
    walkReassureSpeech({
      remainingRouteM: opts.remainingRouteM,
      distanceToNextTurnM: opts.distanceToNextTurnM ?? null,
    }),
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
  // Stehen / noch nicht losgelaufen → keine „Du bist auf dem Weg“-Laberei
  const userMoving =
    typeof opts.speedMps === 'number' &&
    Number.isFinite(opts.speedMps) &&
    opts.speedMps >= 0.45;

  const turnIdx = opts.nextTurnIndex;
  const maybeArm = (stretchM: number) => {
    if (userMoving && stretchArmedAtMs <= 0 && stretchM >= 280) {
      stretchArmedAtMs = now;
    }
  };

  if (
    turnIdx < 0 ||
    !isHandsFreeSpeakTurn({
      maneuver: opts.nextTurnManeuver,
      roadName: opts.nextTurnRoadName,
      turnComplexity: opts.isComplexTurn ? 'complex' : null,
    })
  ) {
    maybeArm(opts.remainingRouteM);
    // Long straight — kurze Teaser, nicht minutenlang still
    if (
      shouldFireWalkReassure({
        stretchM: opts.remainingRouteM,
        distanceToTurnM: null,
        turnSpeakStartM: 8,
        remainingRouteM: opts.remainingRouteM,
        speedMps: opts.speedMps,
        transportMode: opts.transportMode,
        userMoving,
        nowMs: now,
        lastReassureAtMs,
        lastSpokenAtMs,
        stretchArmedAtMs,
      })
    ) {
      const text = buildReassureText({
        remainingRouteM: opts.remainingRouteM,
        etaMin: opts.etaMin,
        speedMps: opts.speedMps,
        nextTurnHint: null,
        distanceToNextTurnM: null,
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
    isComplexTurn: opts.isComplexTurn,
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

  // Lange Gerade vor der nächsten Gabelung — kurze Meter-Teaser
  {
    maybeArm(dist);
    if (
      shouldFireWalkReassure({
        stretchM: dist,
        distanceToTurnM: dist,
        turnSpeakStartM: startM,
        remainingRouteM: opts.remainingRouteM,
        speedMps: opts.speedMps,
        transportMode: opts.transportMode,
        userMoving,
        nowMs: now,
        lastReassureAtMs,
        lastSpokenAtMs,
        stretchArmedAtMs,
      })
    ) {
      const text = buildReassureText({
        remainingRouteM: opts.remainingRouteM,
        etaMin: opts.etaMin,
        speedMps: opts.speedMps,
        distanceToNextTurnM: dist,
      });
      lastReassureAtMs = now;
      lastSpokenAtMs = now;
      lastSpokenPhaseKey = phaseKey('reassure', turnIdx);
      return {
        phase: 'reassure',
        waypointIndex: turnIdx,
        text,
        speakStartDistanceM: dist,
        speechSec: estimateSpeechSec(text),
      };
    }
  }

  const finalKey = phaseKey('final', turnIdx);
  if (dist <= startM + 4 && dist >= 0 && lastSpokenPhaseKey !== finalKey) {
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
