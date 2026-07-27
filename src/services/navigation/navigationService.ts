/**
 * Smart Compass — high-frequency navigation (1 Hz GPS).
 * Speed-aware thresholds for walk / bicycle / transit.
 */

import * as Location from 'expo-location';
import type { LocationSubscription } from 'expo-location';
import { getPoiWithFacts } from '../../db/database';
import { useFinnusStore } from '../../store/useFinnusStore';
import { showPermissionMissingAlert } from '../../utils/permissionAlerts';
import { getCachedUserProfile } from '../userProfileService';
import { setGpsStreamProfile } from '../locationService';
import {
  bearingDegrees,
  distanceMeters,
  relativeBearingDeg,
} from './bearing';
import { hapticNavTargetSet, hapticTurnImminent } from './haptics';
import { getNavWaypointsForSpot } from './navWaypointsRegistry';
import { HeadingLowPass, PositionLowPass } from './sensorFilter';
import {
  ARRIVAL_FALLBACK_M,
  CLOSE_RANGE_EXIT_M,
  CLOSE_RANGE_M,
  GPS_REALTIME_DISTANCE_M,
  GPS_REALTIME_INTERVAL_MS,
  HEADING_LOWPASS_ALPHA,
  TURN_IMMINENT_DEG,
  type AttentionCue,
  type NavDestination,
  type NavMode,
  type NavigationTick,
  type NavWaypoint,
  type TransportMode,
} from './navigationTypes';
import {
  classifyMotionTransportMode,
  getSmoothedSpeedMs,
  isTransitMode,
  pushSpeedSample,
  resetMotionTransportState,
  thresholdsForMode,
} from './transportMode';
import { markNavigationUsed } from '../ai/featureTips';
import {
  beginLandmarkNavCoach,
  enrichNavigationRoute,
  markNavOpeningSpoken,
  onNavigationTickForCoach,
  resetLandmarkNavCoach,
  speakNavOpeningIfNeeded,
} from './landmarkNavCoach';
import {
  onRemainingStationsChanged,
  resetStationCountdownAnnouncements,
} from './stationCountdown';

let active: NavDestination | null = null;
let waypointIndex = 0;
/** Sticky mode with exit hysteresis (see CLOSE_RANGE_EXIT_M). */
let modeSticky: NavMode = 'routing';
let headingDeg = 0;
let lastLat: number | null = null;
let lastLng: number | null = null;
let posSub: LocationSubscription | null = null;
let headingSub: LocationSubscription | null = null;
let turnHapticArmed = true;
let fadeCompleteTimer: ReturnType<typeof setTimeout> | null = null;
/** Optional simulated user position (SimulationPicker / no GPS). */
let simulatedCoords: { lat: number; lng: number } | null = null;
let lastTransportMode: TransportMode = 'walk';
let lastRemainingStations: number | null = null;
let navTotalDistanceM: number | null = null;

const headingFilter = new HeadingLowPass(HEADING_LOWPASS_ALPHA);
const positionFilter = new PositionLowPass(0.35, 28);

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
}): void {
  useFinnusStore.getState().patchNavigation(partial);
}

function profileTransportHints(): {
  preferTransit: boolean;
  preferBike: boolean;
} {
  const p = getCachedUserProfile();
  const prefs = p?.experiencePrefs ?? {};
  const mobility = p?.mobilityMode;
  return {
    preferTransit: mobility === 'public_transit' || prefs.oepnv === 'yes',
    preferBike: mobility === 'bike' || prefs.fahrrad === 'yes',
  };
}

function resolveMode(distanceToDestinationM: number): NavMode {
  if (distanceToDestinationM < CLOSE_RANGE_M) {
    modeSticky = 'close_range';
  } else if (distanceToDestinationM > CLOSE_RANGE_EXIT_M) {
    modeSticky = 'routing';
  }
  return modeSticky;
}

function currentArrowTarget(mode: NavMode): {
  lat: number;
  lng: number;
  name: string;
} {
  if (!active) {
    return { lat: 0, lng: 0, name: '' };
  }

  if (mode === 'close_range' || active.waypoints.length === 0) {
    return { lat: active.lat, lng: active.lng, name: active.name };
  }

  const wp =
    active.waypoints[Math.min(waypointIndex, active.waypoints.length - 1)];
  if (!wp) {
    return { lat: active.lat, lng: active.lng, name: active.name };
  }
  return {
    lat: wp.lat,
    lng: wp.lng,
    name:
      waypointIndex < active.waypoints.length - 1
        ? wp.stationName?.trim() || wp.landmark?.trim() || 'nächster Punkt'
        : active.name,
  };
}

