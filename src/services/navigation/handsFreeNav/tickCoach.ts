/**
 * Hands-Free tick coach — ONLY live cue path during navigation.
 * No Places, no Gemini vision, no fixed 12/40 m legacy fire.
 */

import {
  speakNavWithMultitask,
  getVoiceSettingsForTour,
} from '../../ttsService';
import { distanceAlongRouteToNextAudioTurnM } from '../exploreNavCoexistence';
import { isTurnManeuver } from '../navPredictiveCue';
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

function turnWord(maneuver: string | null | undefined): string {
  const m = (maneuver ?? '').toLowerCase();
  if (m.includes('sharp-left') || m.includes('sharp_left')) return 'scharf links';
  if (m.includes('sharp-right') || m.includes('sharp_right'))
    return 'scharf rechts';
  if (m.includes('left')) return 'links';
  if (m.includes('right')) return 'rechts';
  if (m.includes('uturn')) return 'umdrehen';
  return 'geradeaus';
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

  if (
    userLat != null &&
    userLng != null &&
    !isTransitMode(tick.transportMode) &&
    now - session.lastSpokenAt >= MIN_SPEAK_GAP_MS
  ) {
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

  const landmark =
    turnWp?.visibleLandmark?.trim() || turnWp?.landmark?.trim() || null;
  const draft = turnWp
    ? buildPredictiveTurnCue({
        turn: turnWord(turnWp.maneuver),
        distanceM: distToTurnM ?? 20,
        landmark,
        roadName: turnWp.roadName ?? null,
      })
    : 'Gleich abbiegen.';
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

  if (now - session.lastSpokenAt < MIN_SPEAK_GAP_MS) return;

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
    distToTurnM <= speakAtM + 4 &&
    distToTurnM >= 3 &&
    isTurnManeuver(turnWp.maneuver);

  if (nearTurn && turnIdx >= 0 && session.lastSpokenTurnIdx !== turnIdx) {
    session.lastSpokenTurnIdx = turnIdx;
    session.lastSpokenAt = now;
    const key = turnPrefetchKey(turnIdx, turnWp!.cue ?? draft);
    const cue = turnWp!.cue?.trim() || draft;
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
  });
  if (scheduled && scheduled.phase !== 'final') {
    // final handled above with prefetch
    session.lastSpokenAt = now;
    void speak(scheduled.text);
  }
}
