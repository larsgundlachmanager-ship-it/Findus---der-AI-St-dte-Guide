/**
 * Smart Compass — high-frequency navigation (1 Hz GPS).
 * Speed-aware thresholds for walk / bicycle / transit.
 */

import * as Location from 'expo-location';
import type { LocationSubscription } from 'expo-location';
import { getPoiWithFacts } from '../../db/database';
import { useFinnusStore } from '../../store/useFinnusStore';
import { getCachedUserProfile } from '../userProfileService';
import {
  getGpsStreamProfile,
  requestLocationPermission,
  setGpsStreamProfile,
} from '../locationService';
import { speakAssistantText } from '../ttsService';
import {
  getCachedRoute,
  putCachedRoute,
  upsertCachedDestination,
} from './offlineNavCache';
import { isDeviceOffline } from './networkState';
import {
  bearingDegrees,
  distanceMeters,
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
import {
  beginLandmarkNavCoach,
  enrichNavigationRouteFull,
  markNavOpeningSpoken,
  onNavigationTickForCoach,
  resetLandmarkNavCoach,
  speakNavOpeningIfNeeded,
  speakWrongWayInterrupt,
} from './landmarkNavCoach';
import {
  maybeSpeakAlightNow,
  onRemainingStationsChanged,
  resetStationCountdownAnnouncements,
} from './stationCountdown';
import { getPackTransitStops } from '../transit/stationRegistry';
import { advanceMultiStopTour } from './multiStopTour';
import { travelModeNavPrefs } from './travelModeContext';
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

const positionFilter = new PositionLowPass(0.35, 28);

let lastPushMs = 0;
let pendingNavPatch: Parameters<typeof pushStoreNav>[0] | null = null;
let navPushTimeout: ReturnType<typeof setTimeout> | null = null;

function pushStoreNav(partial: {
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
  const now = Date.now();
  if (now - lastPushMs >= 1000) {
    if (navPushTimeout) {
      clearTimeout(navPushTimeout);
      navPushTimeout = null;
    }
    useFinnusStore.getState().patchNavigation(pendingNavPatch ? { ...pendingNavPatch, ...partial } : partial);
    pendingNavPatch = null;
    lastPushMs = now;
  } else {
    pendingNavPatch = { ...pendingNavPatch, ...partial };
    if (!navPushTimeout) {
      navPushTimeout = setTimeout(() => {
        if (pendingNavPatch) {
          useFinnusStore.getState().patchNavigation(pendingNavPatch);
          pendingNavPatch = null;
          lastPushMs = Date.now();
        }
        navPushTimeout = null;
      }, 1000 - (now - lastPushMs));
    }
  }
}

function profileTransportHints(): {
  preferTransit: boolean;
  preferBike: boolean;
} {
  return travelModeNavPrefs();
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
  return (
    waypointIndex < active.waypoints.length - 1
      ? wp?.stationName?.trim() || wp?.landmark?.trim() || active.name
      : active.name
  );
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
    alongM = match.projection?.alongM ?? 0;
  }

  // Reststrecke: Directions-Gesamt − Fortschritt, nie Luftlinie als „Gesamt“
  const distanceToDestinationM =
    navTotalDistanceM != null && navTotalDistanceM > 0
      ? Math.max(0, navTotalDistanceM - alongM)
      : distanceToDestinationAirM;

  // Sidewalk / user-side nudge for compass targets (keeps map-match on centerline)
  const gpsAccuracyM = useFinnusStore.getState().gpsAccuracyM;
  const aligned = alignWaypointsForUserSide({
    waypoints: active.waypoints,
    userLat: lat,
    userLng: lng,
    gpsAccuracyM,
    fromIndex: waypointIndex,
  });
  const arrowWp =
    aligned[Math.min(waypointIndex + 1, aligned.length - 1)] ??
    aligned[waypointIndex];
  const arrowTarget = arrowWp
    ? arrowTargetFromWaypoint(arrowWp)
    : { lat: active.lat, lng: active.lng };

  const spline = getMapMatchSpline();
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
  // Prefer sidewalk-aligned look-ahead when available
  if (arrowTarget.lat !== active.lat || arrowTarget.lng !== active.lng) {
    arrow.lat = arrowTarget.lat;
    arrow.lng = arrowTarget.lng;
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

  const arrived = distanceToDestinationM <= active.arrivalRadiusM;
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
    const prev = lastRemainingStations;
    lastRemainingStations = tick.remainingStations;
    if (prev != null) {
      void onRemainingStationsChanged(tick.remainingStations, {
        transportMode: tick.transportMode,
        targetName: tick.targetName,
      });
    }
  }

  void maybeSpeakAlightNow({
    transportMode: tick.transportMode,
    remainingStations: tick.remainingStations ?? null,
    distanceToDestinationM: tick.distanceToDestinationM,
    speedMs: tick.speedMs ?? null,
  });

  // Phase-Wechsel: eingestiegen / ausgestiegen → Fußmodus
  if (tick.navPhase && tick.navPhase !== announcedNavPhase) {
    const prevPhase = announcedNavPhase;
    announcedNavPhase = tick.navPhase;
    if (
      prevPhase === 'walk_to_stop' &&
      tick.navPhase === 'in_transit' &&
      !useFinnusStore.getState().isPlayingAudio
    ) {
      const vehicle =
        tick.transportMode === 'transit_bus'
          ? 'Bus'
          : tick.transportMode === 'transit_train'
            ? 'Bahn'
            : 'Öffis';
      const rem = tick.remainingStations;
      const goodTrip = [
        `Gute Fahrt — ich meld mich vor dem Ausstieg.`,
        `Entspann dich kurz, ich zähl die Stationen mit.`,
        `Alles easy — ich sag Bescheid, wann's rausgeht.`,
        rem != null && rem >= 2
          ? `Noch etwa ${rem} Stationen — ich wünsch dir eine gute Fahrt.`
          : `Gute Fahrt mit der ${vehicle}.`,
      ];
      const line = goodTrip[Math.floor(Math.random() * goodTrip.length)]!;
      void speakAssistantText(
        `${vehicle} erwischt — super. ${line}`,
      ).catch(() => {});
    }
    if (
      (prevPhase === 'in_transit' || prevPhase === 'walk_to_stop') &&
      tick.navPhase === 'post_transit_walk'
    ) {
      const remM = Math.round(tick.distanceToDestinationM);
      const mins = Math.max(1, Math.ceil(remM / 80));
      void speakAssistantText(
        remM > 80
          ? `Ausgestiegen — noch etwa ${mins} Minuten zu Fuß, Kompass ist wieder an.`
          : 'Ausgestiegen — gleich sind wir da, Kompass führt dich hin.',
      ).catch(() => {});
    }
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
    const wp =
      active.waypoints[
        Math.min(waypointIndex, Math.max(0, active.waypoints.length - 1))
      ];
    const landmark =
      wp?.visibleLandmark?.trim() || wp?.landmark?.trim() || null;
    speakWrongWayInterrupt({
      landmark,
      headingDeg,
      correctTargetBearingDeg: pathBearing,
      backtrackM: missed.backtrackM,
    });
  } else if (wrongWayAction === 'reroute' && active) {
    void silentRecalculateRoute();
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
    void (async () => {
      const destName = active?.name ?? 'Ziel';
      try {
        const { buildArrivedCue } = await import('./spatialOrientation');
        await speakAssistantText(buildArrivedCue(destName));
      } catch {
        /* soft */
      }
      const continued = await advanceMultiStopTour();
      if (!continued) {
        await fadeAndStopNavigation();
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

/** Last device compass heading (degrees). */
export function getDeviceHeadingDeg(): number | null {
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
          const raw =
            typeof h.trueHeading === 'number' && h.trueHeading >= 0
              ? h.trueHeading
              : h.magHeading;
          if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
            headingDeg = pushAdaptiveHeading(raw, {
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
  resetMotionTransportState();
  resetWrongWayMonitor();
  resetBoardingDetector();
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
      active.waypoints = wps;
      navTrackingUpdateWaypoints(wps);
      initMapMatchEngine(wps);
    },
  });
}

/**
 * Silent auto-reroute after wrong-way grace — no voice, seamless swap of spline.
 * Offline: keine HTTP-Neuberechnung — Hybrid-Ansage (zurück / Netz).
 */
async function silentRecalculateRoute(): Promise<void> {
  if (!active || rerouteInFlight) return;
  if (lastLat == null || lastLng == null) return;
  if (await isDeviceOffline()) {
    void announceNavHybridOfflineRerouteBlocked();
    return;
  }
  const dest = active;
  const originLat = lastLat;
  const originLng = lastLng;
  rerouteInFlight = true;
  try {
    const hints = profileTransportHints();
    const travelMode = directionsModeForNav({
      motion: lastTransportMode,
      preferTransit: hints.preferTransit || isTransitMode(lastTransportMode),
      preferBike: hints.preferBike || lastTransportMode === 'bicycle',
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
          }
        : await enrichNavigationRouteFull({
            originLat,
            originLng,
            destLat: dest.lat,
            destLng: dest.lng,
            destinationName: dest.name,
            travelMode,
          });
    if (!enriched?.waypoints?.length || !active) return;
    if (active.lat !== dest.lat || active.lng !== dest.lng) return;
    active.waypoints = enriched.waypoints;
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
    pushStoreNav({ navMode: 'routing' });
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
    if (lastLat != null && lastLng != null) {
      tickNavigation(lastLat, lastLng, headingDeg, getSmoothedSpeedMs());
    }
    if (__DEV__) {
      console.log('[nav] silent auto-reroute applied');
    }
  } catch (err) {
    console.warn('[nav] silent recalculate failed:', err);
    if (await isDeviceOffline()) {
      void announceNavHybridOfflineRerouteBlocked();
    }
  } finally {
    rerouteInFlight = false;
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
}): Promise<boolean> {
  if (
    !Number.isFinite(opts.lat) ||
    !Number.isFinite(opts.lng) ||
    !opts.name.trim()
  ) {
    return false;
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
    st.setPendingNavOffer(null);
    st.setPendingNavAlternatives([]);
    st.setNavRouteLoading(false);
  }
  const st0 = useFinnusStore.getState();
  if (active || st0.navActive) {
    await stopNavigation({ silent: true, reason: 'manual' });
  }

  const isSimulation = useFinnusStore.getState().isSimulationMode;
  let offlineOnly = opts.offlineOnly === true;

  if (!offlineOnly && !isSimulation) {
    const offline = await isDeviceOffline();
    if (offline) {
      offlineOnly = true;
    }
  }

  const spotKey = opts.spotKey ?? null;
  let waypoints: NavWaypoint[] = offlineOnly
    ? []
    : getNavWaypointsForSpot(spotKey);
  // Online: Cache sofort zeigen (Genauigkeit bleibt durch Hintergrund-Refresh)
  let cachedRoute = await getCachedRoute(opts.lat, opts.lng);
  if (cachedRoute?.waypoints?.length) {
    waypoints = cachedRoute.waypoints;
    if (cachedRoute.walkingDistanceM != null && cachedRoute.walkingDistanceM > 0) {
      navTotalDistanceM = cachedRoute.walkingDistanceM;
    }
  }

  resetSensorState();

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
      if (startDist <= arrivalRadiusM * 1.8) {
        arrivalRadiusM = Math.max(
          12,
          Math.min(arrivalRadiusM, Math.floor(startDist * 0.4) || 12),
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
  hapticNavTargetSet();
  runtimeNavStart();

  if (!simulatedCoords && useFinnusStore.getState().isSimulationMode) {
    const offsetDeg = 80 / 111_320;
    setSimulatedNavCoords({
      lat: active.lat - offsetDeg,
      lng: active.lng,
    });
  }

  await ensureWatchers();

  if (!active) return false;

  let originLat = lastLat ?? useFinnusStore.getState().lastGpsLat;
  let originLng = lastLng ?? useFinnusStore.getState().lastGpsLng;

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
      if (!active) return false;
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
    // Vorläufig: Luftlinie über Waypoints — nach Enrich nur noch Fuß-Meter
    let total = 0;
    if (active.waypoints.length > 0) {
      let prevLat = originLat;
      let prevLng = originLng;
      for (const wp of active.waypoints) {
        total += distanceMeters(prevLat, prevLng, wp.lat, wp.lng);
        prevLat = wp.lat;
        prevLng = wp.lng;
      }
      total += distanceMeters(prevLat, prevLng, active.lat, active.lng);
    } else {
      total = distanceMeters(originLat, originLng, active.lat, active.lng);
    }
    navTotalDistanceM = Math.round(total);
    pushStoreNav({ navTotalDistanceM });

    const destName = active.name;
    const destLat = active.lat;
    const destLng = active.lng;
    beginLandmarkNavCoach({
      destinationName: destName,
      destLat,
      destLng,
    });
    void (async () => {
      await new Promise((r) => setTimeout(r, 200));
      if (!useFinnusStore.getState().isPlayingAudio) {
        void speakNavOpeningIfNeeded(destName);
      } else {
        markNavOpeningSpoken();
      }
      const hints = profileTransportHints();
      const travelMode = directionsModeForNav({
        motion: lastTransportMode,
        preferTransit: hints.preferTransit || isTransitMode(lastTransportMode),
        preferBike: hints.preferBike || lastTransportMode === 'bicycle',
      });
      
      if (offlineOnly) {
        if (!navTotalDistanceM || navTotalDistanceM <= 0) {
          navTotalDistanceM = Math.round(
            distanceMeters(originLat!, originLng!, destLat, destLng),
          );
        }
        pushStoreNav({
          navTotalDistanceM,
          navMode: active.waypoints.length > 0 ? 'routing' : 'close_range',
        });
        modeSticky = active.waypoints.length > 0 ? 'routing' : 'close_range';
        if (lastLat != null && lastLng != null) {
          tickNavigation(lastLat, lastLng, headingDeg, getSmoothedSpeedMs());
        }
        kickNavHybridBootstrap({
          destName,
          destLat,
          destLng,
          travelMode,
          walkingDistanceM: navTotalDistanceM,
        });
        return;
      }

      const hadCachedWaypoints = (active?.waypoints.length ?? 0) > 1;
      if (!hadCachedWaypoints) {
        useFinnusStore.getState().setNavRouteLoading(true);
      }
      let enriched;
      try {
        enriched = await enrichNavigationRouteFull({
          originLat: originLat!,
          originLng: originLng!,
          destLat,
          destLng,
          destinationName: destName,
          travelMode,
        });
      } finally {
        useFinnusStore.getState().setNavRouteLoading(false);
      }
      if (!enriched?.waypoints?.length || !active) return;
      if (active.lat !== destLat || active.lng !== destLng) return;
      active.waypoints = enriched.waypoints;
      navTrackingUpdateWaypoints(active.waypoints);
      initMapMatchEngine(active.waypoints);
      routeHasTransitLegs =
        enriched.travelMode === 'transit' || enriched.stations.length > 0;
      if (enriched.stations.length > 0) {
        active.stations = enriched.stations;
      } else if (travelMode === 'transit' || isTransitMode(lastTransportMode)) {
        const pack = packStationsTowardDestination();
        active.stations = pack.length ? pack : undefined;
        if (pack.length) routeHasTransitLegs = true;
      } else {
        active.stations = undefined;
      }
      // Gesamt = nur Fuß/Rad (Bahn-km zählen nicht)
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
      if (lastLat != null && lastLng != null) {
        tickNavigation(lastLat, lastLng, headingDeg, getSmoothedSpeedMs());
      }
    })();
  }

  return true;
}

export async function fadeAndStopNavigation(): Promise<void> {
  if (!active && !useFinnusStore.getState().navActive) return;

  resetLandmarkNavCoach();
  navTrackingStop(Date.now());
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
  active = null;
  waypointIndex = 0;
  simulatedCoords = null;
  if (fadeCompleteTimer) {
    clearTimeout(fadeCompleteTimer);
    fadeCompleteTimer = null;
  }
  await stopWatchers();
  resetSensorState();
  resetStationCountdownAnnouncements();
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