/** Haltestellen-Kette: explizit oder Waypoints (bei Transit alle als Stationen). */
function stationList(): NavWaypoint[] {
  if (!active) return [];
  if (active.stations && active.stations.length > 0) return active.stations;
  if (active.waypoints.some((w) => w.isStation)) {
    return active.waypoints.filter((w) => w.isStation);
  }
  return active.waypoints;
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
  const thr = thresholdsForMode(transportMode);

  const distanceToDestinationM = distanceMeters(
    lat,
    lng,
    active.lat,
    active.lng,
  );
  const mode = resolveMode(distanceToDestinationM);

  const advanceM = thr.waypointAdvanceM;
  if (mode === 'routing' && active.waypoints.length > 0) {
    while (waypointIndex < active.waypoints.length) {
      const wp = active.waypoints[waypointIndex];
      const d = distanceMeters(lat, lng, wp.lat, wp.lng);
      if (d <= advanceM) {
        waypointIndex += 1;
        hapticNavTargetSet();
        turnHapticArmed = true;
      } else {
        break;
      }
    }
  }

  const arrow = currentArrowTarget(mode);
  const distanceToArrowM = distanceMeters(lat, lng, arrow.lat, arrow.lng);
  const absBearing = bearingDegrees(lat, lng, arrow.lat, arrow.lng);
  const bearingRelDeg = relativeBearingDeg(heading, absBearing);

  const turnImminent =
    mode === 'routing' &&
    distanceToArrowM <= thr.turnImminentM &&
    Math.abs(bearingRelDeg) >= TURN_IMMINENT_DEG;

  const arrived = distanceToDestinationM <= active.arrivalRadiusM;
  const remainingStations = computeRemainingStations(lat, lng, transportMode);

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
  };
}

function applyTick(tick: NavigationTick, arrowName: string): void {
  pushStoreNav({
    navActive: true,
    navVisible: true,
    navMode: tick.mode,
    navTargetName: tick.targetName,
    navDistanceM: Math.round(tick.distanceToDestinationM),
    navBearingRel: tick.bearingRelDeg,
    transportMode: tick.transportMode,
    remainingStations: tick.remainingStations ?? null,
    navNextTargetName: arrowName,
    navLegDistanceM: Math.round(tick.distanceToArrowM),
    navTotalDistanceM,
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

  if (tick.turnImminent && turnHapticArmed) {
    hapticTurnImminent();
    turnHapticArmed = false;
  } else if (!tick.turnImminent) {
    turnHapticArmed = true;
  }

  if (active) {
    onNavigationTickForCoach(tick, {
      waypointIndex,
      waypoints: active.waypoints,
    });
  }

  if (tick.arrived) {
    void fadeAndStopNavigation();
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

  if (typeof heading === 'number' && Number.isFinite(heading)) {
    headingDeg = headingFilter.push(heading);
  }

  const tick = computeTick(lastLat, lastLng, headingDeg, speedMs);
  if (tick) {
    const arrow = currentArrowTarget(tick.mode);
    applyTick(tick, arrow.name);
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

async function ensureWatchers(): Promise<void> {
  if (posSub || headingSub) return;
  if (!active) return;

  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      showPermissionMissingAlert('location');
      if (simulatedCoords && active) {
        tickNavigation(simulatedCoords.lat, simulatedCoords.lng, headingDeg);
      }
      return;
    }

    if (!active) return;

    posSub = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        distanceInterval: GPS_REALTIME_DISTANCE_M,
        timeInterval: GPS_REALTIME_INTERVAL_MS,
      },
      (loc) => {
        if (!active || simulatedCoords) return;
        const speed = loc.coords.speed;
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
      headingSub = await Location.watchHeadingAsync((h) => {
        if (!active) return;
        const raw =
          typeof h.trueHeading === 'number' && h.trueHeading >= 0
            ? h.trueHeading
            : h.magHeading;
        if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
          headingDeg = headingFilter.push(raw);
          if (lastLat != null && lastLng != null) {
            const tick = computeTick(
              lastLat,
              lastLng,
              headingDeg,
              getSmoothedSpeedMs(),
            );
            if (tick) applyTick(tick);
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
            if (tick) applyTick(tick);
          }
        }
      });
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
  if (!active) return null;
  const store = useFinnusStore.getState();
  const mode = store.navMode ?? 'routing';
  const arrow = currentArrowTarget(mode);
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
    nextPointName: arrow.name,
    remainingM: store.navDistanceM ?? 0,
    legM: store.navLegDistanceM ?? 0,
    totalM: store.navTotalDistanceM ?? navTotalDistanceM,
    stops,
  };
}

export function isNavigatingToPoi(poiId: number): boolean {
  return active?.poiId === poiId;
}

function resetSensorState(): void {
  headingFilter.reset();
  positionFilter.reset();
  modeSticky = 'routing';
  headingDeg = 0;
  lastLat = null;
  lastLng = null;
  lastRemainingStations = null;
  navTotalDistanceM = null;
  resetMotionTransportState();
}

export async function startNavigation(poiId: number): Promise<boolean> {
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
    arrivalRadiusM: Math.max(
      ARRIVAL_FALLBACK_M,
      Math.min(dest.radius_meters || ARRIVAL_FALLBACK_M, 25),
    ),
    spotKey: dest.spot_key ?? poi.spot_key ?? null,
  });
}

