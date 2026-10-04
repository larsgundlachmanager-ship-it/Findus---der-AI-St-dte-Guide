/**
 * Time-based nav cues: finish ~2.5s before the maneuver (prefer early).
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
import { walkReassureSpeech, shouldFireWalkReassure, stretchAfterTurnSpeech } from '../walkReassure';

export {
  FINISH_BEFORE_TURN_SEC,
  FINAL_FLOOR_M,
  FINAL_CEILING_WALK_M,
  FINAL_CEILING_BIKE_M,
  estimateSpeechSec,
  speakStartDistanceM,
  warmDistanceM,
};

/** ~30 s Vorwarnung nur bei komplexen Kreuzungen (Fuß ~1,25 m/s → ~38 m). */
export const COMPLEX_WARN_LEAD_SEC = 30;
export const COMPLEX_WARN_FOOT_M = 40;

let lastSpokenPhaseKey: string | null = null;
let lastSpokenAtMs = 0;
let lastReassureAtMs = 0;
let stretchArmedAtMs = 0;
let reassureCountOnStretch = 0;
let confirmedTurnIndex: number | null = null;
/** Aktuelle Abbiegung — bei Wechsel Warn+Final neu freigeben. */
let armedTurnIndex: number | null = null;
/** Stretch-Ansage nach Kreuzung schon gesagt (pro Ziel-Turn). */
let stretchAnnouncedForTurn: number | null = null;

export function resetCueScheduler(): void {
  lastSpokenPhaseKey = null;
  lastSpokenAtMs = 0;
  lastReassureAtMs = 0;
  stretchArmedAtMs = 0;
  reassureCountOnStretch = 0;
  confirmedTurnIndex = null;
  armedTurnIndex = null;
  stretchAnnouncedForTurn = null;
}

/** Coach markiert Final/Warn, damit die nächste Kreuzung nicht blockiert. */
export function noteCuePhaseSpoken(
  phase: CuePhase,
  turnIndex: number,
  nowMs?: number,
): void {
  lastSpokenPhaseKey = phaseKey(phase, turnIndex);
  lastSpokenAtMs = nowMs ?? Date.now();
  if (phase === 'final' || phase === 'warn') {
    armedTurnIndex = turnIndex;
  }
  if (phase === 'confirm') {
    confirmedTurnIndex = turnIndex;
  }
}

