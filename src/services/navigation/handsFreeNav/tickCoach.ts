/**
 * Hands-Free tick coach — ONLY live cue path during navigation.
 * No Places, no Gemini vision, no fixed 12/40 m legacy fire.
 */

import {
  speakNavWithMultitask,
  getVoiceSettingsForTour,
} from '../../ttsService';
import { distanceAlongRouteToNextAudioTurnM } from '../exploreNavCoexistence';
import { isHandsFreeSpeakTurn } from '../navPredictiveCue';
import type { NavigationTick, NavWaypoint } from '../navigationTypes';
import { shouldPauseTurnByTurn } from '../boardingDetector';
import { isTransitMode } from '../transportMode';
import { maybeRouteObstacleCue } from '../routeObstacleAudio';
import {
  buildArrivalSoonCue,
  buildPredictiveTurnCue,
  relateFromRelativeBearing,
  scrubRoboticNavSpeak,
} from '../spatialOrientation';
import {
  clearNavTurnPrefetch,
  playPrefetchedNavTurnIfReady,
  takeNavTurnCueText,
  turnPrefetchKey,
  warmNavTurnCue,
} from '../navTurnPrefetch';
import { ensureHybridAudioWindow } from '../navHybridOffline';
import { tickLookAheadBuffer, isComplexTurnWaypoint } from '../lookAheadBuffer';
import {
  pickCueForTick,
  speakStartDistanceM,
  warmDistanceM,
  estimateSpeechSec,
  findNextTurnWaypoint,
  buildFinalCueText,
  noteCuePhaseSpoken,
  armTurnForCues,
} from './cueScheduler';
import { etaMinutesFromRoute } from './eta';

const MIN_SPEAK_GAP_MS = 4_500;

type TickSession = {
  destinationName: string;
  lastSpokenAt: number;
  lastSpokenTurnIdx: number;
  arrivalSoonSpoken: boolean;
  warmedKeys: Set<string>;
};

let tickSession: TickSession | null = null;

export function beginHandsFreeTickCoach(destinationName: string): void {
  tickSession = {
    destinationName,
    lastSpokenAt: 0,
    lastSpokenTurnIdx: -1,
    arrivalSoonSpoken: false,
    warmedKeys: new Set(),
  };
  clearNavTurnPrefetch();
}

export function resetHandsFreeTickCoach(): void {
  tickSession = null;
  clearNavTurnPrefetch();
}

async function speak(text: string): Promise<void> {
  const trimmed = scrubRoboticNavSpeak(text.trim());
  if (!trimmed) return;
  try {
    const voice = await getVoiceSettingsForTour();
    await speakNavWithMultitask(trimmed, {
      voiceId: voice.voiceId,
      speechRate: voice.speechRate,
    });
  } catch (err) {
    console.warn('[handsFree-tick] speak failed', err);
  }
}

/**
 * Single entry for GPS nav ticks — hands-free vision only.
 */
