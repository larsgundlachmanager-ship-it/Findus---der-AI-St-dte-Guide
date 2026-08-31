/**
 * Smart Compass — high-frequency navigation (1 Hz GPS).
 * Speed-aware thresholds for walk / bicycle / transit.
 */

import * as Location from 'expo-location';
import type { LocationSubscription } from 'expo-location';
import { Platform } from 'react-native';
import { getPoiWithFacts } from '../../db/database';
import { useFinnusStore } from '../../store/useFinnusStore';
import { getCachedUserProfile } from '../userProfileService';
import {
  getGpsStreamProfile,
  requestLocationPermission,
  setGpsStreamProfile,
} from '../locationService';
import { speakAssistantText } from '../ttsService';
import { getLiveDeviceHeadingDeg, getMapDisplayHeadingDeg, headingFromExpoEvent, noteHeadingAccuracy, noteExpoCompassHeading } from './liveDeviceHeading';
import {
  getCachedRoute,
  putCachedRoute,
  upsertCachedDestination,
} from './offlineNavCache';
import { isDeviceOffline } from './networkState';
import {
  bearingDegrees,
  distanceMeters,
  relativeBearingDeg,
  shortestAngleDelta,
} from './bearing';
import { hapticNavTargetSet, hapticTurnImminent } from './haptics';
import {
  onNavigationEnd as runtimeNavEnd,
  onNavigationStart as runtimeNavStart,
} from '../../runtime/orchestrator';
import { module1NavMuteRadiusM } from './modulePriorityPolicy';
import { getNavWaypointsForSpot } from './navWaypointsRegistry';
import { PositionLowPass } from './sensorFilter';
import {
  ARRIVAL_FALLBACK_M,
  CLOSE_RANGE_EXIT_M,
  CLOSE_RANGE_M,
  GPS_REALTIME_DISTANCE_M,
  GPS_REALTIME_INTERVAL_MS,
  TURN_IMMINENT_DEG,
  type AttentionCue,
  type NavDestination,
  type NavMode,
  type NavigationTick,
  type NavWaypoint,
  type TransportMode,
} from './navigationTypes';
import {
  pushAdaptiveHeading,
  resetHandsFreeCompass,
  shouldDisableCompassWatch,
  noteHandsFreeEtaGps,
  etaMinutesFromRoute,
  resetHandsFreeEta,
  resetCueScheduler,
  alignWaypointsForUserSide,
  arrowTargetFromWaypoint,
  findNextTurnWaypoint,
} from './handsFreeNav';
import { isTurnManeuver } from './navPredictiveCue';
import {
  classifyMotionTransportMode,
  directionsModeForNav,
  getSmoothedSpeedMs,
  isTransitMode,
  pushSpeedSample,
  resetMotionTransportState,
  thresholdsForMode,
} from './transportMode';
import { markNavigationUsed } from '../ai/featureTips';
import { verifyNavDestBeforeCommit } from './navDestVerify';
import {
  beginLandmarkNavCoach,
  enrichNavigationRouteFull,
  markNavOpeningSpoken,
  markNavRouteReady,
  onNavigationTickForCoach,
  resetLandmarkNavCoach,
  speakNavOpeningIfNeeded,
} from './landmarkNavCoach';
import {
  maybeSpeakAlightNow,
  onRemainingStationsChanged,
  resetStationCountdownAnnouncements,
} from './stationCountdown';
import { tickTransitGuide, resetTransitGuideCoach } from './transitGuideCoach';
import { getPackTransitStops } from '../transit/stationRegistry';
import { advanceMultiStopTour } from './multiStopTour';
import { notifyNavRouteGeometryChanged } from './navRouteRev';
import {
  setPreferredTravelMode,
  travelModeNavPrefs,
} from './travelModeContext';
import type { PedestrianTravelMode } from './googleMapsNav';
import {
  SPLINE_ADVANCE_M,
} from './routeSpline';
import {
  tickMapMatch,
  initMapMatchEngine,
  resetMapMatchEngine,
  detectMissedTurn,
  getMapMatchSpline,
  getProjectionIndex,
} from './mapMatchEngine';
import {
  computeSmartArrow,
  resetSmartArrow,
  distanceAlongRouteToNextTurnM,
} from './smartArrow';
import { shouldPauseExploreForNavTurn } from './exploreNavCoexistence';
import {
  pushGpsTrackFix,
  resetGpsTrackBuffer,
  getTrackMovementBearingDeg,
} from './gpsTrackBuffer';
import {
  resetWrongWayMonitor,
  tickWrongWayMonitor,
  markRerouteFired,
  markRerouteAttemptFailed,
  markRerouteAttemptStarted,
} from './wrongWayMonitor';
import {
  resetBoardingDetector,
  tickBoardingDetector,
} from './boardingDetector';
import { formatNavTurnHint } from './navTurnHint';
import type { NavPhase } from './navigationTypes';
import { clearNavTurnPrefetch } from './navTurnPrefetch';
import {
  announceNavHybridOfflineRerouteBlocked,
  bootstrapNavHybridSession,
  setNavHybridHasTransit,
  stopNavHybridSession,
} from './navHybridOffline';
import { predictiveSpeakDistanceM } from './navPredictiveCue';
import {
  navTrackingPushGpsFix,
  navTrackingStart,
  navTrackingStop,
  navTrackingUpdateWaypoints,
} from '../feedback/executionTracking';

let active: NavDestination | null = null;
let waypointIndex = 0;
/** Silent auto-reroute in flight. */
let rerouteInFlight = false;
/** Arrival speech/handler already started for this nav session. */
let arrivalInFlight = false;
/** Map-Tap in der Nähe: erste Ticks nicht als Ankunft werten. */
let suppressArrivalUntilMs = 0;
/** Sticky mode with exit hysteresis (see CLOSE_RANGE_EXIT_M). */
let modeSticky: NavMode = 'routing';
let headingDeg = 0;
let lastLat: number | null = null;
let lastLng: number | null = null;
/** Smart-Arrow / Map-Match snapshot for Modul 1 coexistence. */
let navAlongM = 0;
let navDistToNextTurnM: number | null = null;
let navDistToArrowM: number | null = null;
let posSub: LocationSubscription | null = null;
let headingSub: LocationSubscription | null = null;
let turnHapticArmed = true;
let fadeCompleteTimer: ReturnType<typeof setTimeout> | null = null;
/** Optional simulated user position (SimulationPicker / no GPS). */
let simulatedCoords: { lat: number; lng: number } | null = null;
let lastTransportMode: TransportMode = 'walk';
/** Zuletzt geroutetes Profil (Fuß/Rad) — bei Wechsel still neu planen. */
let lastRoutedProfile: 'foot' | 'bike' | null = null;
let lastShortcutRerouteAtMs = 0;
/** Laufender Fuß↔Rad-Profilwechsel — verhindert Spam bis Success/Fail. */
let modeSwitchPending: 'foot' | 'bike' | null = null;
let lastRemainingStations: number | null = null;
let navTotalDistanceM: number | null = null;
/** GPS course / movement bearing when available. */
let movementBearingDeg: number | null = null;
let lastNavPhase: NavPhase = 'idle';
let announcedNavPhase: NavPhase = 'idle';
/** HUD-Distanz: Hysterese gegen GPS-Zittern. */
let displayedNavDistanceM: number | null = null;
/** True when current route has transit legs. */
let routeHasTransitLegs = false;

/** Fuß/Rad-ETA ≤ 10 Min → neue Route sofort berechnen & übernehmen (Just-Do-It). */
export const SHORT_ROUTE_AUTO_ETA_MIN = 10;

const positionFilter = new PositionLowPass(0.35, 28);

/** Summe der Segmentlängen — für Auto-Umweg-Erkennung im Offline-Cache. */
function waypointPathLengthM(
  waypoints: Array<{ lat: number; lng: number }>,
): number {
  if (waypoints.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const a = waypoints[i - 1]!;
    const b = waypoints[i]!;
    total += distanceMeters(a.lat, a.lng, b.lat, b.lng);
  }
  return total;
}

let lastPushMs = 0;
let pendingNavPatch: Parameters<typeof pushStoreNav>[0] | null = null;
let navPushTimeout: ReturnType<typeof setTimeout> | null = null;

function applyNavStorePatch(partial: {
  navActive?: boolean;
  navVisible?: boolean;
  navMode?: NavMode | null;
  navTargetName?: string | null;
  navDistanceM?: number | null;
  navBearingRel?: number | null;
  attentionCue?: AttentionCue;
  transportMode?: TransportMode | null;
  remainingStations?: number | null;
  navNextTargetName?: string | null;
  navLegDistanceM?: number | null;
  navTotalDistanceM?: number | null;
  navEtaMin?: number | null;
  navTurnHint?: string | null;
  navPhase?: NavPhase | null;
}): void {
  const merged = pendingNavPatch ? { ...pendingNavPatch, ...partial } : partial;
  pendingNavPatch = null;
  lastPushMs = Date.now();
  if (navPushTimeout) {
    clearTimeout(navPushTimeout);
    navPushTimeout = null;
  }
  useFinnusStore.getState().patchNavigation(merged);
  try {
    const { upsertLiveNavFromStore, clearLiveNavFromPlan, allowLiveNavMirror } = require('../../module2/timeline/syncLiveNavToPlan') as {
      upsertLiveNavFromStore: (o?: { force?: boolean }) => void;
      clearLiveNavFromPlan: (o?: { abandon?: boolean }) => void;
      allowLiveNavMirror: () => void;
    };
    if (merged.navActive === false) clearLiveNavFromPlan({ abandon: true });
    else {
      if (merged.navActive === true) allowLiveNavMirror();
      upsertLiveNavFromStore({ force: merged.navActive === true });
    }
  } catch {
    /* soft */
  }
}

function pushStoreNav(partial: Parameters<typeof applyNavStorePatch>[0]): void {
  // Start/Stop darf nicht 1s debounce warten — sonst wirkt „Navigation“ tot.
  if (typeof partial.navActive === 'boolean') {
    applyNavStorePatch(partial);
    return;
  }
  const now = Date.now();
  if (now - lastPushMs >= 1000) {
    if (navPushTimeout) {
      clearTimeout(navPushTimeout);
      navPushTimeout = null;
    }
    applyNavStorePatch(partial);
  } else {
    pendingNavPatch = { ...pendingNavPatch, ...partial };
    if (!navPushTimeout) {
      navPushTimeout = setTimeout(() => {
        if (pendingNavPatch) {
          const patch = pendingNavPatch;
          useFinnusStore.getState().patchNavigation(patch);
          pendingNavPatch = null;
          lastPushMs = Date.now();
          try {
            const { upsertLiveNavFromStore, clearLiveNavFromPlan, allowLiveNavMirror } = require('../../module2/timeline/syncLiveNavToPlan') as {
              upsertLiveNavFromStore: (o?: { force?: boolean }) => void;
              clearLiveNavFromPlan: (o?: { abandon?: boolean }) => void;
              allowLiveNavMirror: () => void;
            };
            if (patch.navActive === false) clearLiveNavFromPlan({ abandon: true });
            else {
              if (patch.navActive === true) allowLiveNavMirror();
              upsertLiveNavFromStore({ force: patch.navActive === true });
            }
          } catch {
            /* soft */
          }
        }
        navPushTimeout = null;
      }, 1000 - (now - lastPushMs));
    }
  }
}

function profileTransportHints(walkDistanceM?: number | null): {
  preferTransit: boolean;
  preferBike: boolean;
} {
  return travelModeNavPrefs(undefined, { walkDistanceM });
}

function resolveMode(distanceToDestinationM: number): NavMode {
  if (distanceToDestinationM < CLOSE_RANGE_M) {
    modeSticky = 'close_range';
  } else if (distanceToDestinationM > CLOSE_RANGE_EXIT_M) {
    modeSticky = 'routing';
  }
  return modeSticky;
}

function smartArrowLabel(mode: NavMode): string {
  if (!active) return '';
  if (mode === 'close_range' || active.waypoints.length === 0) {
    return active.name;
  }
  const wp =
    active.waypoints[Math.min(waypointIndex, active.waypoints.length - 1)];
  if (waypointIndex >= active.waypoints.length - 1) {
    return active.name;
  }
  const raw =
    wp?.stationName?.trim() ||
    wp?.visibleLandmark?.trim() ||
    wp?.landmark?.trim() ||
    '';
  // Personennamen / Laden-Initialen („C. Jansen“) nicht als HUD-Ziel
  if (!raw || /^[A-ZÄÖÜ]\.\s+\w+/u.test(raw)) {
    return active.name;
  }
  return raw;
}