export async function startNavigationToCoords(opts: {
  name: string;
  lat: number;
  lng: number;
  poiId?: number;
  arrivalRadiusM?: number;
  spotKey?: string | null;
}): Promise<boolean> {
  if (
    !Number.isFinite(opts.lat) ||
    !Number.isFinite(opts.lng) ||
    !opts.name.trim()
  ) {
    return false;
  }

  const spotKey = opts.spotKey ?? null;
  const waypoints: NavWaypoint[] = getNavWaypointsForSpot(spotKey);

  resetSensorState();

  active = {
    poiId: opts.poiId ?? -1,
    name: opts.name.trim(),
    lat: opts.lat,
    lng: opts.lng,
    arrivalRadiusM: opts.arrivalRadiusM ?? ARRIVAL_FALLBACK_M,
    waypoints,
  };
  waypointIndex = 0;
  turnHapticArmed = true;
  modeSticky = waypoints.length > 0 ? 'routing' : 'close_range';
  lastRemainingStations = null;
  navTotalDistanceM = null;

  useFinnusStore.getState().setPendingNavOffer(null);
  useFinnusStore.getState().setPendingNavAlternatives([]);
  void markNavigationUsed();
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

  if (!simulatedCoords && useFinnusStore.getState().isSimulationMode) {
    const offsetDeg = 80 / 111_320;
    setSimulatedNavCoords({
      lat: active.lat - offsetDeg,
      lng: active.lng,
    });
  }

  await ensureWatchers();

  if (!active) return false;

  let originLat = lastLat;
  let originLng = lastLng;

  if (simulatedCoords) {
    tickNavigation(simulatedCoords.lat, simulatedCoords.lng, headingDeg);
    originLat = simulatedCoords.lat;
    originLng = simulatedCoords.lng;
  } else {
    try {
      const cur = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
      });
      if (!active) return false;
      tickNavigation(
        cur.coords.latitude,
        cur.coords.longitude,
        headingDeg,
        typeof cur.coords.speed === 'number' ? cur.coords.speed : null,
      );
      originLat = cur.coords.latitude;
      originLng = cur.coords.longitude;
    } catch {
      // wait for watchers
    }
  }

  if (originLat != null && originLng != null && active) {
    let total = distanceMeters(originLat, originLng, active.lat, active.lng);
    if (active.waypoints.length > 0) {
      let prevLat = originLat;
      let prevLng = originLng;
      for (const wp of active.waypoints) {
        total += distanceMeters(prevLat, prevLng, wp.lat, wp.lng);
        prevLat = wp.lat;
        prevLng = wp.lng;
      }
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
      await new Promise((r) => setTimeout(r, 900));
      if (!useFinnusStore.getState().isPlayingAudio) {
        void speakNavOpeningIfNeeded(destName);
      } else {
        markNavOpeningSpoken();
      }
      const enriched = await enrichNavigationRoute({
        originLat: originLat!,
        originLng: originLng!,
        destLat,
        destLng,
        destinationName: destName,
      });
      if (!enriched?.length || !active) return;
      if (active.lat !== destLat || active.lng !== destLng) return;
      active.waypoints = enriched;
      if (isTransitMode(lastTransportMode)) {
        active.stations = enriched.map((w) => ({ ...w, isStation: true }));
      }
      waypointIndex = 0;
      modeSticky = 'routing';
      turnHapticArmed = true;
      pushStoreNav({ navMode: 'routing' });
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
}): Promise<void> {
  resetLandmarkNavCoach();
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
  });
  void opts?.silent;
}

export function onSpokenTextForAttention(_text: string | null): void {
  // Attention cues are scanned in useFinnusStore.setSubtitleText
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
