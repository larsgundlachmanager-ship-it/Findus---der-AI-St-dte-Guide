/**
 * Landmark Nav Coach — thin façade over Hands-Free Nav Core.
 * Opening + wrong-way + enrich delegate. Live ticks = onHandsFreeNavTick only.
 * No Google Places turn polish. No Gemini vision.
 */

import {
  speakNavWithMultitask,
  getVoiceSettingsForTour,
} from '../ttsService';
import type { PedestrianTravelMode } from './routingService';
import type { NavWaypoint, NavigationTick } from './navigationTypes';
import {
  markHandsFreeNavExplained,
  shouldExplainHandsFreeNav,
} from '../ai/featureTips';
import { resetRouteObstacleAudio } from './routeObstacleAudio';
import {
  buildInitialOrientationCue,
  buildWrongWayCue,
  relateToHeading,
  scrubRoboticNavSpeak,
} from './spatialOrientation';
import { clearNavTurnPrefetch } from './navTurnPrefetch';
import { resetLookAheadBuffer } from './lookAheadBuffer';
import {
  progressiveEnrichRoute,
  beginHandsFreeTickCoach,
  resetHandsFreeTickCoach,
  onHandsFreeNavTick,
  resetCueScheduler,
} from './handsFreeNav';

type CoachSession = {
  destinationName: string;
  destLat: number;
  destLng: number;
  openingSpoken: boolean;
  enrichEpoch: number;
  lastWrongWayAt: number;
  startLandmark: string | null;
};

let session: CoachSession | null = null;
let enrichEpoch = 0;

export function beginLandmarkNavCoach(opts: {
  destinationName: string;
  destLat: number;
  destLng: number;
}): void {
  const myEpoch = ++enrichEpoch;
  session = {
    destinationName: opts.destinationName,
    destLat: opts.destLat,
    destLng: opts.destLng,
    openingSpoken: false,
    enrichEpoch: myEpoch,
    lastWrongWayAt: 0,
    startLandmark: null,
  };
  beginHandsFreeTickCoach(opts.destinationName);
  resetCueScheduler();
}

export type EnrichedNavRoute = {
  waypoints: NavWaypoint[];
  stations: NavWaypoint[];
  travelMode: PedestrianTravelMode;
  walkingDistanceM: number;
};

/** Hands-Free progressive enrich (SSOT). */
export async function enrichNavigationRouteFull(opts: {
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  destinationName: string;
  travelMode?: PedestrianTravelMode;
}): Promise<EnrichedNavRoute | null> {
  if (
    !session ||
    session.destLat !== opts.destLat ||
    session.destLng !== opts.destLng
  ) {
    beginLandmarkNavCoach({
      destinationName: opts.destinationName,
      destLat: opts.destLat,
      destLng: opts.destLng,
    });
  }
  const myEpoch = session!.enrichEpoch;

  const result = await progressiveEnrichRoute(opts);
  if (!result || myEpoch !== enrichEpoch) return null;

  if (session && result.waypoints[0]?.landmark) {
    session.startLandmark = result.waypoints[0].landmark;
  }
  resetLookAheadBuffer();

  return {
    waypoints: result.waypoints,
    stations: result.stations,
    travelMode: result.travelMode,
    walkingDistanceM: result.walkingDistanceM,
  };
}

/** @deprecated Use enrichNavigationRouteFull */
export async function enrichNavigationRoute(opts: {
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  destinationName: string;
  travelMode?: PedestrianTravelMode;
}): Promise<NavWaypoint[] | null> {
  const full = await enrichNavigationRouteFull(opts);
  return full?.waypoints ?? null;
}

export function resetLandmarkNavCoach(): void {
  session = null;
  enrichEpoch += 1;
  clearNavTurnPrefetch();
  resetLookAheadBuffer();
  resetRouteObstacleAudio();
  resetHandsFreeTickCoach();
  resetCueScheduler();
}

async function speakNav(text: string): Promise<void> {
  const trimmed = scrubRoboticNavSpeak(text.trim());
  if (!trimmed) return;
  try {
    const voice = await getVoiceSettingsForTour();
    await speakNavWithMultitask(trimmed, {
      voiceId: voice.voiceId,
      speechRate: voice.speechRate,
    });
  } catch (err) {
    console.warn('[nav-coach] speak failed', err);
  }
}

export async function speakNavOpeningIfNeeded(
  destinationName: string,
): Promise<void> {
  if (!session || session.openingSpoken) return;
  session.openingSpoken = true;

  const explain = await shouldExplainHandsFreeNav();
  const landmark = session.startLandmark;

  if (explain) {
    await markHandsFreeNavExplained();
    const orient = buildInitialOrientationCue({
      landmark,
      relation: landmark
        ? {
            side: 'front',
            bearingRelDeg: 0,
            sidePhrase: 'voraus',
            shortPhrase: 'vor dir',
          }
        : null,
      destinationName,
    });
    await speakNav(orient);
  } else if (landmark) {
    await speakNav(
      buildInitialOrientationCue({
        landmark,
        relation: {
          side: 'front',
          bearingRelDeg: 0,
          sidePhrase: 'voraus',
          shortPhrase: 'vor dir',
        },
        destinationName,
      }),
    );
  } else {
    await speakNav(
      `Alles klar, wir laufen jetzt los zu ${destinationName}. Ich sag dir gleich wo's langgeht.`,
    );
  }
}

export function markNavOpeningSpoken(): void {
  if (session) session.openingSpoken = true;
}

export function speakWrongWayInterrupt(opts: {
  landmark: string | null;
  headingDeg: number;
  correctTargetBearingDeg: number;
  backtrackM?: number | null;
}): void {
  if (!session) return;
  const now = Date.now();
  if (now - session.lastWrongWayAt < 20_000) return;
  session.lastWrongWayAt = now;
  const relation = relateToHeading(
    opts.headingDeg,
    opts.correctTargetBearingDeg,
  );
  const cue = buildWrongWayCue({
    landmark: opts.landmark,
    relation: opts.landmark ? relation : null,
    backtrackM: opts.backtrackM,
  });
  void speakNav(cue);
}

/** Live ticks — Hands-Free only (no legacy Places/Gemini path). */
export function onNavigationTickForCoach(
  tick: NavigationTick,
  ctx: {
    waypointIndex: number;
    waypoints: NavWaypoint[];
    deviceHeadingDeg?: number | null;
    userLat?: number | null;
    userLng?: number | null;
  },
): void {
  onHandsFreeNavTick(tick, ctx);
}