/** Haltestellen-Kette: explizit oder Waypoints mit isStation. Nie alle Fuß-WPs. */
function stationList(): NavWaypoint[] {
  if (!active) return [];
  if (active.stations && active.stations.length > 0) return active.stations;
  if (active.waypoints.some((w) => w.isStation)) {
    return active.waypoints.filter((w) => w.isStation);
  }
  return [];
}

/** Pack-Haltestellen als Fallback-Kette Richtung Ziel. */
function packStationsTowardDestination(): NavWaypoint[] {
  if (!active) return [];
  const stops = getPackTransitStops();
  if (!stops.length) return [];
  const destLat = active.lat;
  const destLng = active.lng;
  // Sortiere grob nach Distanz zum Ziel (nah am Ziel = später in der Kette)
  const ranked = [...stops].sort((a, b) => {
    const da = distanceMeters(a.lat, a.lng, destLat, destLng);
    const db = distanceMeters(b.lat, b.lng, destLat, destLng);
    return db - da;
  });
  return ranked.map((s) => ({
    lat: s.lat,
    lng: s.lng,
    isStation: true,
    stationName: s.name,
    landmark: s.name,
    instruction: s.name,
  }));
}

function computeRemainingStations(
  lat: number,
  lng: number,
  transportMode: TransportMode,
): number | null {
  if (!active || !isTransitMode(transportMode)) return null;
  const stations = stationList();
  if (stations.length === 0) {
    const d = distanceMeters(lat, lng, active.lat, active.lng);
    return Math.max(1, Math.round(d / 400));
  }
  const thr = thresholdsForMode(transportMode).stationPassM;
  let nextIdx = 0;
  for (let i = 0; i < stations.length; i++) {
    const d = distanceMeters(lat, lng, stations[i].lat, stations[i].lng);
    if (d <= thr) {
      nextIdx = i + 1;
    } else {
      break;
    }
  }
  // Verbleibende Stationen auf der Kette + Ziel
  return Math.max(0, stations.length - nextIdx) + 1;
}

function computeTick(
  lat: number,
  lng: number,
  heading: number,
  speedMs?: number | null,
): NavigationTick | null {
  if (!active) return null;

  const hints = profileTransportHints();
  if (typeof speedMs === 'number') pushSpeedSample(speedMs);
  const transportMode = classifyMotionTransportMode({
    speedMs: speedMs ?? getSmoothedSpeedMs(),
    preferTransit: hints.preferTransit,
    preferBike: hints.preferBike,
  });
  lastTransportMode = transportMode;
  
  // Dynamic GPS throttling based on transport mode
  const currentProfile = getGpsStreamProfile();
  if (transportMode === 'bicycle' && currentProfile === 'realtime') {
    void setGpsStreamProfile('realtime-bike');
  } else if (transportMode !== 'bicycle' && currentProfile === 'realtime-bike') {
    void setGpsStreamProfile('realtime');
  }

  const thr = thresholdsForMode(transportMode);

  const distanceToDestinationAirM = distanceMeters(
    lat,
    lng,
    active.lat,
    active.lng,
  );
  const mode = resolveMode(distanceToDestinationAirM);

  const denseSpline = active.waypoints.length > 12;
  const advanceM = denseSpline
    ? SPLINE_ADVANCE_M
    : thr.waypointAdvanceM;

  let distanceToPathM: number | null = null;
  let alongM = 0;

  if (mode === 'routing' && active.waypoints.length > 0) {
    const prevWpIdx = waypointIndex;
    const match = tickMapMatch({
      lat,
      lng,
      waypoints: active.waypoints,
      waypointIndex,
      advanceM,
    });
    if (match.waypointIndex > prevWpIdx) {
      hapticNavTargetSet();
      turnHapticArmed = true;
    }
    waypointIndex = match.waypointIndex;
    distanceToPathM = match.distanceToPathM;
    const newAlong = match.projection?.alongM ?? 0;
    if (newAlong > alongM + 80) {
      resetSmartArrow();
    }
    alongM = newAlong;
  }

  // Sidewalk-Align nur für Labels/Coach — Kompass kommt aus Smart-Arrow (Spline voraus).
  // Früher: Override auf waypointIndex+1 → zeigt rückwärts wenn Breadcrumb hinterherhinkt.
  const gpsAccuracyM = useFinnusStore.getState().gpsAccuracyM;
  const aligned = alignWaypointsForUserSide({
    waypoints: active.waypoints,
    userLat: lat,
    userLng: lng,
    gpsAccuracyM,
    fromIndex: waypointIndex,
  });

  const spline = getMapMatchSpline();
  const splineRemainM =
    spline.length > 0
      ? Math.max(0, (spline[spline.length - 1]?.alongM ?? 0) - alongM)
      : null;

  // Reststrecke: Spline-Rest bevorzugt; Luftlinie gewinnt wenn näher am Ziel
  // (Along-Match hängt / Abkürzung) — sonst bleibt HUD bei 2 km obwohl man am Pin steht
  const routeRemainingM =
    splineRemainM != null && splineRemainM > 0
      ? splineRemainM
      : navTotalDistanceM != null && navTotalDistanceM > 0
        ? Math.max(0, navTotalDistanceM - alongM)
        : distanceToDestinationAirM;
  let distanceToDestinationM = routeRemainingM;
  const offPathM =
    typeof distanceToPathM === 'number' && Number.isFinite(distanceToPathM)
      ? distanceToPathM
      : 0;
  if (
    offPathM > 18 &&
    distanceToDestinationAirM + 30 < routeRemainingM * 0.85
  ) {
    distanceToDestinationM = Math.max(
      distanceToDestinationAirM,
      Math.min(routeRemainingM, distanceToDestinationAirM + offPathM),
    );
  }
  // Nah am Ziel / Along stuck: echte Nähe schlägt aufgeblähten Routenrest
  if (distanceToDestinationAirM + 20 < routeRemainingM * 0.6) {
    distanceToDestinationM = Math.min(
      distanceToDestinationM,
      Math.max(distanceToDestinationAirM, distanceToDestinationAirM * 1.02),
    );
  }
  if (
    distanceToDestinationAirM < 150 &&
    routeRemainingM > Math.max(400, distanceToDestinationAirM * 3)
  ) {
    // Stehst am Ziel / daneben, HUD zeigt noch km-Umweg → Luftlinie für Ankunft/HUD
    distanceToDestinationM = distanceToDestinationAirM;
  }

  const arrow = computeSmartArrow({
    userLat: lat,
    userLng: lng,
    headingDeg: heading,
    mode,
    transportMode,
    waypoints: aligned,
    waypointIndex,
    projectionIndex: getProjectionIndex(),
    alongM,
    spline,
    destination: { lat: active.lat, lng: active.lng, name: active.name },
  });

  // Auf der Linie: Straßenrichtung (pathBearing) statt Punkt-zu-Punkt — stabiler Kompass
  if (offPathM < 20 && Number.isFinite(arrow.pathBearingDeg)) {
    const pathRel = relativeBearingDeg(heading, arrow.pathBearingDeg);
    // Nur übernehmen wenn Smart-Arrow nicht schon stark abbiegt (Kreuzung)
    if (Math.abs(pathRel) < 75 || Math.abs(arrow.bearingRelDeg) > 100) {
      // Wenn Arrow „rückwärts“ (>100°) aber Path voraus → Path gewinnt
      if (Math.abs(arrow.bearingRelDeg) > 100 && Math.abs(pathRel) < 90) {
        arrow.bearingRelDeg = pathRel;
      } else if (Math.abs(pathRel) <= Math.abs(arrow.bearingRelDeg) + 12) {
        arrow.bearingRelDeg = pathRel;
      }
    }
  }

  // Leichter Sidewalk-Nudge nur wenn Ziel voraus (nicht hinter dem User)
  const arrowWp =
    aligned[Math.min(waypointIndex + 1, aligned.length - 1)] ??
    aligned[waypointIndex];
  if (arrowWp) {
    const nudge = arrowTargetFromWaypoint(arrowWp);
    const nudgeAlong =
      typeof arrowWp.splineAlongM === 'number' ? arrowWp.splineAlongM : null;
    const ahead =
      nudgeAlong == null || nudgeAlong >= alongM - 5;
    if (ahead) {
      const nudgeAbs = bearingDegrees(lat, lng, nudge.lat, nudge.lng);
      const nudgeRel = relativeBearingDeg(heading, nudgeAbs);
      if (
        Math.abs(nudgeRel) < 55 &&
        Math.abs(shortestAngleDelta(nudgeRel, arrow.bearingRelDeg)) < 40
      ) {
        arrow.lat = nudge.lat;
        arrow.lng = nudge.lng;
        arrow.distanceToTargetM = distanceMeters(lat, lng, nudge.lat, nudge.lng);
      }
    }
  }

  noteHandsFreeEtaGps({
    lat,
    lng,
    speedMps: speedMs ?? getSmoothedSpeedMs(),
    isBike: transportMode === 'bicycle',
  });

  navAlongM = alongM;
  navDistToArrowM = arrow.distanceToTargetM;
  navDistToNextTurnM = distanceAlongRouteToNextTurnM(
    active.waypoints,
    getProjectionIndex(),
    alongM,
  );

  const distanceToArrowM = arrow.distanceToTargetM;
  const bearingRelDeg = arrow.bearingRelDeg;
  const pathBearingDeg = arrow.pathBearingDeg;

  // Predictive turn-imminent: mode-aware (12 m walk / 40 m bike)
  const predictM = predictiveSpeakDistanceM(transportMode, getSmoothedSpeedMs());
  const turnImminent =
    mode === 'routing' &&
    distanceToArrowM <= Math.max(thr.turnImminentM, predictM) &&
    Math.abs(bearingRelDeg) >= TURN_IMMINENT_DEG;

  const arrived =
    Date.now() >= suppressArrivalUntilMs &&
    !useFinnusStore.getState().navRouteLoading &&
    (distanceToDestinationM <= active.arrivalRadiusM ||
      distanceToDestinationAirM <= active.arrivalRadiusM);
  const remainingStations = computeRemainingStations(lat, lng, transportMode);

  const stations = stationList();
  const navPhase = tickBoardingDetector({
    lat,
    lng,
    transportMode,
    speedMs: getSmoothedSpeedMs(),
    stations: stations.map((s) => ({
      lat: s.lat,
      lng: s.lng,
      name: s.stationName,
    })),
    remainingStations,
    hasTransitLegs: routeHasTransitLegs || stations.length > 0,
  });
  lastNavPhase = navPhase;

  return {
    mode,
    distanceToDestinationM,
    distanceToArrowM,
    bearingRelDeg,
    targetName: active.name,
    arrowLat: arrow.lat,
    arrowLng: arrow.lng,
    arrived,
    turnImminent,
    transportMode,
    speedMs: getSmoothedSpeedMs(),
    remainingStations,
    navPhase,
    pathBearingDeg,
    distanceToPathM,
  };
}