export function onHandsFreeNavTick(
  tick: NavigationTick,
  ctx: {
    waypointIndex: number;
    waypoints: NavWaypoint[];
    deviceHeadingDeg?: number | null;
    userLat?: number | null;
    userLng?: number | null;
  },
): void {
  if (!tickSession) return;
  try {
    const { useFinnusStore } = require('../../../store/useFinnusStore') as {
      useFinnusStore: {
        getState: () => { isListening?: boolean; isGenerating?: boolean };
      };
    };
    const voice = useFinnusStore.getState();
    // Do not run look-ahead/prefetch or speak into STT/manager work. The tick
    // remains unconsumed, so the next GPS fix can still issue the turn cue.
    if (voice.isListening || voice.isGenerating) return;
  } catch {
    /* soft */
  }
  const now = Date.now();
  const session = tickSession;

  ensureHybridAudioWindow(ctx.waypointIndex, ctx.waypoints);

  if (tick.navPhase && shouldPauseTurnByTurn(tick.navPhase)) return;

  const userLat = ctx.userLat ?? null;
  const userLng = ctx.userLng ?? null;

  if (userLat != null && userLng != null) {
    tickLookAheadBuffer({
      userLat,
      userLng,
      waypointIndex: ctx.waypointIndex,
      waypoints: ctx.waypoints,
      transportMode: tick.transportMode,
    });
  }

  const next = findNextTurnWaypoint({
    waypoints: ctx.waypoints,
    fromIndex: ctx.waypointIndex,
  });
  const turnIdx = next?.index ?? -1;
  const turnWp = next?.wp ?? null;

  let distToTurnM: number | null = null;
  if (turnIdx >= 0 && userLat != null && userLng != null) {
    distToTurnM = distanceAlongRouteToNextAudioTurnM(
      ctx.waypoints,
      ctx.waypointIndex,
      userLat,
      userLng,
    );
  } else if (turnIdx >= 0) {
    distToTurnM = tick.distanceToArrowM;
  }

  let landmark =
    turnWp?.visibleLandmark?.trim() || turnWp?.landmark?.trim() || null;
  try {
    const { isWeakVisualLandmark } = require('../visualLandmarkQuality') as {
      isWeakVisualLandmark: (l: string | null | undefined) => boolean;
    };
    if (isWeakVisualLandmark(landmark)) landmark = null;
  } catch {
    /* soft */
  }
  let chainNext: { maneuver: string | null; gapM: number } | null = null;
  if (turnWp && turnIdx >= 0) {
    try {
      const { findChainedNextTurn } = require('../chainedTurnCue') as {
        findChainedNextTurn: (
          wps: typeof ctx.waypoints,
          idx: number,
        ) => { index: number; wp: (typeof ctx.waypoints)[0]; gapM: number } | null;
      };
      const chained = findChainedNextTurn(ctx.waypoints, turnIdx);
      if (chained) {
        chainNext = {
          maneuver: chained.wp.maneuver ?? null,
          gapM: chained.gapM,
        };
      }
    } catch {
      /* soft */
    }
  }
  const draft = turnWp
    ? buildFinalCueText({
        maneuver: turnWp.maneuver,
        landmark,
        roadName: turnWp.roadName ?? null,
        distanceM: distToTurnM ?? 20,
        isComplexTurn: turnWp.turnComplexity === 'complex',
        chainNext,
      })
    : buildPredictiveTurnCue({
        turn: 'links',
        distanceM: 20,
        landmark: null,
        roadName: null,
        visualKind: null,
      });
  const speechSec = estimateSpeechSec(draft);
  const speakAtM = speakStartDistanceM({
    speechSec,
    speedMps: tick.speedMs,
    transportMode: tick.transportMode,
  });
  const warmAtM = warmDistanceM({
    speechSec,
    speedMps: tick.speedMs,
    transportMode: tick.transportMode,
  });

  if (
    userLat != null &&
    userLng != null &&
    !isTransitMode(tick.transportMode) &&
    now - session.lastSpokenAt >= MIN_SPEAK_GAP_MS
  ) {
    const nearTurnSoon =
      distToTurnM != null &&
      distToTurnM <= speakAtM + 20 &&
      turnIdx >= 0;
    // Nahe an Abbiegung: keine Obstacle-Cue die die Rechts-/Fork-Ansage blockt
    if (!nearTurnSoon) {
      const obstacleCue = maybeRouteObstacleCue({
        lat: userLat,
        lng: userLng,
        speakStairs: true,
      });
      if (obstacleCue) {
        session.lastSpokenAt = now;
        void speak(obstacleCue);
        return;
      }
    }
  }

  // Warm TTS
  if (
    turnWp &&
    turnIdx >= 0 &&
    distToTurnM != null &&
    distToTurnM <= warmAtM &&
    distToTurnM > speakAtM
  ) {
    const key = turnPrefetchKey(turnIdx, turnWp.cue ?? draft);
    if (!session.warmedKeys.has(key)) {
      session.warmedKeys.add(key);
      void warmNavTurnCue(key, turnWp.cue?.trim() || draft);
    }
  }

  const turnImminentForGap =
    distToTurnM != null &&
    distToTurnM <= speakAtM + 15 &&
    turnIdx >= 0 &&
    isHandsFreeSpeakTurn({
      maneuver: turnWp?.maneuver,
      roadName: turnWp?.roadName,
      turnComplexity: turnWp?.turnComplexity,
    });
  // Neue Abbiegung: Gap darf Warn/Final der nächsten Kreuzung nicht schlucken.
  const newTurnPending =
    turnIdx >= 0 &&
    turnIdx !== session.lastSpokenTurnIdx &&
    isHandsFreeSpeakTurn({
      maneuver: turnWp?.maneuver,
      roadName: turnWp?.roadName,
      turnComplexity: turnWp?.turnComplexity,
    });
  if (
    now - session.lastSpokenAt < MIN_SPEAK_GAP_MS &&
    !turnImminentForGap &&
    !newTurnPending
  ) {
    return;
  }
  if (turnIdx >= 0) armTurnForCues(turnIdx);

  // Arrival soon
  if (
    tick.distanceToDestinationM <= 45 &&
    tick.distanceToDestinationM > 18 &&
    !session.arrivalSoonSpoken
  ) {
    session.arrivalSoonSpoken = true;
    session.lastSpokenAt = now;
    void speak(
      buildArrivalSoonCue(
        session.destinationName,
        relateFromRelativeBearing(tick.bearingRelDeg),
        { visualSign: null },
      ),
    );
    return;
  }

  const eta = etaMinutesFromRoute({
    remainingRouteM: tick.distanceToDestinationM,
  });
  const onRoute = (tick.distanceToPathM ?? 0) < 25;

  // Final turn fire (time-based)
  const nearTurn =
    turnWp &&
    distToTurnM != null &&
    distToTurnM <= speakAtM + 12 &&
    distToTurnM >= 0 &&
    isHandsFreeSpeakTurn({
      maneuver: turnWp.maneuver,
      roadName: turnWp.roadName,
      turnComplexity: turnWp.turnComplexity,
    });

  if (nearTurn && turnIdx >= 0 && session.lastSpokenTurnIdx !== turnIdx) {
    // Nur diese Abbiegung als gesprochen markieren.
    // Nie die Folgekurbel vorab als „schon gesagt“ setzen — sonst zweite Kreuzung stumm.
    session.lastSpokenTurnIdx = turnIdx;
    session.lastSpokenAt = now;
    noteCuePhaseSpoken('final', turnIdx, now);
    try {
      const { vibrateNavTurnFromManeuver } = require('../navTurnHaptics') as {
        vibrateNavTurnFromManeuver: (m: string | null | undefined) => void;
      };
      vibrateNavTurnFromManeuver(turnWp?.maneuver);
    } catch {
      /* soft */
    }
    const key = turnPrefetchKey(turnIdx, turnWp!.cue ?? draft);
    // Einfach: immer Draft (feste Phrase / Cache). Komplex: Landmark-Draft ok.
    const cueRaw = turnWp!.cue?.trim() || '';
    const complexTurn =
      turnWp!.turnComplexity === 'complex' || chainNext != null;
    const cueLooksStreet =
      /\b(straße|strasse|weg|allee|gasse|platz|ring|damm)\b/iu.test(cueRaw);
    const cue = !complexTurn
      ? draft
      : landmark && (cueLooksStreet || !cueRaw)
        ? draft
        : cueRaw || draft;
    void (async () => {
      const played = await playPrefetchedNavTurnIfReady(key);
      if (played) return;
      const prefetched = takeNavTurnCueText(key);
      await speak(prefetched ?? cue);
    })();
    return;
  }

  // Warn / confirm / reassure via scheduler
  const scheduled = pickCueForTick({
    distanceToNextTurnM: distToTurnM ?? Number.POSITIVE_INFINITY,
    nextTurnIndex: turnIdx,
    nextTurnManeuver: turnWp?.maneuver ?? null,
    nextTurnLandmark: landmark,
    nextTurnRoadName: turnWp?.roadName ?? null,
    remainingRouteM: tick.distanceToDestinationM,
    etaMin: eta.etaMin,
    speedMps: tick.speedMs,
    transportMode: tick.transportMode,
    onRoute,
    isComplexTurn: isComplexTurnWaypoint(turnWp),
    nowMs: now,
    waypoints: ctx.waypoints,
  });
  if (scheduled && scheduled.phase !== 'final') {
    // final handled above with prefetch
    session.lastSpokenAt = now;
    if (scheduled.phase === 'warn' || scheduled.phase === 'final') {
      noteCuePhaseSpoken(scheduled.phase, turnIdx, now);
      try {
        const { vibrateNavTurnFromManeuver } = require('../navTurnHaptics') as {
          vibrateNavTurnFromManeuver: (m: string | null | undefined) => void;
        };
        vibrateNavTurnFromManeuver(turnWp?.maneuver);
      } catch {
        /* soft */
      }
    }
    void speak(scheduled.text);
  }
}
