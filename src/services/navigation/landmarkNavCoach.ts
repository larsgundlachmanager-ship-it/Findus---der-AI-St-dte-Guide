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
  /** Opening darf erst nach committed Route (kein Luftlinien-ETA). */
  routeReady: boolean;
  enrichEpoch: number;
  lastWrongWayAt: number;
  startLandmark: string | null;
  firstTurn: {
    turn: string;
    landmark: string | null;
    roadName: string | null;
    distanceM: number | null;
  } | null;
  etaMin: number | null;
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
    routeReady: false,
    enrichEpoch: myEpoch,
    lastWrongWayAt: 0,
    startLandmark: null,
    firstTurn: null,
    etaMin: null,
  };
  beginHandsFreeTickCoach(opts.destinationName);
  resetCueScheduler();
}

/** Nach OSRM/Enrich: Route ist die „beste“ — erst dann Opening. */
export function markNavRouteReady(opts?: {
  etaMin?: number | null;
  startLandmark?: string | null;
  firstTurn?: CoachSession['firstTurn'];
}): void {
  if (!session) return;
  session.routeReady = true;
  if (opts?.etaMin != null && Number.isFinite(opts.etaMin)) {
    session.etaMin = Math.max(1, Math.round(opts.etaMin));
  }
  if (opts?.startLandmark) session.startLandmark = opts.startLandmark;
  if (opts?.firstTurn) session.firstTurn = opts.firstTurn;
}

export function isNavRouteReadyForSpeech(): boolean {
  return Boolean(session?.routeReady);
}