function applyTick(tick: NavigationTick, arrowName: string): void {
  // Stuck-safe hint: always bind to next REAL turn + live remaining meters
  let navTurnHint: string | null = null;
  if (active && tick.mode === 'routing' && active.waypoints.length > 0) {
    const nextTurn = findNextTurnWaypoint({
      waypoints: active.waypoints,
      fromIndex: waypointIndex,
    });
    const distToTurn =
      navDistToNextTurnM != null && Number.isFinite(navDistToNextTurnM)
        ? navDistToNextTurnM
        : tick.distanceToArrowM;
    if (nextTurn && isTurnManeuver(nextTurn.wp.maneuver)) {
      navTurnHint = formatNavTurnHint({
        landmark:
          nextTurn.wp.visibleLandmark?.trim() ||
          nextTurn.wp.landmark?.trim() ||
          null,
        maneuver: nextTurn.wp.maneuver ?? null,
        distanceM: distToTurn,
        bearingRelDeg: tick.bearingRelDeg,
      });
    } else {
      navTurnHint = null;
    }
  }

  const rawDist = Math.round(tick.distanceToDestinationM);
  let stableDist = rawDist;
  if (displayedNavDistanceM != null) {
    const delta = Math.abs(rawDist - displayedNavDistanceM);
    // Allow monotonic decrease always; only damp tiny increases/jitter
    if (
      rawDist > displayedNavDistanceM &&
      delta < 12 &&
      delta < Math.max(8, displayedNavDistanceM * 0.08)
    ) {
      stableDist = displayedNavDistanceM;
    } else {
      displayedNavDistanceM = rawDist;
    }
  } else {
    displayedNavDistanceM = rawDist;
  }

  const eta = etaMinutesFromRoute({
    remainingRouteM: stableDist,
    lightBufferMin: 0,
  });

  pushStoreNav({
    navActive: true,
    navVisible: true,
    navMode: tick.mode,
    navTargetName: tick.targetName,
    navDistanceM: stableDist,
    navBearingRel: tick.bearingRelDeg,
    transportMode: tick.transportMode,
    remainingStations: tick.remainingStations ?? null,
    navNextTargetName: arrowName,
    navLegDistanceM: Math.round(
      navDistToNextTurnM != null ? navDistToNextTurnM : tick.distanceToArrowM,
    ),
    navTotalDistanceM,
    navEtaMin: eta.etaMin,
    navTurnHint,
    navPhase: tick.navPhase ?? null,
  });

  if (
    tick.remainingStations != null &&
    tick.remainingStations !== lastRemainingStations
  ) {
    lastRemainingStations = tick.remainingStations;
    void onRemainingStationsChanged(tick.remainingStations, {
      transportMode: tick.transportMode,
      targetName: tick.targetName,
      navPhase: tick.navPhase ?? null,
    });
  }

  void maybeSpeakAlightNow({
    transportMode: tick.transportMode,
    remainingStations: tick.remainingStations ?? null,
    distanceToDestinationM: tick.distanceToDestinationM,
    speedMs: tick.speedMs ?? null,
    navPhase: tick.navPhase ?? null,
  });

  if (tick.navPhase && tick.navPhase !== announcedNavPhase) {
    announcedNavPhase = tick.navPhase;
  }
  if (typeof lastLat === 'number' && typeof lastLng === 'number') {
    tickTransitGuide({
      navPhase: tick.navPhase ?? null,
      remainingStations: tick.remainingStations ?? null,
      distanceToDestinationM: tick.distanceToDestinationM,
      speedMs: tick.speedMs ?? null,
      userLat: lastLat,
      userLng: lastLng,
      destName: tick.targetName,
      transportMode: tick.transportMode,
    });
  }

  if (tick.turnImminent && turnHapticArmed) {
    hapticTurnImminent();
    turnHapticArmed = false;
  } else if (!tick.turnImminent) {
    turnHapticArmed = true;
  }

  // Wrong-way: nur bei aktivem Falschlaufen (~10 m), nie beim Stehenbleiben.
  const pathBearing =
    tick.pathBearingDeg ??
    bearingDegrees(
      lastLat ?? tick.arrowLat,
      lastLng ?? tick.arrowLng,
      tick.arrowLat,
      tick.arrowLng,
    );
  const missed = active
    ? detectMissedTurn({
        lat: lastLat ?? tick.arrowLat,
        lng: lastLng ?? tick.arrowLng,
        waypoints: active.waypoints,
        waypointIndex,
        distanceToPathM: tick.distanceToPathM ?? null,
      })
    : { missed: false, turnIndex: -1, backtrackM: 0 };

  const wrongWayAction = tickWrongWayMonitor({
    distanceToPathM: tick.distanceToPathM ?? null,
    suppress:
      isTransitMode(tick.transportMode) || tick.navPhase === 'in_transit',
    speedMs: tick.speedMs,
    missedTurn: missed.missed,
    lat: lastLat,
    lng: lastLng,
  });

  if (wrongWayAction === 'warn' && active) {
    // Eine Ansage + Auto-Reroute passiert in silentRecalculateRoute (Delta / Sackgasse)
    markRerouteAttemptStarted();
    void silentRecalculateRoute({ announce: true });
  } else if (wrongWayAction === 'reroute' && active) {
    void silentRecalculateRoute({ announce: true });
  } else if (
    active &&
    !isTransitMode(tick.transportMode) &&
    tick.navPhase !== 'in_transit' &&
    (tick.speedMs ?? 0) >= 0.45 &&
    (tick.distanceToPathM ?? 0) > 18 &&
    tick.distanceToDestinationM + 30 <
      Math.max(60, (navTotalDistanceM ?? tick.distanceToDestinationM) * 0.85)
  ) {
    // Stille Abkürzungs-Neuberechnung (ohne Wrong-Way-Ansage)
    const now = Date.now();
    if (now - lastShortcutRerouteAtMs > 8_000 && !rerouteInFlight) {
      lastShortcutRerouteAtMs = now;
      void silentRecalculateRoute({ announce: false });
    }
  }

  // Nah am Pin, aber Route zeigt noch km-Umweg → still neu vom GPS zum Ziel
  if (
    active &&
    !rerouteInFlight &&
    !isTransitMode(tick.transportMode) &&
    typeof lastLat === 'number' &&
    typeof lastLng === 'number'
  ) {
    const air = distanceMeters(lastLat, lastLng, active.lat, active.lng);
    const rem = tick.distanceToDestinationM;
    if (air < 150 && rem > Math.max(400, air * 3) && (tick.speedMs ?? 0) >= 0.45) {
      const now = Date.now();
      if (now - lastShortcutRerouteAtMs > 6_000) {
        lastShortcutRerouteAtMs = now;
        void silentRecalculateRoute({ announce: false });
      }
    }
  }

  // Auto-Umweg (z. B. alter Car-OSRM) + Fuß-ETA ≤ 10 Min → sofort neu berechnen & starten
  if (
    active &&
    !rerouteInFlight &&
    !isTransitMode(tick.transportMode) &&
    typeof lastLat === 'number' &&
    typeof lastLng === 'number'
  ) {
    const air = distanceMeters(lastLat, lastLng, active.lat, active.lng);
    const routeM = Math.max(
      tick.distanceToDestinationM,
      navTotalDistanceM ?? 0,
      waypointPathLengthM(active.waypoints),
    );
    if (air > 40 && routeM > 0 && (tick.speedMs ?? 0) >= 0.45) {
      let detour = false;
      try {
        const {
          isImplausiblePedestrianDetour,
        } = require('./googleMapsNav') as {
          isImplausiblePedestrianDetour: (
            routeM: number,
            airM: number,
            mode?: 'walking' | 'bicycling' | 'transit',
          ) => boolean;
        };
        detour = isImplausiblePedestrianDetour(
          routeM,
          air,
          tick.transportMode === 'bicycle' ? 'bicycling' : 'walking',
        );
      } catch {
        detour = routeM > air * 2 && routeM - air > 280;
      }
      const paceMPerMin = tick.transportMode === 'bicycle' ? 220 : 80;
      const estShortEtaMin = Math.max(1, Math.ceil(air / paceMPerMin));
      if (detour && estShortEtaMin <= SHORT_ROUTE_AUTO_ETA_MIN) {
        const now = Date.now();
        if (now - lastShortcutRerouteAtMs > 4_000) {
          lastShortcutRerouteAtMs = now;
          void silentRecalculateRoute({ announce: false });
        }
      }
    }
  }

  // Fuß ↔ Rad (≥ ~10 km/h): automatisch Radmodus + Route neu auf Radwegen
  {
    const skipModeSwitch =
      isTransitMode(tick.transportMode) ||
      tick.navPhase === 'in_transit' ||
      (routeHasTransitLegs && tick.navPhase === 'walk_to_stop');
    const rp: 'foot' | 'bike' | null = skipModeSwitch
      ? null
      : tick.transportMode === 'bicycle'
        ? 'bike'
        : tick.transportMode === 'walk' || tick.transportMode === 'jog'
          ? 'foot'
          : null;
    if (rp && !lastRoutedProfile) {
      lastRoutedProfile = rp;
    } else if (
      rp &&
      lastRoutedProfile &&
      rp !== lastRoutedProfile &&
      active &&
      !rerouteInFlight &&
      modeSwitchPending !== rp
    ) {
      modeSwitchPending = rp;
      void silentRecalculateRoute({
        announce: false,
        modeSwitchTo: rp,
      }).finally(() => {
        if (modeSwitchPending === rp) modeSwitchPending = null;
      });
    }
  }

  if (active) {
    onNavigationTickForCoach(tick, {
      waypointIndex,
      waypoints: active.waypoints,
      deviceHeadingDeg: headingDeg,
      userLat: lastLat,
      userLng: lastLng,
    });
  }

  if (tick.arrived) {
    if (arrivalInFlight) return;
    arrivalInFlight = true;
    void (async () => {
      const destName = active?.name ?? 'Ziel';
      const destPoiId = active?.poiId ?? null;
      try {
        if (destPoiId != null) {
          let storyPoiId = destPoiId;
          try {
            const { getPoiWithFacts } = await import('../../db/database');
            const loaded = await getPoiWithFacts(destPoiId);
            // Nav-Ziel = Approach → Parent-Hauptort für Modul-1 Story (kein Wegweiser)
            if (
              loaded &&
              (loaded.kind === 'approach') &&
              loaded.parent_poi_id != null &&
              loaded.parent_poi_id >= 0
            ) {
              storyPoiId = loaded.parent_poi_id;
            }
          } catch {
            /* soft */
          }
          const { triggerPoiArrival } = await import('../../runtime/exploreModule');
          await triggerPoiArrival(storyPoiId, {
            force: true,
            skipWegweiser: true,
          });
        } else {
          const { buildArrivedCue } = await import('./spatialOrientation');
          await speakAssistantText(buildArrivedCue(destName));
        }
      } catch {
        try {
          const { buildArrivedCue } = await import('./spatialOrientation');
          await speakAssistantText(buildArrivedCue(destName));
        } catch {
          /* soft */
        }
      }
      const continued = await advanceMultiStopTour();
      if (!continued) {
        await fadeAndStopNavigation();
      } else {
        arrivalInFlight = false;
      }
    })();
  }
}

export function tickNavigation(
  lat: number,
  lng: number,
  heading?: number,
  speedMs?: number | null,
): NavigationTick | null {
  if (!active) return null;

  const smoothed = positionFilter.push(lat, lng, distanceMeters);
  lastLat = smoothed.lat;
  lastLng = smoothed.lng;
  pushGpsTrackFix(smoothed.lat, smoothed.lng);
  navTrackingPushGpsFix(smoothed.lat, smoothed.lng, Date.now());
  void import('../mobility/paceProfile')
    .then(({ pushPaceSample }) => {
      const mode = lastTransportMode;
      pushPaceSample({
        lat: smoothed.lat,
        lng: smoothed.lng,
        speedMs: speedMs ?? getSmoothedSpeedMs(),
        modeHint:
          mode === 'bicycle' ? 'bike' : mode === 'walk' ? 'walk' : null,
      });
    })
    .catch(() => undefined);
  const trackBearing = getTrackMovementBearingDeg();
  if (trackBearing != null) {
    movementBearingDeg = trackBearing;
  }

  if (typeof heading === 'number' && Number.isFinite(heading)) {
    headingDeg = pushAdaptiveHeading(heading, {
      speedMps: getSmoothedSpeedMs(),
    });
  }

  const tick = computeTick(lastLat, lastLng, headingDeg, speedMs);
  if (tick) {
    applyTick(tick, smartArrowLabel(tick.mode));
  }
  return tick;
}

/** Free-roam: Speed/Mode ohne aktive Navigation aktualisieren. */
export function tickFreeRoamMotion(speedMs?: number | null): TransportMode {
  const hints = profileTransportHints();
  const mode = classifyMotionTransportMode({
    speedMs,
    preferTransit: hints.preferTransit,
    preferBike: hints.preferBike,
  });
  lastTransportMode = mode;
  useFinnusStore.getState().patchNavigation({
    transportMode: mode,
  });
  return mode;
}

export function getCurrentTransportMode(): TransportMode {
  return lastTransportMode;
}

/** GPS track / course bearing for vector-aware discovery (not device compass). */
export function getMovementBearingDeg(): number | null {
  return getTrackMovementBearingDeg() ?? movementBearingDeg;
}

/** Last device compass heading (degrees). Prefers live Free-Roam compass. */
export function getDeviceHeadingDeg(): number | null {
  const map = getMapDisplayHeadingDeg();
  if (map != null) return map;
  const live = getLiveDeviceHeadingDeg();
  if (live != null) return live;
  return Number.isFinite(headingDeg) ? headingDeg : null;
}

/**
 * Free-roam GPS fix — keep last-3 track warm without active navigation.
 */
export function noteFreeRoamGpsFix(
  lat: number,
  lng: number,
  speedMs?: number | null,
  courseDeg?: number | null,
): void {
  pushGpsTrackFix(lat, lng);
  const trackBearing = getTrackMovementBearingDeg();
  if (trackBearing != null) {
    movementBearingDeg = trackBearing;
  } else if (
    typeof courseDeg === 'number' &&
    Number.isFinite(courseDeg) &&
    courseDeg >= 0 &&
    typeof speedMs === 'number' &&
    speedMs >= 0.6
  ) {
    movementBearingDeg = courseDeg;
  }
  if (typeof speedMs === 'number' && Number.isFinite(speedMs) && speedMs >= 0) {
    tickFreeRoamMotion(speedMs);
  }
}