/** Neue Maneuver-Grenze → Warn+Final wieder erlaubt (kein Skip der 2.). */
export function armTurnForCues(turnIndex: number): void {
  if (turnIndex < 0) return;
  if (armedTurnIndex === turnIndex) return;
  armedTurnIndex = turnIndex;
  // Vorherige Phase nicht über Kreuzungen tragen.
  lastSpokenPhaseKey = null;
  reassureCountOnStretch = 0;
  lastReassureAtMs = 0;
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
  // Einfache Gabel → Cache-Phrase. Woven nur wenn die Kreuzung wirklich unübersichtlich ist.
  if (opts.isComplexTurn && (m.includes('fork') || m.includes('keep'))) return 'fork';
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
  /** Letzte Abbiegung / Ankunftsseite — Ziel links|rechts */
  isFinalApproach?: boolean;
  destSide?: 'left' | 'right' | null;
  /** Nahe Folgekurb: eine Ansage statt zwei. */
  chainNext?: { maneuver: string | null; gapM: number } | null;
}): string {
  if (
    opts.chainNext &&
    opts.chainNext.gapM > 0 &&
    opts.chainNext.gapM <= 45 &&
    !opts.isFinalApproach
  ) {
    try {
      const { buildChainedTurnCue } = require('../chainedTurnCue') as {
        buildChainedTurnCue: (o: {
          firstManeuver: string | null;
          secondManeuver: string | null;
          gapM: number;
          landmark?: string | null;
        }) => string;
      };
      return scrubRoboticNavSpeak(
        buildChainedTurnCue({
          firstManeuver: opts.maneuver,
          secondManeuver: opts.chainNext.maneuver,
          gapM: opts.chainNext.gapM,
          landmark: opts.landmark,
        }),
      );
    } catch {
      /* soft → Einzel-Cue */
    }
  }
  const turn = turnWord(opts.maneuver);
  if (opts.isFinalApproach) {
    const side =
      opts.destSide === 'left'
        ? 'links'
        : opts.destSide === 'right'
          ? 'rechts'
          : turn.includes('links')
            ? 'links'
            : turn.includes('rechts')
              ? 'rechts'
              : null;
    if (side) {
      return scrubRoboticNavSpeak(`Ziel ${side}.`);
    }
  }
  const visualKind = visualKindOf({
    maneuver: opts.maneuver,
    roadName: opts.roadName,
    isComplexTurn: opts.isComplexTurn,
  });
  let landmark = opts.landmark;
  try {
    const {
      isWeakVisualLandmark,
      shouldSpeakLandmarkOnTurn,
    } = require('../visualLandmarkQuality') as {
      isWeakVisualLandmark: (l: string | null | undefined) => boolean;
      shouldSpeakLandmarkOnTurn: (o: {
        landmark: string | null | undefined;
        isComplexTurn?: boolean;
        visualKind?: 'fork' | 'alley' | 'complex' | null;
        distanceM?: number | null;
      }) => boolean;
    };
    if (isWeakVisualLandmark(landmark)) landmark = null;
    if (
      !shouldSpeakLandmarkOnTurn({
        landmark,
        isComplexTurn: opts.isComplexTurn,
        visualKind,
        distanceM: opts.distanceM,
      })
    ) {
      landmark = null;
    }
  } catch {
    /* soft */
  }
  if (landmark && turn !== 'geradeaus') {
    const landKey = landmark.trim().toLowerCase();
    try {
      const g = globalThis as { __findusLastNavLandmark?: string };
      if (g.__findusLastNavLandmark === landKey) {
        landmark = null;
      } else {
        g.__findusLastNavLandmark = landKey;
      }
    } catch {
      /* soft */
    }
  }
  if (landmark && turn !== 'geradeaus') {
    return scrubRoboticNavSpeak(
      buildLandmarkFirstCue({
        landmark,
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
      landmark: null,
      roadName: opts.roadName,
      visualKind,
    }),
  );
}

/** Letzte Ansage-Abbiegung vor Arrive → Final-Approach-Cue. */
export function isFinalApproachTurn(opts: {
  waypoints: NavWaypoint[];
  turnIndex: number;
}): boolean {
  const { waypoints, turnIndex } = opts;
  if (turnIndex < 0 || turnIndex >= waypoints.length) return false;
  for (let i = turnIndex + 1; i < waypoints.length; i++) {
    const wp = waypoints[i];
    if (!wp) continue;
    const m = (wp.maneuver ?? '').toLowerCase();
    if (m.includes('arrive') || m === 'destination') return true;
    if (
      isHandsFreeSpeakTurn({
        maneuver: wp.maneuver,
        roadName: wp.roadName,
        turnComplexity: wp.turnComplexity,
      })
    ) {
      return false;
    }
  }
  return turnIndex >= waypoints.length - 3;
}

export function destSideFromManeuver(
  maneuver: string | null | undefined,
): 'left' | 'right' | null {
  const m = (maneuver ?? '').toLowerCase();
  if (m.includes('left')) return 'left';
  if (m.includes('right')) return 'right';
  return null;
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
  /** Für Final-Approach „Ziel links/rechts“ */
  waypoints?: NavWaypoint[];
}): ScheduledCue | null {
  const now = opts.nowMs ?? Date.now();
  if (!opts.onRoute) return null;
  // Stehen / noch nicht losgelaufen → keine „Du bist auf dem Weg“-Laberei
  const userMoving =
    typeof opts.speedMps === 'number' &&
    Number.isFinite(opts.speedMps) &&
    opts.speedMps >= 0.45;

  const turnIdx = opts.nextTurnIndex;
  if (turnIdx >= 0) {
    armTurnForCues(turnIdx);
  }
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
        reassureCount: reassureCountOnStretch,
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
      reassureCountOnStretch += 1;
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
  const finalApproach =
    Array.isArray(opts.waypoints) &&
    isFinalApproachTurn({
      waypoints: opts.waypoints,
      turnIndex: turnIdx,
    });
  let chainNext: { maneuver: string | null; gapM: number } | null = null;
  if (Array.isArray(opts.waypoints) && turnIdx >= 0) {
    try {
      const { findChainedNextTurn } = require('../chainedTurnCue') as {
        findChainedNextTurn: (
          wps: NavWaypoint[],
          idx: number,
        ) => { index: number; wp: NavWaypoint; gapM: number } | null;
      };
      const chained = findChainedNextTurn(opts.waypoints, turnIdx);
      if (chained) {
        chainNext = { maneuver: chained.wp.maneuver ?? null, gapM: chained.gapM };
      }
    } catch {
      /* soft */
    }
  }
  const finalText = buildFinalCueText({
    maneuver: opts.nextTurnManeuver,
    landmark: opts.nextTurnLandmark,
    roadName: opts.nextTurnRoadName,
    distanceM: dist,
    isComplexTurn: opts.isComplexTurn,
    isFinalApproach: finalApproach,
    destSide: destSideFromManeuver(opts.nextTurnManeuver),
    chainNext,
  });
  const speechSec = estimateSpeechSec(finalText);
  const startM = speakStartDistanceM({
    speechSec,
    speedMps: opts.speedMps,
    transportMode: opts.transportMode,
  });

  // Nach Abbiegung: Confirm + ggf. lange Gerade ansagen.
  if (
    confirmedTurnIndex !== turnIdx &&
    dist < 8 &&
    lastSpokenPhaseKey?.startsWith('final:')
  ) {
    confirmedTurnIndex = turnIdx;
    lastSpokenPhaseKey = phaseKey('confirm', turnIdx);
    reassureCountOnStretch = 0;
    lastReassureAtMs = 0;
    stretchArmedAtMs = now;
    // Nächste Speak-Abbiegung weit? Einmal Stretch nennen.
    if (
      Array.isArray(opts.waypoints) &&
      stretchAnnouncedForTurn !== turnIdx
    ) {
      const next = findNextTurnWaypoint({
        waypoints: opts.waypoints,
        fromIndex: turnIdx + 1,
      });
      if (next) {
        let gapM = 0;
        for (let i = turnIdx; i < next.index; i += 1) {
          const a = opts.waypoints[i]!;
          const b = opts.waypoints[i + 1];
          if (!b) break;
          const dLat = (a.lat - b.lat) * 111_320;
          const dLng =
            (a.lng - b.lng) *
            111_320 *
            Math.cos((a.lat * Math.PI) / 180);
          gapM += Math.hypot(dLat, dLng);
        }
        const stretchText = stretchAfterTurnSpeech({
          distanceM: gapM,
          roadName: next.wp.roadName ?? opts.nextTurnRoadName,
        });
        if (stretchText) {
          stretchAnnouncedForTurn = turnIdx;
          lastSpokenAtMs = now;
          lastSpokenPhaseKey = phaseKey('reassure', turnIdx);
          return {
            phase: 'reassure',
            waypointIndex: turnIdx,
            text: stretchText,
            speakStartDistanceM: gapM,
            speechSec: estimateSpeechSec(stretchText),
          };
        }
      }
    }
  }

  // Early head-up: NUR bei komplexen Kreuzungen (~30 s vorher).
  // Einfache Kreuzung = genau eine Final-Ansage.
  if (opts.isComplexTurn) {
    const speed =
      typeof opts.speedMps === 'number' && opts.speedMps >= 0.45
        ? opts.speedMps
        : opts.transportMode === 'bicycle'
          ? 5
          : 1.25;
    const warnM = Math.max(
      startM + 20,
      Math.min(
        opts.transportMode === 'bicycle' ? FINAL_CEILING_BIKE_M : FINAL_CEILING_WALK_M,
        Math.round(speed * COMPLEX_WARN_LEAD_SEC),
      ),
    );
    const key = phaseKey('warn', turnIdx);
    if (
      dist <= warnM &&
      dist > startM + 12 &&
      lastSpokenPhaseKey !== key &&
      lastSpokenPhaseKey !== phaseKey('final', turnIdx)
    ) {
      const text = buildFinalCueText({
        maneuver: opts.nextTurnManeuver,
        landmark: opts.nextTurnLandmark,
        roadName: opts.nextTurnRoadName,
        distanceM: dist,
        isComplexTurn: true,
      });
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

  // Lange Gerade vor der nächsten Gabelung — Reassure-Takt 7→15→20 Min
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
        reassureCount: reassureCountOnStretch,
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
      reassureCountOnStretch += 1;
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
    const silentMs = lastSpokenAtMs > 0 ? now - lastSpokenAtMs : 0;
    lastSpokenAtMs = now;
    let text = finalText;
    if (silentMs >= 5 * 60_000 && !opts.isComplexTurn) {
      const side = turnWord(opts.nextTurnManeuver);
      if (side === 'links' || side === 'rechts' || side === 'geradeaus') {
        try {
          const { heyAfterSilencePhrase } = require('../../tts/offlinePhraseBank') as {
            heyAfterSilencePhrase: (s: 'left' | 'right' | 'straight') => string;
          };
          text = heyAfterSilencePhrase(
            side === 'links' ? 'left' : side === 'rechts' ? 'right' : 'straight',
          );
        } catch {
          /* keep finalText */
        }
      }
    }
    return {
      phase: 'final',
      waypointIndex: turnIdx,
      text,
      speakStartDistanceM: startM,
      speechSec: estimateSpeechSec(text),
    };
  }

  return null;
}