export type EnrichedNavRoute = {
  waypoints: NavWaypoint[];
  stations: NavWaypoint[];
  travelMode: PedestrianTravelMode;
  walkingDistanceM: number;
  etaMin?: number;
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

  // First turn for opening visual cue
  let firstTurn: CoachSession['firstTurn'] = null;
  try {
    const { findNextTurnWaypoint } = require('./handsFreeNav/cueScheduler') as {
      findNextTurnWaypoint: (o: {
        waypoints: typeof result.waypoints;
        fromIndex: number;
      }) => { index: number; wp: (typeof result.waypoints)[0] } | null;
    };
    const { isTurnManeuver } = require('./navPredictiveCue') as {
      isTurnManeuver: (m: string | null | undefined) => boolean;
    };
    const next = findNextTurnWaypoint({
      waypoints: result.waypoints,
      fromIndex: 0,
    });
    if (next && isTurnManeuver(next.wp.maneuver)) {
      const m = (next.wp.maneuver ?? '').toLowerCase();
      let turn = 'geradeaus';
      if (m.includes('uturn') || m.includes('u-turn')) turn = 'umdrehen';
      else if (m.includes('left')) turn = m.includes('sharp') ? 'scharf links' : m.includes('slight') ? 'leicht links' : 'links';
      else if (m.includes('right')) turn = m.includes('sharp') ? 'scharf rechts' : m.includes('slight') ? 'leicht rechts' : 'rechts';
      let distM: number | null = null;
      if (result.waypoints.length > 1) {
        const { distanceMeters } = require('./bearing') as {
          distanceMeters: (
            a: number,
            b: number,
            c: number,
            d: number,
          ) => number;
        };
        distM = Math.round(
          distanceMeters(
            opts.originLat,
            opts.originLng,
            next.wp.lat,
            next.wp.lng,
          ),
        );
      }
      firstTurn = {
        turn,
        landmark:
          next.wp.visibleLandmark?.trim() ||
          next.wp.landmark?.trim() ||
          null,
        roadName: next.wp.roadName ?? null,
        distanceM: distM,
      };
    }
  } catch {
    /* soft */
  }

  markNavRouteReady({
    etaMin: result.etaMin,
    startLandmark: session?.startLandmark ?? result.waypoints[0]?.landmark ?? null,
    firstTurn,
  });

  return {
    waypoints: result.waypoints,
    stations: result.stations,
    travelMode: result.travelMode,
    walkingDistanceM: result.walkingDistanceM,
    etaMin: result.etaMin,
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
  // Kritisch: nie vor committed Route sprechen (kein Luftlinien-ETA)
  if (!session.routeReady) return;

  session.openingSpoken = true;

  const explain = await shouldExplainHandsFreeNav();
  if (explain) {
    await markHandsFreeNavExplained();
  }

  let etaMin = session.etaMin;
  let phraseEta: number | null = null;
  try {
    const { getCommittedRoutePhrase } = require('./navSpeechDistance') as {
      getCommittedRoutePhrase: () => { etaMin: number | null } | null;
    };
    const phrase = getCommittedRoutePhrase();
    if (phrase?.etaMin != null) {
      phraseEta = phrase.etaMin;
      etaMin = phrase.etaMin;
    }
  } catch {
    /* soft */
  }
  let storeEta: number | null = null;
  try {
    const { useFinnusStore } = require('../../store/useFinnusStore') as {
      useFinnusStore: { getState: () => { navEtaMin?: number | null } };
    };
    const raw = useFinnusStore.getState().navEtaMin;
    storeEta =
      raw != null && Number.isFinite(raw) ? Math.max(1, Math.round(raw)) : null;
  } catch {
    /* soft */
  }

  let relation: import('./spatialOrientation').SpatialRelation | null = null;
  try {
    const { getLiveDeviceHeadingDeg } = require('./liveDeviceHeading') as {
      getLiveDeviceHeadingDeg: () => number | null;
    };
    const { bearingDegrees } = require('./bearing') as {
      bearingDegrees: (a: number, b: number, c: number, d: number) => number;
    };
    const { relateToHeading } = require('./spatialOrientation') as {
      relateToHeading: (
        h: number,
        t: number,
      ) => import('./spatialOrientation').SpatialRelation;
    };
    const { useFinnusStore } = require('../../store/useFinnusStore') as {
      useFinnusStore: {
        getState: () => { lastGpsLat?: number | null; lastGpsLng?: number | null };
      };
    };
    const st = useFinnusStore.getState();
    const hdg = getLiveDeviceHeadingDeg();
    if (
      hdg != null &&
      st.lastGpsLat != null &&
      st.lastGpsLng != null &&
      session
    ) {
      const target =
        session.firstTurn != null
          ? // facing toward first meters of path ≈ dest if no turn geo
            bearingDegrees(
              st.lastGpsLat,
              st.lastGpsLng,
              session.destLat,
              session.destLng,
            )
          : bearingDegrees(
              st.lastGpsLat,
              st.lastGpsLng,
              session.destLat,
              session.destLng,
            );
      relation = relateToHeading(hdg, target);
    }
  } catch {
    /* soft */
  }

  const { buildFirstVisualDirection, buildNavStartSpeech } = require('./navStartSpeech') as {
    buildFirstVisualDirection: (o: {
      turn: string | null;
      landmark: string | null;
      roadName: string | null;
      relation?: import('./spatialOrientation').SpatialRelation | null;
      distanceToFirstTurnM?: number | null;
    }) => string | null;
    buildNavStartSpeech: (o: {
      firstVisual: string | null;
      relation?: import('./spatialOrientation').SpatialRelation | null;
      etaMin: number | null;
      pathHint?: string | null;
    }) => string;
  };

  const ft = session.firstTurn;
  const firstVisual = buildFirstVisualDirection({
    turn: ft?.turn ?? null,
    landmark: ft?.landmark || session.startLandmark,
    roadName: null,
    relation,
    distanceToFirstTurnM: ft?.distanceM ?? null,
  });

  void destinationName; // Ziel liegt in HUD — Opener dump’t Namen nicht
  await speakNav(
    buildNavStartSpeech({
      firstVisual,
      relation,
      etaMin,
      // Keine Straßennamen in der Start-Ansage
      pathHint: null,
    }),
  );
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
  // Pro Nav-Session höchstens alle 45 s — Monitor sorgt schon für 1× pro Episode
  if (now - session.lastWrongWayAt < 45_000) return;
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