async function ensureWatchers(): Promise<void> {
  if (posSub || headingSub) return;
  if (!active) return;

  try {
    const granted = await requestLocationPermission();
    if (!granted) {
      if (simulatedCoords && active) {
        tickNavigation(simulatedCoords.lat, simulatedCoords.lng, headingDeg);
      }
      return;
    }

    if (!active) return;

    posSub = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        distanceInterval: lastTransportMode === 'bicycle' ? 1 : 2,
        timeInterval: lastTransportMode === 'bicycle' ? 1000 : 3500,
      },
      (loc) => {
        if (!active || simulatedCoords) return;
        const speed = loc.coords.speed;
        const course = loc.coords.heading;
        if (
          typeof course === 'number' &&
          Number.isFinite(course) &&
          course >= 0 &&
          typeof speed === 'number' &&
          speed >= 0.6
        ) {
          movementBearingDeg = course;
        }
        tickNavigation(
          loc.coords.latitude,
          loc.coords.longitude,
          headingDeg,
          typeof speed === 'number' && Number.isFinite(speed) && speed >= 0
            ? speed
            : null,
        );
      },
    );

    if (!active) {
      await stopWatchers();
      return;
    }

    try {
      const store = useFinnusStore.getState();
      const pocketOff = shouldDisableCompassWatch({
        screenInteractive: store.navVisible !== false,
        appStateActive: true,
        pocketLikely: false,
      });
      // When UI compass not needed, skip heading subscription (battery)
      if (pocketOff && !store.navVisible) {
        headingSub = null;
      } else {
        headingSub = await Location.watchHeadingAsync((h) => {
          if (!active) return;
          // Pocket / nav HUD hidden → ignore compass updates
          const st = useFinnusStore.getState();
          if (
            shouldDisableCompassWatch({
              screenInteractive: st.navVisible,
              appStateActive: true,
              pocketLikely: !st.navVisible,
            })
          ) {
            return;
          }
          if (Platform.OS !== 'android' && typeof h.accuracy === 'number') {
            noteHeadingAccuracy(h.accuracy);
          }
          const raw = headingFromExpoEvent(h);
          if (raw != null) {
            noteExpoCompassHeading(raw);
            headingDeg = pushAdaptiveHeading(getLiveDeviceHeadingDeg() ?? raw, {
              speedMps: getSmoothedSpeedMs(),
            });
            if (lastLat != null && lastLng != null) {
              const tick = computeTick(
                lastLat,
                lastLng,
                headingDeg,
                getSmoothedSpeedMs(),
              );
              if (tick) applyTick(tick, tick.targetName);
            } else if (simulatedCoords) {
              const smoothed = positionFilter.push(
                simulatedCoords.lat,
                simulatedCoords.lng,
                distanceMeters,
              );
              lastLat = smoothed.lat;
              lastLng = smoothed.lng;
              const tick = computeTick(
                lastLat,
                lastLng,
                headingDeg,
                getSmoothedSpeedMs(),
              );
              if (tick) applyTick(tick, tick.targetName);
            }
          }
        });
      }
    } catch (err) {
      console.warn('[nav] heading watch unavailable:', err);
    }
  } catch (err) {
    console.warn('[nav] position watch failed:', err);
  }
}

async function stopWatchers(): Promise<void> {
  if (posSub) {
    posSub.remove();
    posSub = null;
  }
  if (headingSub) {
    headingSub.remove();
    headingSub = null;
  }
}

export function setSimulatedNavCoords(
  coords: { lat: number; lng: number } | null,
): void {
  simulatedCoords = coords;
  if (coords && active) {
    tickNavigation(coords.lat, coords.lng, headingDeg);
  }
}

export function getActiveNavDestination(): NavDestination | null {
  return active;
}

function assignActiveWaypoints(wps: NavWaypoint[]): void {
  if (!active) return;
  active.waypoints = wps;
  notifyNavRouteGeometryChanged();
}

/** FOSSGIS fertig bevor `active` steht — beim Start nachziehen. */
let pendingSeedRoute: {
  waypoints: NavWaypoint[];
  walkingDistanceM?: number;
} | null = null;

function applySeedWaypoints(opts: {
  waypoints: NavWaypoint[];
  walkingDistanceM?: number;
}): boolean {
  if (!active || !opts.waypoints?.length || opts.waypoints.length < 3) {
    return false;
  }
  if ((active.waypoints?.length ?? 0) >= opts.waypoints.length) return false;
  assignActiveWaypoints(opts.waypoints);
  if (
    typeof opts.walkingDistanceM === 'number' &&
    opts.walkingDistanceM > 0
  ) {
    navTotalDistanceM = Math.round(opts.walkingDistanceM);
    pushStoreNav({
      navTotalDistanceM,
      navDistanceM: navTotalDistanceM,
      navMode: 'routing',
    });
  } else {
    pushStoreNav({ navMode: 'routing' });
  }
  modeSticky = 'routing';
  try {
    navTrackingUpdateWaypoints(active.waypoints);
    initMapMatchEngine(active.waypoints);
  } catch {
    /* soft */
  }
  useFinnusStore.getState().setNavRouteLoading(false);
  return true;
}

function flushPendingSeedRoute(): void {
  const pending = pendingSeedRoute;
  if (!pending || !active) return;
  pendingSeedRoute = null;
  applySeedWaypoints(pending);
}

/** Frühe Polyline vom Map-Tap — bevor der volle Enrich fertig ist. */
export function seedActiveNavRoute(opts: {
  waypoints: NavWaypoint[];
  walkingDistanceM?: number;
}): boolean {
  if (!opts.waypoints?.length || opts.waypoints.length < 3) {
    return false;
  }
  if (!active) {
    pendingSeedRoute = opts;
    return false;
  }
  pendingSeedRoute = null;
  return applySeedWaypoints(opts);
}

/** ÖPNV-Stationskette für Countdown (door-to-door). */
export function setActiveNavStations(
  stations: NavWaypoint[] | null | undefined,
): void {
  if (!active) return;
  if (stations && stations.length > 0) {
    active.stations = stations;
    routeHasTransitLegs = true;
    const rem = computeRemainingStations(
      lastLat ?? active.lat,
      lastLng ?? active.lng,
      lastTransportMode,
    );
    pushStoreNav({ remainingStations: rem });
  } else {
    active.stations = undefined;
    if (!routeHasTransitLegs) {
      pushStoreNav({ remainingStations: null });
    }
  }
}

export type NavigationRoutePlan = {
  destinationName: string;
  nextPointName: string;
  remainingM: number;
  legM: number;
  totalM: number | null;
  stops: Array<{ name: string; done: boolean }>;
};

/** Route-Übersicht für Header / Stempelkarte. */
export function getNavigationRoutePlan(): NavigationRoutePlan | null {
  const multi = useFinnusStore.getState().multiStopTour;
  if (multi?.stops?.length) {
    return {
      destinationName:
        multi.stops[Math.min(multi.currentIndex, multi.stops.length - 1)]
          ?.name ?? multi.title,
      nextPointName:
        multi.stops[Math.min(multi.currentIndex, multi.stops.length - 1)]
          ?.name ?? multi.title,
      remainingM: useFinnusStore.getState().navDistanceM ?? 0,
      legM: useFinnusStore.getState().navLegDistanceM ?? 0,
      totalM: multi.estimatedDistanceM,
      stops: multi.stops.map((s, i) => ({
        name: s.name,
        done: s.done || i < multi.currentIndex,
      })),
    };
  }

  if (!active) return null;
  const store = useFinnusStore.getState();
  const mode = store.navMode ?? 'routing';
  const arrowName = smartArrowLabel(mode);
  const stops: Array<{ name: string; done: boolean }> = [];

  if (active.waypoints.length > 0) {
    active.waypoints.forEach((wp, i) => {
      const name =
        wp.stationName?.trim() ||
        wp.landmark?.trim() ||
        wp.roadName?.trim() ||
        `Punkt ${i + 1}`;
      stops.push({ name, done: i < waypointIndex });
    });
    stops.push({ name: active.name, done: false });
  } else {
    stops.push({ name: active.name, done: false });
  }

  return {
    destinationName: active.name,
    nextPointName: arrowName,
    remainingM: store.navDistanceM ?? 0,
    legM: store.navLegDistanceM ?? 0,
    totalM: store.navTotalDistanceM ?? navTotalDistanceM,
    stops,
  };
}

export function isNavigatingToPoi(poiId: number): boolean {
  return active?.poiId === poiId;
}

export type NavExploreGateSnapshot = {
  alongM: number;
  distanceToNextTurnM: number | null;
  distanceToArrowM: number | null;
  waypointIndex: number;
};

/** SSOT for Modul 1 — Smart-Arrow turn distance ahead on route. */
export function getNavExploreGateSnapshot(): NavExploreGateSnapshot | null {
  if (!active) return null;
  return {
    alongM: navAlongM,
    distanceToNextTurnM: navDistToNextTurnM,
    distanceToArrowM: navDistToArrowM,
    waypointIndex,
  };
}

/**
 * Modul 1 gate: pause POI/story when Smart-Arrow turn knotenpunkt
 * ≤30 m (Fuß) / ≤70 m (Rad) ahead.
 */
export function shouldPauseExploreStoryForNavTurn(
  withinM?: number,
): boolean {
  const store = useFinnusStore.getState();
  if (!store.navActive || !active) return false;

  const muteM = withinM ?? module1NavMuteRadiusM();

  const snap = getNavExploreGateSnapshot();
  if (snap?.distanceToNextTurnM != null) {
    return snap.distanceToNextTurnM <= muteM;
  }

  return shouldPauseExploreForNavTurn({
    navActive: true,
    waypoints: active.waypoints,
    waypointIndex,
    userLat: lastLat ?? store.lastGpsLat,
    userLng: lastLng ?? store.lastGpsLng,
    withinM: muteM,
  });
}

function resetSensorState(): void {
  resetHandsFreeCompass();
  resetCueScheduler();
  resetHandsFreeEta('walk');
  positionFilter.reset();
  modeSticky = 'routing';
  headingDeg = 0;
  lastLat = null;
  lastLng = null;
  lastRemainingStations = null;
  navTotalDistanceM = null;
  movementBearingDeg = null;
  lastNavPhase = 'idle';
  announcedNavPhase = 'idle';
  routeHasTransitLegs = false;
  rerouteInFlight = false;
  lastRoutedProfile = null;
  lastShortcutRerouteAtMs = 0;
  modeSwitchPending = null;
  arrivalInFlight = false;
  suppressArrivalUntilMs = 0;
  resetMotionTransportState();
  resetWrongWayMonitor();
  resetBoardingDetector();
  resetTransitGuideCoach();
  resetGpsTrackBuffer();
  clearNavTurnPrefetch();
  stopNavHybridSession();
  resetMapMatchEngine();
  resetSmartArrow();
  navAlongM = 0;
  navDistToNextTurnM = null;
  navDistToArrowM = null;
}

function kickNavHybridBootstrap(opts: {
  destName: string;
  destLat: number;
  destLng: number;
  travelMode?: PedestrianTravelMode | null;
  walkingDistanceM?: number | null;
}): void {
  if (!active) return;
  setNavHybridHasTransit(routeHasTransitLegs);
  void bootstrapNavHybridSession({
    destName: opts.destName,
    destLat: opts.destLat,
    destLng: opts.destLng,
    travelMode: opts.travelMode ?? null,
    walkingDistanceM: opts.walkingDistanceM ?? navTotalDistanceM,
    hasTransit: routeHasTransitLegs,
    getWaypoints: () => active?.waypoints ?? [],
    getStations: () => active?.stations ?? [],
    applyWaypoints: (wps) => {
      if (!active) return;
      assignActiveWaypoints(wps);
      navTrackingUpdateWaypoints(wps);
      initMapMatchEngine(wps);
    },
  });
}

/**
 * Auto-Reroute: ggf. Delta/Sackgasse ansagen, neue Route setzen, alte Snapshot für Undo.
 * Offline: keine HTTP-Neuberechnung — Hybrid-Ansage (zurück / Netz).
 */
async function silentRecalculateRoute(opts?: {
  announce?: boolean;
  /** Auto Fuß↔Rad: FOSSGIS foot/bike + kurze Ansage */
  modeSwitchTo?: 'foot' | 'bike';
}): Promise<void> {
  if (!active || rerouteInFlight) return;
  if (lastLat == null || lastLng == null) return;
  if (await isDeviceOffline()) {
    void announceNavHybridOfflineRerouteBlocked();
    markRerouteAttemptFailed();
    return;
  }
  const dest = active;
  const originLat = lastLat;
  const originLng = lastLng;
  const announce = opts?.announce !== false;
  const modeSwitchTo = opts?.modeSwitchTo;
  rerouteInFlight = true;
  try {
    const storeBefore = useFinnusStore.getState();
    const previousEtaMin =
      storeBefore.navEtaMin ??
      (typeof storeBefore.navDistanceM === 'number'
        ? Math.max(
            1,
            Math.ceil(
              storeBefore.navDistanceM /
                (lastTransportMode === 'bicycle' ? 220 : 80),
            ),
          )
        : null);
    const previousDistanceM =
      typeof storeBefore.navDistanceM === 'number'
        ? storeBefore.navDistanceM
        : navTotalDistanceM;

    const facingDeg =
      getMovementBearingDeg() ?? getDeviceHeadingDeg() ?? headingDeg;
    let deadEnd = false;
    try {
      const { probeDeadEndAhead } = await import('./deadEndProbe');
      deadEnd = await probeDeadEndAhead({
        lat: originLat,
        lng: originLng,
        headingDeg: facingDeg,
      });
    } catch {
      deadEnd = false;
    }

    const hints = profileTransportHints(
      distanceMeters(originLat, originLng, dest.lat, dest.lng),
    );
    const forceBike = modeSwitchTo === 'bike' || lastTransportMode === 'bicycle';
    const forceFoot = modeSwitchTo === 'foot';
    const travelMode = directionsModeForNav({
      motion: forceFoot
        ? 'walk'
        : forceBike
          ? 'bicycle'
          : lastTransportMode,
      preferTransit:
        !forceBike &&
        !forceFoot &&
        (hints.preferTransit || isTransitMode(lastTransportMode)),
      preferBike: forceBike || (!forceFoot && hints.preferBike),
    });
    const { silentOsrmReroute } = await import('./handsFreeNav');
    const progressive = await silentOsrmReroute({
      originLat,
      originLng,
      destLat: dest.lat,
      destLng: dest.lng,
      travelMode,
    });
    const enriched =
      progressive != null
        ? {
            waypoints: progressive.waypoints,
            stations: progressive.stations,
            walkingDistanceM: progressive.distanceM,
            travelMode: progressive.travelMode,
            etaMin: progressive.etaMin,
          }
        : await enrichNavigationRouteFull({
            originLat,
            originLng,
            destLat: dest.lat,
            destLng: dest.lng,
            destinationName: dest.name,
            travelMode,
          }).then((e) =>
            e
              ? {
                  ...e,
                  etaMin: Math.max(
                    1,
                    Math.ceil(
                      e.walkingDistanceM /
                        (travelMode === 'bicycling' ? 220 : 80),
                    ),
                  ),
                }
              : null,
          );
    if (!enriched?.waypoints?.length || !active) {
      markRerouteAttemptFailed();
      return;
    }
    if (active.lat !== dest.lat || active.lng !== dest.lng) {
      markRerouteAttemptFailed();
      return;
    }

    const {
      rerouteEtaDeltaMin,
      rerouteDistDeltaM,
      isSignificantlyLongerReroute,
      buildLongerRerouteCue,
      buildDeadEndCue,
      buildShortWrongWayRerouteCue,
      RESTORE_PREV_NAV_ROUTE_PROMPT,
    } = await import('./rerouteAnnounce');
    const { saveNavRouteSnapshot } = await import('./navRouteSnapshot');

    const newEtaMin =
      typeof (enriched as { etaMin?: number }).etaMin === 'number'
        ? (enriched as { etaMin: number }).etaMin
        : null;
    const newDistanceM = enriched.walkingDistanceM;
    const etaDelta = rerouteEtaDeltaMin({
      previousEtaMin,
      newEtaMin,
    });
    const distDelta = rerouteDistDeltaM({
      previousDistanceM,
      newDistanceM,
    });
    let longer = isSignificantlyLongerReroute({
      etaDeltaMin: etaDelta,
      distDeltaM: distDelta,
    });
    // Kurze neue Route (≤10 Min): immer übernehmen — nie wegen Delta blocken
    if (
      newEtaMin != null &&
      newEtaMin <= SHORT_ROUTE_AUTO_ETA_MIN &&
      typeof newDistanceM === 'number' &&
      (previousDistanceM == null || newDistanceM <= previousDistanceM * 1.05)
    ) {
      longer = false;
    }

    if (announce) {
      let cue: string | null = null;
      if (deadEnd) {
        cue = buildDeadEndCue();
      } else if (longer && etaDelta != null && etaDelta >= 1) {
        cue = buildLongerRerouteCue(etaDelta);
      } else if (longer && distDelta != null && distDelta > 0) {
        const approxMin = Math.max(
          10,
          Math.round(distDelta / (lastTransportMode === 'bicycle' ? 220 : 80)),
        );
        cue = buildLongerRerouteCue(approxMin);
      }
      if (cue) {
        try {
          void speakAssistantText(cue);
        } catch {
          /* soft */
        }
      }
    }

    // Alte Route sichern, bevor wir überschreiben
    if (active.waypoints.length >= 2) {
      saveNavRouteSnapshot({
        waypoints: active.waypoints.slice(),
        stations: (active.stations ?? []).slice(),
        dest: {
          poiId: dest.poiId,
          name: dest.name,
          lat: dest.lat,
          lng: dest.lng,
        },
        navTotalDistanceM,
        navEtaMin: previousEtaMin,
        waypointIndex,
        travelMode: enriched.travelMode ?? null,
        savedAtMs: Date.now(),
      });
    }

    assignActiveWaypoints(enriched.waypoints);
    const appliedProfile: 'foot' | 'bike' =
      enriched.travelMode === 'bicycling' ? 'bike' : 'foot';
    lastRoutedProfile = appliedProfile;
    if (modeSwitchTo && appliedProfile === modeSwitchTo) {
      setPreferredTravelMode(modeSwitchTo);
      try {
        void speakAssistantText(
          modeSwitchTo === 'bike'
            ? 'Du bist unterwegs mit dem Rad — ich nehme die Radwege.'
            : 'Wieder zu Fuß — ich rechne die Fußroute neu.',
        );
      } catch {
        /* soft */
      }
    }
    if (progressive) {
      navTotalDistanceM = progressive.distanceM;
      useFinnusStore.setState({
        navTotalDistanceM: progressive.distanceM,
        navEtaMin: progressive.etaMin,
      });
    }
    navTrackingUpdateWaypoints(active.waypoints);
    initMapMatchEngine(active.waypoints);
    routeHasTransitLegs =
      enriched.travelMode === 'transit' || enriched.stations.length > 0;
    active.stations =
      enriched.stations.length > 0 ? enriched.stations : undefined;
    if (
      Number.isFinite(enriched.walkingDistanceM) &&
      enriched.walkingDistanceM > 0
    ) {
      navTotalDistanceM = Math.round(enriched.walkingDistanceM);
      pushStoreNav({ navTotalDistanceM });
    }
    waypointIndex = 0;
    modeSticky = 'routing';
    turnHapticArmed = true;
    initMapMatchEngine(enriched.waypoints);
    resetWrongWayMonitor();
    markRerouteFired();
    clearNavTurnPrefetch();
    pushStoreNav({
      navMode: 'routing',
      navEtaMin: newEtaMin,
      navTotalDistanceM,
    });
    void putCachedRoute({
      destName: dest.name,
      destLat: dest.lat,
      destLng: dest.lng,
      waypoints: enriched.waypoints,
      stations: enriched.stations,
      travelMode: enriched.travelMode,
      walkingDistanceM: enriched.walkingDistanceM,
    });
    kickNavHybridBootstrap({
      destName: dest.name,
      destLat: dest.lat,
      destLng: dest.lng,
      travelMode: enriched.travelMode,
      walkingDistanceM: enriched.walkingDistanceM,
    });

    // Undo-Button wenn Umweg / Sackgasse — User kann alte Route zurückholen
    if (announce && (longer || deadEnd)) {
      try {
        const { hasNavRouteSnapshot } = await import('./navRouteSnapshot');
        if (hasNavRouteSnapshot()) {
          const bullets: string[] = [];
          if (deadEnd) bullets.push('Sackgasse erkannt');
          if (etaDelta != null && etaDelta >= 1) {
            bullets.push(`Etwa ${Math.round(etaDelta)} Min länger als vorher`);
          }
          useFinnusStore.getState().setActiveConciergeCard({
            id: `nav_restore_${Date.now()}`,
            createdAtMs: Date.now(),
            speechText: '',
            visualBullets: bullets,
            quickActions: [
              {
                type: 'SHOW_MORE',
                label: 'Alte Route',
                payload: { textPrompt: RESTORE_PREV_NAV_ROUTE_PROMPT },
              },
            ],
          });
        }
      } catch {
        /* soft */
      }
    }

    if (lastLat != null && lastLng != null) {
      tickNavigation(lastLat, lastLng, headingDeg, getSmoothedSpeedMs());
    }
    if (__DEV__) {
      console.log('[nav] silent auto-reroute applied', {
        longer,
        deadEnd,
        etaDelta,
      });
    }
  } catch (err) {
    console.warn('[nav] silent recalculate failed:', err);
    markRerouteAttemptFailed();
    if (await isDeviceOffline()) {
      void announceNavHybridOfflineRerouteBlocked();
    }
  } finally {
    rerouteInFlight = false;
  }
}

/** Stellt die Route vor dem letzten Auto-Reroute wieder her. */
export function restorePreviousNavRoute(): boolean {
  try {
    const { takeNavRouteSnapshot } = require('./navRouteSnapshot') as {
      takeNavRouteSnapshot: () => {
        waypoints: NavWaypoint[];
        stations: NavWaypoint[];
        dest: {
          poiId: number;
          name: string;
          lat: number;
          lng: number;
        };
        navTotalDistanceM: number | null;
        navEtaMin: number | null;
        waypointIndex: number;
      } | null;
    };
    const snap = takeNavRouteSnapshot();
    if (!snap || !active || snap.waypoints.length < 2) return false;
    if (
      active.poiId !== snap.dest.poiId &&
      (Math.abs(active.lat - snap.dest.lat) > 1e-5 ||
        Math.abs(active.lng - snap.dest.lng) > 1e-5)
    ) {
      return false;
    }
    assignActiveWaypoints(snap.waypoints);
    active.stations =
      snap.stations.length > 0 ? snap.stations : undefined;
    navTotalDistanceM = snap.navTotalDistanceM;
    waypointIndex = Math.min(
      Math.max(0, snap.waypointIndex),
      Math.max(0, snap.waypoints.length - 1),
    );
    modeSticky = 'routing';
    turnHapticArmed = true;
    navTrackingUpdateWaypoints(active.waypoints);
    initMapMatchEngine(active.waypoints);
    resetWrongWayMonitor();
    clearNavTurnPrefetch();
    pushStoreNav({
      navMode: 'routing',
      navTotalDistanceM: snap.navTotalDistanceM,
      navEtaMin: snap.navEtaMin,
      navTargetName: snap.dest.name,
    });
    useFinnusStore.getState().setActiveConciergeCard(null);
    if (lastLat != null && lastLng != null) {
      tickNavigation(lastLat, lastLng, headingDeg, getSmoothedSpeedMs());
    }
    try {
      void speakAssistantText('Alles klar — alte Route ist wieder aktiv.');
    } catch {
      /* soft */
    }
    return true;
  } catch (err) {
    console.warn('[nav] restore previous route failed', err);
    return false;
  }
}

export async function startNavigation(poiId: number, opts?: { offlineOnly?: boolean }): Promise<boolean> {
  const poi = await getPoiWithFacts(poiId);
  if (!poi) {
    console.warn(`[nav] POI #${poiId} not found`);
    return false;
  }

  let dest = poi;
  if (poi.kind === 'approach' && poi.parent_poi_id != null) {
    const parent = await getPoiWithFacts(poi.parent_poi_id);
    if (parent) dest = parent;
  }

  return startNavigationToCoords({
    name: dest.name.replace(/\s*[·•|]\s*Wegweiser\s*$/i, '').trim(),
    lat: dest.lat,
    lng: dest.lng,
    poiId: dest.id,
    // Ankunft eng halten — große Pack-Radien würden „erreicht“ zu früh feuern
    arrivalRadiusM: Math.max(
      ARRIVAL_FALLBACK_M,
      Math.min(
        Math.max(
          dest.radius_meters || ARRIVAL_FALLBACK_M,
          dest.special_radius_m || 0,
        ),
        22,
      ),
    ),
    spotKey: dest.spot_key ?? poi.spot_key ?? null,
    offlineOnly: opts?.offlineOnly,
  });
}

export async function startNavigationToCoords(opts: {
  name: string;
  lat: number;
  lng: number;
  poiId?: number;
  arrivalRadiusM?: number;
  spotKey?: string | null;
  offlineOnly?: boolean;
  /** ÖPNV: Stationskette für Countdown (wird nach Enrich beibehalten) */
  stations?: NavWaypoint[] | null;
  /** ÖPNV-Fahrt: keine Fußroute entlang der Linie, nur Ausstieg + Stationen */
  transitRide?: boolean;
  /** User hat Pin / „Ja“ bestätigt — kein Fernziel-Verify */
  skipDestVerify?: boolean;
  /** Explizite Fuß-/Rad-Route — nicht von GPS-lastTransportMode überschreiben */
  forceTravelMode?: 'foot' | 'bike';
}): Promise<boolean> {
  if (
    !Number.isFinite(opts.lat) ||
    !Number.isFinite(opts.lng) ||
    !opts.name.trim()
  ) {
    return false;
  }

  if (
    !opts.skipDestVerify &&
    opts.forceTravelMode !== 'foot' &&
    opts.forceTravelMode !== 'bike'
  ) {
    const destCheck = verifyNavDestBeforeCommit({
      name: opts.name,
      lat: opts.lat,
      lng: opts.lng,
    });
    if (!destCheck.ok) {
      if (__DEV__) {
        console.warn('[nav] verify-before-commit blocked:', destCheck.message);
      }
      // Nicht still abbrechen — nachfragen + Ja-Button
      try {
        const msg =
          destCheck.kind === 'confirm'
            ? destCheck.message
            : 'Soll ich dich wirklich dorthin bringen?';
        const destCity =
          destCheck.kind === 'confirm' ? destCheck.destCity : null;
        try {
          const { parkFarDestConfirmOffer } = require('./resolveNavTarget') as {
            parkFarDestConfirmOffer: (o: {
              name: string;
              lat: number;
              lng: number;
              poiId?: number | null;
              destCity?: string | null;
              message: string;
            }) => { labeledName: string };
          };
          const { labeledDestName } = require('./navDestVerify') as {
            labeledDestName: (place: string, city: string | null) => string;
          };
          const parked = parkFarDestConfirmOffer({
            name: opts.name.trim(),
            lat: opts.lat,
            lng: opts.lng,
            poiId: opts.poiId,
            destCity,
            message: msg,
          });
          const labeled =
            parked.labeledName || labeledDestName(opts.name.trim(), destCity);
          useFinnusStore.getState().setActiveConciergeCard({
            id: `nav-confirm-${Date.now()}`,
            createdAtMs: Date.now(),
            cardTitle: 'Route bestätigen',
            speechText: msg,
            visualBullets: [labeled],
            quickActions: [
              {
                type: 'START_NAVIGATION',
                label: 'Ja, dorthin',
                payload: {
                  destName: labeled,
                  destLat: opts.lat,
                  destLng: opts.lng,
                  targetPoiId: opts.poiId,
                  skipDestVerify: true,
                  skipClosingGate: true,
                },
              },
            ],
          });
        } catch {
          useFinnusStore.getState().setActiveConciergeCard({
            id: `nav-confirm-${Date.now()}`,
            createdAtMs: Date.now(),
            cardTitle: 'Route bestätigen',
            speechText: msg,
            visualBullets: [opts.name.trim()],
            quickActions: [
              {
                type: 'START_NAVIGATION',
                label: 'Ja, dorthin',
                payload: {
                  destName: opts.name.trim(),
                  destLat: opts.lat,
                  destLng: opts.lng,
                  targetPoiId: opts.poiId,
                  skipDestVerify: true,
                  skipClosingGate: true,
                },
              },
            ],
          });
        }
        try {
          const { speakAssistantText } = require('../ttsService') as {
            speakAssistantText: (t: string) => Promise<void>;
          };
          void speakAssistantText(msg).catch(() => undefined);
        } catch {
          /* soft */
        }
      } catch {
        /* soft */
      }
      return false;
    }
  }

  // Stale Discovery/Offers killen (Laboe-Swap Fischbude), aber Multi-Stop-Tour
  // NICHT löschen — Spontan-Ziele (Aldi) werden eingewebt, nicht Google-mäßig nuked.
  try {
    const { resetWrongWayMonitor } = require('./wrongWayMonitor') as {
      resetWrongWayMonitor: () => void;
    };
    resetWrongWayMonitor();
  } catch {
    /* soft */
  }
  {
    const st = useFinnusStore.getState();
    st.setDiscoveryCandidates([]);
    // pendingNavOffer erst nach erfolgreichem Start clearen —
    // sonst scheitert Auto-Start-Retry ohne Ziel-Koordinaten
    st.setPendingNavAlternatives([]);
    // Loading-Bar nicht ausknipsen — Ort-Popup hat sie schon an.
    // Sonst wirkt „Navigation“ tot, bis OSRM (bis 9 s) zurück ist.
  }
  const st0 = useFinnusStore.getState();
  if (active || st0.navActive) {
    try {
      await Promise.race([
        stopNavigation({ silent: true, reason: 'manual' }),
        new Promise<void>((resolve) => setTimeout(resolve, 700)),
      ]);
    } catch {
      active = null;
    }
  }

  const isSimulation = useFinnusStore.getState().isSimulationMode;
  let offlineOnly = opts.offlineOnly === true;

  if (!offlineOnly && !isSimulation) {
    try {
      const offline = await Promise.race([
        isDeviceOffline(),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 400)),
      ]);
      if (offline) offlineOnly = true;
    } catch {
      /* online annehmen */
    }
  }

  const spotKey = opts.spotKey ?? null;
  let waypoints: NavWaypoint[] = [];
  try {
    waypoints = offlineOnly ? [] : getNavWaypointsForSpot(spotKey);
  } catch {
    waypoints = [];
  }
  // Online: Cache sofort zeigen — darf den Start nicht blockieren
  let cachedRoute: Awaited<ReturnType<typeof getCachedRoute>> = null;
  try {
    cachedRoute = await Promise.race([
      getCachedRoute(opts.lat, opts.lng),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 800)),
    ]);
  } catch {
    cachedRoute = null;
  }
  if (cachedRoute?.waypoints?.length) {
    try {
    const pathLenM = waypointPathLengthM(cachedRoute.waypoints);
    const cacheDist =
      typeof cachedRoute.walkingDistanceM === 'number' &&
      cachedRoute.walkingDistanceM > 0
        ? Math.max(cachedRoute.walkingDistanceM, pathLenM)
        : pathLenM;
    let airToDest = 0;
    try {
      const { useGpsStore } = require('../../store/useGpsStore') as {
        useGpsStore: {
          getState: () => { lat: number | null; lng: number | null };
        };
      };
      const gps = useGpsStore.getState();
      if (gps.lat != null && gps.lng != null) {
        airToDest = distanceMeters(gps.lat, gps.lng, opts.lat, opts.lng);
      }
    } catch {
      airToDest = 0;
    }
    const {
      isImplausiblePedestrianDetour,
    } = require('./googleMapsNav') as {
      isImplausiblePedestrianDetour: (
        routeM: number,
        airM: number,
        mode?: 'walking' | 'bicycling' | 'transit',
      ) => boolean;
    };
    if (
      airToDest > 40 &&
      cacheDist > 0 &&
      isImplausiblePedestrianDetour(cacheDist, airToDest, 'walking')
    ) {
      console.warn('[nav] ignore cached car-like route', {
        cacheDist: Math.round(cacheDist),
        pathLenM: Math.round(pathLenM),
        airToDest: Math.round(airToDest),
      });
      cachedRoute = null;
    } else {
      waypoints = cachedRoute.waypoints;
      if (cacheDist > 0) {
        navTotalDistanceM = Math.round(cacheDist);
      }
    }
    } catch {
      cachedRoute = null;
    }
  }

  try {
    resetSensorState();
  } catch {
    /* soft */
  }

  let arrivalRadiusM = opts.arrivalRadiusM ?? ARRIVAL_FALLBACK_M;
  // Schon nah am Label-Punkt (z. B. „Hafen“ am Rand) → nicht sofort „erreicht“
  try {
    const { useGpsStore } = require('../../store/useGpsStore') as {
      useGpsStore: {
        getState: () => { lat: number | null; lng: number | null };
      };
    };
    const gps = useGpsStore.getState();
    if (
      gps.lat != null &&
      gps.lng != null &&
      Number.isFinite(gps.lat) &&
      Number.isFinite(gps.lng)
    ) {
      const startDist = distanceMeters(gps.lat, gps.lng, opts.lat, opts.lng);
      if (startDist <= arrivalRadiusM * 2.4) {
        arrivalRadiusM = Math.max(
          4,
          Math.min(arrivalRadiusM, Math.floor(startDist * 0.25) || 4),
        );
      }
    }
  } catch {
    /* soft */
  }

  active = {
    poiId: opts.poiId ?? -1,
    name: opts.name.trim(),
    lat: opts.lat,
    lng: opts.lng,
    arrivalRadiusM,
    waypoints,
  };
  flushPendingSeedRoute();
  notifyNavRouteGeometryChanged();
  const journeyStations =
    opts.stations && opts.stations.length > 0 ? opts.stations : null;
  if (journeyStations) {
    active.stations = journeyStations;
    routeHasTransitLegs = true;
  }
  if (opts.transitRide && journeyStations && journeyStations.length >= 1) {
    // Keine Fuß-OSRM entlang Schiene/Buslinie — Stationskette = Route
    const ridePath =
      journeyStations.length >= 2
        ? journeyStations
        : [
            ...journeyStations,
            {
              lat: opts.lat,
              lng: opts.lng,
              maneuver: 'arrive' as const,
              roadName: null,
              landmark: null,
              cue: null,
              instruction: null,
              isStation: true,
              stationName: opts.name,
            },
          ];
    assignActiveWaypoints(ridePath);
    waypoints = ridePath;
    navTotalDistanceM = Math.round(
      waypointPathLengthM(ridePath) ||
        distanceMeters(
          useFinnusStore.getState().lastGpsLat ?? opts.lat,
          useFinnusStore.getState().lastGpsLng ?? opts.lng,
          opts.lat,
          opts.lng,
        ),
    );
  }
  navTrackingStart({ lat: active.lat, lng: active.lng }, active.waypoints);
  if (cachedRoute?.stations?.length) {
    active.stations = cachedRoute.stations;
    routeHasTransitLegs = cachedRoute.travelMode === 'transit';
  }
  if (active.waypoints.length > 0) {
    initMapMatchEngine(active.waypoints);
  }
  waypointIndex = 0;
  turnHapticArmed = true;
  modeSticky = active.waypoints.length > 0 ? 'routing' : 'close_range';
  lastRemainingStations = null;
  if (navTotalDistanceM == null) {
    navTotalDistanceM = null;
  }

  void upsertCachedDestination({
    name: opts.name.trim(),
    lat: opts.lat,
    lng: opts.lng,
    poiId: opts.poiId != null && opts.poiId >= 0 ? opts.poiId : null,
    source: opts.poiId != null && opts.poiId >= 0 ? 'db_poi' : 'nav',
  });

  useFinnusStore.getState().setPendingNavOffer(null);
  useFinnusStore.getState().setPendingNavAlternatives([]);
  void markNavigationUsed();
  resetCueScheduler();
  resetHandsFreeCompass();
  resetHandsFreeEta(lastTransportMode === 'bicycle' ? 'bike' : 'walk');
  if (__DEV__) {
    void import('./handsFreeNav').then((hf) => {
      try {
        hf.runHandsFreeReplayHarness();
      } catch {
        /* soft */
      }
    });
  }
  pushStoreNav({
    navActive: true,
    navVisible: true,
    navMode: modeSticky,
    navTargetName: active.name,
    navDistanceM: null,
    navBearingRel: 0,
    attentionCue: null,
    transportMode: lastTransportMode,
    remainingStations: null,
  });
  notifyNavRouteGeometryChanged();
  const startCommitted = true;
  // Pin-Tap oft am Ort selbst — nicht sofort „angekommen“ und Nav killen
  suppressArrivalUntilMs = Date.now() + 12_000;
  hapticNavTargetSet();
  runtimeNavStart();
  void import('./navTurnPrefetch').then((m) => {
    void m.warmClosedVocabPhrases();
  });
  try {
    const { armLinkBackgroundSpeech } = require('../speech/backgroundSpeechPolicy') as {
      armLinkBackgroundSpeech: (o?: { ttlMs?: number; reason?: string }) => void;
    };
    // Tour/Navi: Speech bleibt bei Sperrbildschirm aktiv (bis Stop)
    armLinkBackgroundSpeech({ ttlMs: 6 * 60 * 60_000, reason: 'NAV_ACTIVE' });
  } catch {
    /* soft */
  }

  if (!simulatedCoords && useFinnusStore.getState().isSimulationMode) {
    const offsetDeg = 80 / 111_320;
    setSimulatedNavCoords({
      lat: active.lat - offsetDeg,
      lng: active.lng,
    });
  }

  void (async () => {
    try {
      await ensureWatchers();

      if (!active) return;

  let originLat = lastLat ?? useFinnusStore.getState().lastGpsLat;
  let originLng = lastLng ?? useFinnusStore.getState().lastGpsLng;
  // Map/UI tracket oft nur useGpsStore — sonst Origin null → keine Route
  if (originLat == null || originLng == null) {
    try {
      const { useGpsStore } = require('../../store/useGpsStore') as {
        useGpsStore: {
          getState: () => { lat: number | null; lng: number | null };
        };
      };
      const gps = useGpsStore.getState();
      if (gps.lat != null && gps.lng != null) {
        originLat = gps.lat;
        originLng = gps.lng;
      }
    } catch {
      /* soft */
    }
  }
  if (
    (originLat == null || originLng == null) &&
    !simulatedCoords &&
    !useFinnusStore.getState().isSimulationMode
  ) {
    try {
      const { getCurrentCoords } = require('../locationService') as {
        getCurrentCoords: (o?: { timeoutMs?: number }) => Promise<{
          lat: number;
          lng: number;
        } | null>;
      };
      const cur = await getCurrentCoords({ timeoutMs: 5000 });
      if (cur) {
        originLat = cur.lat;
        originLng = cur.lng;
      }
    } catch {
      /* soft */
    }
  }

  if (simulatedCoords) {
    tickNavigation(simulatedCoords.lat, simulatedCoords.lng, headingDeg);
    originLat = simulatedCoords.lat;
    originLng = simulatedCoords.lng;
  } else if (originLat != null && originLng != null) {
    // Sofort mit letztem Fix starten — frische Position im Hintergrund
    tickNavigation(originLat, originLng, headingDeg, getSmoothedSpeedMs());
    void Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    })
      .then((cur) => {
        if (!active || !cur?.coords) return;
        tickNavigation(
          cur.coords.latitude,
          cur.coords.longitude,
          headingDeg,
          typeof cur.coords.speed === 'number' ? cur.coords.speed : null,
        );
      })
      .catch(() => undefined);
  } else {
    try {
      const cur = await Promise.race([
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
      ]);
      if (!active) return;
      if (cur && 'coords' in cur) {
        tickNavigation(
          cur.coords.latitude,
          cur.coords.longitude,
          headingDeg,
          typeof cur.coords.speed === 'number' ? cur.coords.speed : null,
        );
        originLat = cur.coords.latitude;
        originLng = cur.coords.longitude;
      }
    } catch {
      // wait for watchers
    }
  }

  if (originLat != null && originLng != null && active) {
    const destName = active.name;
    const destLat = active.lat;
    const destLng = active.lng;
    beginLandmarkNavCoach({
      destinationName: destName,
      destLat,
      destLng,
    });
    const hints = profileTransportHints(
      distanceMeters(originLat, originLng, destLat, destLng),
    );
    const forceTravelMode = opts.forceTravelMode;
    if (forceTravelMode === 'bike') lastTransportMode = 'bicycle';
    else if (forceTravelMode === 'foot') lastTransportMode = 'walk';
    const travelMode =
      forceTravelMode === 'bike'
        ? 'bicycling'
        : forceTravelMode === 'foot'
          ? 'walking'
          : directionsModeForNav({
              motion: lastTransportMode,
              preferTransit:
                hints.preferTransit || isTransitMode(lastTransportMode),
              preferBike: hints.preferBike || lastTransportMode === 'bicycle',
            });

    if (offlineOnly) {
      navTotalDistanceM = Math.round(
        distanceMeters(originLat, originLng, destLat, destLng),
      );
      pushStoreNav({
        navTotalDistanceM,
        navMode: active.waypoints.length > 0 ? 'routing' : 'close_range',
      });
      modeSticky = active.waypoints.length > 0 ? 'routing' : 'close_range';
      kickNavHybridBootstrap({
        destName,
        destLat,
        destLng,
        travelMode,
        walkingDistanceM: navTotalDistanceM,
      });
    } else {
      // transitRide: Fuß-Enrich überspringen — Stationskette bleibt
      if (opts.transitRide && journeyStations?.length) {
        if (lastLat != null && lastLng != null) {
          tickNavigation(lastLat, lastLng, headingDeg, getSmoothedSpeedMs());
        }
        void (async () => {
          markNavRouteReady({
            etaMin: useFinnusStore.getState().navEtaMin,
          });
          await new Promise((r) => setTimeout(r, 200));
          const tryOpening = (attempt: number) => {
            if (!useFinnusStore.getState().isPlayingAudio) {
              void speakNavOpeningIfNeeded(destName);
              return;
            }
            if (attempt < 8) {
              setTimeout(() => tryOpening(attempt + 1), 450);
            }
          };
          tryOpening(0);
        })();
        return;
      }
      let enrichPromise: ReturnType<typeof enrichNavigationRouteFull> | null =
        null;
      try {
        // Explizite Fuß/Rad vom Map-Tap: nicht erst ÖPNV-Lookahead abwarten
        if (forceTravelMode !== 'foot' && forceTravelMode !== 'bike') {
          const { tryAutoTransitBeforeWalk } = require('./navLeaveByFollowUp');
          const airM = distanceMeters(originLat, originLng, destLat, destLng);
          useFinnusStore.getState().setNavRouteLoading(true);
          // Fuß-FOSSGIS parallel zum ÖPNV-Lookahead (nicht 7s + 4s seriell)
          enrichPromise = enrichNavigationRouteFull({
            originLat,
            originLng,
            destLat,
            destLng,
            destinationName: destName,
            travelMode,
          });
          const switched = await tryAutoTransitBeforeWalk({
            destName,
            destLat,
            destLng,
            fromLat: originLat,
            fromLng: originLng,
            airMeters: airM,
          });
          if (switched) {
            try {
              const {
                bumpProgressiveEnrichEpoch,
              } = require('./handsFreeNav/startNav') as {
                bumpProgressiveEnrichEpoch: () => void;
              };
              bumpProgressiveEnrichEpoch();
            } catch {
              /* soft */
            }
            try {
              const { resetLandmarkNavCoach } = require('./landmarkNavCoach') as {
                resetLandmarkNavCoach: () => void;
              };
              resetLandmarkNavCoach();
            } catch {
              /* soft */
            }
            useFinnusStore.getState().setNavRouteLoading(false);
            return;
          }
        }
      } catch {
        /* weiter zu Fuß */
      }
      const hadCachedWaypoints = (active.waypoints.length ?? 0) > 1;
      if (!hadCachedWaypoints) {
        useFinnusStore.getState().setNavRouteLoading(true);
      }

      const commitStreetRoute = (
        enriched: NonNullable<
          Awaited<ReturnType<typeof enrichNavigationRouteFull>>
        >,
      ): boolean => {
        if (!active || active.lat !== destLat || active.lng !== destLng) {
          return false;
        }
        // ÖPNV hat übernommen — Fuß-Enrich nicht drüberlegen
        if (routeHasTransitLegs || travelMode === 'transit') {
          return false;
        }
        if (!enriched.waypoints?.length) return false;
        const airM = distanceMeters(originLat, originLng, destLat, destLng);
        const {
          isImplausiblePedestrianDetour,
        } = require('./googleMapsNav') as {
          isImplausiblePedestrianDetour: (
            routeM: number,
            airM: number,
            mode?: 'walking' | 'bicycling' | 'transit',
          ) => boolean;
        };
        const enrichedLen = Math.max(
          enriched.walkingDistanceM || 0,
          waypointPathLengthM(enriched.waypoints),
        );
        if (
          travelMode !== 'transit' &&
          airM > 40 &&
          isImplausiblePedestrianDetour(enrichedLen, airM, travelMode)
        ) {
          console.warn('[nav] reject enriched car-like route', {
            routeM: Math.round(enrichedLen),
            airM: Math.round(airM),
          });
          return false;
        }
        assignActiveWaypoints(enriched.waypoints);
        navTrackingUpdateWaypoints(active.waypoints);
        initMapMatchEngine(active.waypoints);
        routeHasTransitLegs =
          enriched.travelMode === 'transit' || enriched.stations.length > 0;
        if (enriched.stations.length > 0) {
          active.stations = enriched.stations;
        } else if (journeyStations?.length) {
          active.stations = journeyStations;
          routeHasTransitLegs = true;
        } else if (
          travelMode === 'transit' ||
          isTransitMode(lastTransportMode)
        ) {
          const pack = packStationsTowardDestination();
          active.stations = pack.length ? pack : undefined;
          if (pack.length) routeHasTransitLegs = true;
        } else {
          active.stations = undefined;
        }
        if (
          Number.isFinite(enriched.walkingDistanceM) &&
          enriched.walkingDistanceM > 0
        ) {
          navTotalDistanceM = Math.round(enriched.walkingDistanceM);
          pushStoreNav({
            navTotalDistanceM,
            navDistanceM: navTotalDistanceM,
          });
        }
        waypointIndex = 0;
        modeSticky = 'routing';
        turnHapticArmed = true;
        pushStoreNav({ navMode: 'routing' });
        void putCachedRoute({
          destName,
          destLat,
          destLng,
          waypoints: enriched.waypoints,
          stations: enriched.stations,
          travelMode: enriched.travelMode,
          walkingDistanceM: enriched.walkingDistanceM,
        });
        void upsertCachedDestination({
          name: destName,
          lat: destLat,
          lng: destLng,
          poiId: active.poiId >= 0 ? active.poiId : null,
          source: active.poiId >= 0 ? 'db_poi' : 'route',
        });
        kickNavHybridBootstrap({
          destName,
          destLat,
          destLng,
          travelMode: enriched.travelMode,
          walkingDistanceM: enriched.walkingDistanceM,
        });
        useFinnusStore.getState().setNavRouteLoading(false);
        return true;
      };

      if (!enrichPromise) {
        enrichPromise = enrichNavigationRouteFull({
          originLat,
          originLng,
          destLat,
          destLng,
          destinationName: destName,
          travelMode,
        });
      }
      let enriched: Awaited<ReturnType<typeof enrichNavigationRouteFull>> =
        null;
      try {
        // Fuß-OSRM braucht oft >4s — Timeout darf das Ergebnis nicht verwerfen
        enriched = await Promise.race([
          enrichPromise,
          new Promise<null>((resolve) =>
            setTimeout(() => resolve(null), 5_000),
          ),
        ]);
      } catch {
        enriched = null;
      }

      let committed = false;
      if (enriched?.waypoints?.length) {
        committed = commitStreetRoute(enriched);
      }
      if (!committed) {
        // Spätes FOSSGIS-Ergebnis nach Race-Timeout trotzdem committen
        void enrichPromise
          .then((late) => {
            if (!late?.waypoints?.length) return;
            if ((active?.waypoints?.length ?? 0) >= 3) return;
            commitStreetRoute(late);
          })
          .catch(() => undefined);
      } else {
        useFinnusStore.getState().setNavRouteLoading(false);
      }

      if (committed) {
        /* street route on map */
      } else if (active && active.waypoints.length > 1) {
        // Enrich fehlgeschlagen/Timeout: Auto-Umweg-Cache nicht stehen lassen
        const airM = distanceMeters(originLat, originLng, destLat, destLng);
        const pathLen = waypointPathLengthM(active.waypoints);
        const {
          isImplausiblePedestrianDetour,
        } = require('./googleMapsNav') as {
          isImplausiblePedestrianDetour: (
            routeM: number,
            airM: number,
            mode?: 'walking' | 'bicycling' | 'transit',
          ) => boolean;
        };
        if (
          travelMode !== 'transit' &&
          airM > 40 &&
          isImplausiblePedestrianDetour(pathLen, airM, travelMode)
        ) {
          console.warn('[nav] drop car-like waypoints after enrich miss', {
            pathLen: Math.round(pathLen),
            airM: Math.round(airM),
          });
          assignActiveWaypoints([]);
          navTotalDistanceM = Math.round(airM);
          modeSticky = 'close_range';
          pushStoreNav({
            navMode: 'close_range',
            navTotalDistanceM,
            navDistanceM: airM,
          });
          // Sofort nochmal ohne Race — FOSSGIS Fuß nachladen
          void enrichNavigationRouteFull({
            originLat,
            originLng,
            destLat,
            destLng,
            destinationName: destName,
            travelMode,
          }).then((retry) => {
            if (retry) commitStreetRoute(retry);
          });
        }
      } else if (
        active &&
        active.lat === destLat &&
        active.lng === destLng &&
        (active.waypoints?.length ?? 0) < 3 &&
        travelMode !== 'transit'
      ) {
        // Enrich leer/Timeout: Fuß-Polyline nachladen (nicht nur bei Car-Cache-Drop)
        void enrichNavigationRouteFull({
          originLat,
          originLng,
          destLat,
          destLng,
          destinationName: destName,
          travelMode,
        }).then((retry) => {
          if (!retry || !commitStreetRoute(retry)) {
            useFinnusStore.getState().setNavRouteLoading(false);
          }
        });
      } else if (!committed) {
        useFinnusStore.getState().setNavRouteLoading(false);
      }
    }

    // Umweg-Route + echte Fuß/Rad-ETA ≤ 10 Min → sofort neu berechnen & starten
    // WICHTIG: Opening erst NACH ggf. Auto-Recalc — sonst Luftlinie/Falsch-ETA in Speech
    let pendingBestRouteRecalc: Promise<void> | null = null;
    if (
      !offlineOnly &&
      active &&
      active.waypoints.length > 1 &&
      originLat != null &&
      originLng != null
    ) {
      const airM = distanceMeters(originLat, originLng, destLat, destLng);
      const pathLen = Math.max(
        navTotalDistanceM ?? 0,
        waypointPathLengthM(active.waypoints),
      );
      const pace = lastTransportMode === 'bicycle' ? 220 : 80;
      const estMin = Math.max(1, Math.ceil(airM / pace));
      try {
        const {
          isImplausiblePedestrianDetour,
        } = require('./googleMapsNav') as {
          isImplausiblePedestrianDetour: (
            routeM: number,
            airM: number,
            mode?: 'walking' | 'bicycling' | 'transit',
          ) => boolean;
        };
        if (
          airM > 40 &&
          estMin <= SHORT_ROUTE_AUTO_ETA_MIN &&
          isImplausiblePedestrianDetour(
            pathLen,
            airM,
            lastTransportMode === 'bicycle' ? 'bicycling' : 'walking',
          )
        ) {
          useFinnusStore.getState().setNavRouteLoading(true);
          pendingBestRouteRecalc = silentRecalculateRoute({
            announce: false,
          }).finally(() => {
            useFinnusStore.getState().setNavRouteLoading(false);
          });
        }
      } catch {
        /* soft */
      }
    }

    if (lastLat != null && lastLng != null) {
      tickNavigation(lastLat, lastLng, headingDeg, getSmoothedSpeedMs());
    }

    // Route-ready gate: Opening erst wenn committed Route steht (kein Loading)
    void (async () => {
      if (pendingBestRouteRecalc) {
        try {
          await pendingBestRouteRecalc;
        } catch {
          /* soft */
        }
      }
      // Cached waypoints ohne Enrich: trotzdem als ready markieren wenn Pfad da
      if (
        active &&
        active.waypoints.length > 1 &&
        !offlineOnly
      ) {
        try {
          const { isNavRouteReadyForSpeech } = require('./landmarkNavCoach') as {
            isNavRouteReadyForSpeech: () => boolean;
          };
          if (!isNavRouteReadyForSpeech()) {
            markNavRouteReady({
              etaMin: useFinnusStore.getState().navEtaMin,
              startLandmark: active.waypoints[0]?.landmark ?? null,
            });
          }
        } catch {
          markNavRouteReady({
            etaMin: useFinnusStore.getState().navEtaMin,
          });
        }
      } else if (active) {
        // Auch ohne Polyline: Opening mit Luftlinien-ETA — nicht stumm abbrechen
        try {
          const { isNavRouteReadyForSpeech } = require('./landmarkNavCoach') as {
            isNavRouteReadyForSpeech: () => boolean;
          };
          if (!isNavRouteReadyForSpeech()) {
            const eta =
              useFinnusStore.getState().navEtaMin ??
              (navTotalDistanceM != null
                ? Math.max(1, Math.round(navTotalDistanceM / 80))
                : originLat != null && originLng != null
                  ? Math.max(
                      1,
                      Math.round(
                        distanceMeters(originLat, originLng, destLat, destLng) /
                          80,
                      ),
                    )
                  : null);
            markNavRouteReady({ etaMin: eta });
          }
        } catch {
          markNavRouteReady({
            etaMin: useFinnusStore.getState().navEtaMin,
          });
        }
      }

      // >~20 Min Fuß → ÖPNV automatisch wenn schneller (Timeline + Journey-Start).
      // Walk-/Weave-Touren: Auto-ÖPNV erlauben. Nur echte ÖPNV-Journey-Touren
      // überspringen (sonst Rekursion board→alight→…).
      let deferWalkOpening = false;
      const activeTour = useFinnusStore.getState().multiStopTour;
      const tourIsTransitJourney = Boolean(
        activeTour?.stops?.some(
          (s) =>
            s.role === 'board' ||
            s.role === 'alight' ||
            s.role === 'transfer',
        ),
      );
      if (
        !offlineOnly &&
        !opts.transitRide &&
        !tourIsTransitJourney
      ) {
        try {
          const { airNeedsTransitLookahead, PLAN_SOFT_MODE_MAX_MIN } = require('../../module2/planning/planMobilityPolicy') as {
            airNeedsTransitLookahead: (o: { airMeters: number; preferBike?: boolean }) => boolean;
            PLAN_SOFT_MODE_MAX_MIN: number;
          };
          const distM =
            useFinnusStore.getState().navTotalDistanceM ??
            navTotalDistanceM ??
            (originLat != null && originLng != null
              ? distanceMeters(originLat, originLng, destLat, destLng)
              : null);
          const eta =
            useFinnusStore.getState().navEtaMin ??
            (distM != null
              ? Math.max(1, Math.round(distM / 80))
              : null);
          const airM =
            originLat != null && originLng != null
              ? distanceMeters(originLat, originLng, destLat, destLng)
              : distM;
          const longWalk =
            eta != null &&
            eta > PLAN_SOFT_MODE_MAX_MIN &&
            distM != null &&
            distM > 0;
          const longAir =
            airM != null &&
            airNeedsTransitLookahead({
              airMeters: airM,
              preferBike: opts.forceTravelMode === 'bike',
            });
          if ((longWalk || longAir) && distM != null && distM > 0 && eta != null) {
            const {
              offerMobilityChoiceAfterRouteReady,
            } = require('./navLeaveByFollowUp') as {
              offerMobilityChoiceAfterRouteReady: (o: {
                destName: string;
                destLat: number;
                destLng: number;
                walkMin: number;
                walkDistanceM: number;
                fromLat?: number | null;
                fromLng?: number | null;
              }) => Promise<{
                deferredWalkSpeech: boolean;
                autoStartedTransit?: boolean;
              }>;
            };
            const choice = await offerMobilityChoiceAfterRouteReady({
              destName,
              destLat,
              destLng,
              walkMin: eta,
              walkDistanceM: distM,
              fromLat: originLat,
              fromLng: originLng,
            });
            deferWalkOpening = choice.deferredWalkSpeech;
          }
        } catch {
          /* soft */
        }
      }

      if (deferWalkOpening) {
        markNavOpeningSpoken();
        return;
      }

      await new Promise((r) => setTimeout(r, 120));
      try {
        useFinnusStore.getState().setNavRouteLoading(false);
      } catch {
        /* soft */
      }
      const tryOpening = (attempt: number) => {
        if (useFinnusStore.getState().navRouteLoading) {
          if (attempt < 8) setTimeout(() => tryOpening(attempt + 1), 450);
          return;
        }
        if (!useFinnusStore.getState().isPlayingAudio) {
          void speakNavOpeningIfNeeded(destName);
          return;
        }
        // Audio noch aktiv (z. B. kurzes Ack) — Opener nicht verwerfen, nachziehen
        if (attempt < 8) {
          setTimeout(() => tryOpening(attempt + 1), 450);
        }
      };
      tryOpening(0);
    })();
  } else if (active && !opts.transitRide) {
    // Kein GPS-Origin → keine Polyline; ehrlich sagen statt stumm
    try {
      const { speakAssistantText } = require('../ttsService') as {
        speakAssistantText: (t: string) => Promise<void>;
      };
      void speakAssistantText(
        'Sorry, GPS hängt kurz. Geh ein paar Schritte ins Freie — dann plane ich die Route neu.',
      ).catch(() => undefined);
    } catch {
      /* soft */
    }
  }
    } catch {
      /* Start ist committed — Enrich/GPS dürfen den Button nicht mehr failen */
    }
  })();

  return true;
}

export async function fadeAndStopNavigation(): Promise<void> {
  if (!active && !useFinnusStore.getState().navActive) return;

  resetLandmarkNavCoach();
  navTrackingStop(Date.now());
  pendingSeedRoute = null;
  active = null;
  await stopWatchers();
  resetSensorState();

  pushStoreNav({ navVisible: false });
  if (fadeCompleteTimer) clearTimeout(fadeCompleteTimer);
  fadeCompleteTimer = setTimeout(() => {
    void stopNavigation({ silent: true });
  }, 450);
}

export async function stopNavigation(opts?: {
  silent?: boolean;
  /** Cache invalidieren (Abbruch nahe Ziel / Fail) */
  invalidateEntranceCache?: boolean;
  reason?: 'user_abort_near' | 'nav_fail' | 'manual' | 'arrival';
}): Promise<void> {
  const destSnapshot = active
    ? {
        name: active.name,
        lat: active.lat,
        lng: active.lng,
        placeId: (active as { placeId?: string }).placeId ?? null,
      }
    : null;
  const store = useFinnusStore.getState();
  const userLat = store.lastGpsLat;
  const userLng = store.lastGpsLng;
  const distM =
    destSnapshot && userLat != null && userLng != null
      ? distanceMeters(userLat, userLng, destSnapshot.lat, destSnapshot.lng)
      : null;

  resetLandmarkNavCoach();
  navTrackingStop(Date.now());
  pendingSeedRoute = null;
  active = null;
  waypointIndex = 0;
  simulatedCoords = null;
  try {
    const { clearNavRouteSnapshot } = require('./navRouteSnapshot') as {
      clearNavRouteSnapshot: () => void;
    };
    clearNavRouteSnapshot();
  } catch {
    /* soft */
  }
  if (fadeCompleteTimer) {
    clearTimeout(fadeCompleteTimer);
    fadeCompleteTimer = null;
  }
  await stopWatchers();
  resetSensorState();
  resetStationCountdownAnnouncements();
  resetTransitGuideCoach();
  displayedNavDistanceM = null;
  pushStoreNav({
    navActive: false,
    navVisible: false,
    navMode: null,
    navTargetName: null,
    navDistanceM: null,
    navBearingRel: null,
    attentionCue: null,
    remainingStations: null,
    navNextTargetName: null,
    navLegDistanceM: null,
    navTotalDistanceM: null,
    navTurnHint: null,
  });
  useFinnusStore.getState().setNavRouteLoading(false);
  runtimeNavEnd();
  try {
    const { clearLinkBackgroundSpeech } = require('../speech/backgroundSpeechPolicy') as {
      clearLinkBackgroundSpeech: () => void;
    };
    clearLinkBackgroundSpeech();
  } catch {
    /* soft */
  }
  void opts?.silent;

  // Falsche Eingangstür: Abbruch nahe Ziel oder expliziter Fail → Cache weg
  const reason = opts?.reason;
  const nearAbort =
    opts?.invalidateEntranceCache === true ||
    reason === 'nav_fail' ||
    reason === 'user_abort_near' ||
    (reason !== 'arrival' && distM != null && distM <= 180 && !opts?.silent);
  // Manueller Stop ohne silent + nahe Ziel
  const manualNear =
    !opts?.silent &&
    distM != null &&
    distM <= 180 &&
    reason !== 'arrival';

  if (destSnapshot && (nearAbort || manualNear)) {
    const invReason: 'nav_fail' | 'user_abort_near' =
      reason === 'nav_fail' ? 'nav_fail' : 'user_abort_near';
    void import('./placesFactCache')
      .then((m) =>
        m.invalidateEntranceCacheOnNavAbort({
          destName: destSnapshot.name,
          placeId: destSnapshot.placeId,
          destLat: destSnapshot.lat,
          destLng: destSnapshot.lng,
          userLat,
          userLng,
          reason: invReason,
        }),
      )
      .catch(() => {});
  }
}

export function onSpokenTextForAttention(_text: string | null): void {
  // Attention cues are scanned in useFinnusStore.noteSpokenText
}

/**
 * When destination geofence / story starts: fade compass + throttle GPS.
 */
export function notifyDestinationAudioStarted(poiId: number): void {
  if (!active) return;
  if (active.poiId !== poiId && !isRelatedNavPoi(poiId)) return;
  const store = useFinnusStore.getState();
  if (store.isGenerating || store.isListening) return;
  void fadeAndStopNavigation();
  void setGpsStreamProfile('throttled');
}

function isRelatedNavPoi(poiId: number): boolean {
  if (!active) return false;
  return active.poiId === poiId;
}

/** Nach Audio wieder 1-Hz Free-Roam. */
export function notifyDestinationAudioEnded(): void {
  void setGpsStreamProfile('realtime');
}
