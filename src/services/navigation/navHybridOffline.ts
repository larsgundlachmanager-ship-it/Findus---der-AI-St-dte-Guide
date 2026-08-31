/**
 * Hybrid Offline-Nav (Hands-Free):
 * Online: OSRM + OSM landmarks (no Places)
 * Offline: cached route + prefetched WAVs
 */

import { getAllPois } from '../../db/database';
import {
  getVoiceSettingsForTour,
  speakNavWithMultitask,
} from '../ttsService';
import type { PedestrianTravelMode } from './googleMapsNav';
import { fetchOsmVisualLandmark } from './osmVisualLandmark';
import { distanceMeters } from './bearing';
import type { NavWaypoint } from './navigationTypes';
import { putCachedRoute } from './offlineNavCache';
import { isDeviceOffline } from './networkState';
import {
  HYBRID_SPEAK_PREFETCH_AHEAD,
  clearNavTurnPrefetch,
  countPreparedNavAudioSlots,
  hybridStatusPrefetchKey,
  turnPrefetchKey,
  warmNavTurnCue,
  playPrefetchedNavTurnIfReady,
  takeNavTurnCueText,
} from './navTurnPrefetch';
import { isTurnManeuver } from './navPredictiveCue';
import { turnWordFromManeuver } from './lookAheadBuffer';
import {
  buildLandmarkFirstCue,
  buildNavOfflineRerouteBlockedCue,
  buildNavOfflineStatusCue,
  buildTurnWithoutLandmark,
  scrubRoboticNavSpeak,
} from './spatialOrientation';

export const HYBRID_OFFLINE_ANNOUNCE_AFTER_MS = 20_000;
const CONNECTIVITY_POLL_MS = 2_500;
const REROUTE_OFFLINE_COOLDOWN_MS = 45_000;

type HybridSession = {
  destName: string;
  destLat: number;
  destLng: number;
  travelMode: PedestrianTravelMode | null;
  walkingDistanceM: number | null;
  hasTransit: boolean;
  offlineSinceMs: number | null;
  offlineStatusAnnounced: boolean;
  lastRerouteOfflineAtMs: number;
  prepareEpoch: number;
  applyWaypoints: (wps: NavWaypoint[]) => void;
  getWaypoints: () => NavWaypoint[];
  getStations: () => NavWaypoint[];
};

let session: HybridSession | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let prepareEpoch = 0;

function formatLandmarkName(name: string): string {
  const t = name.trim();
  if (!t) return t;
  return t.startsWith('der ') || t.startsWith('die ') || t.startsWith('das ')
    ? t
    : t;
}

/** Indices where Yorro should speak (turns, stations, pre-baked cues). */
export function listHybridSpeakPointIndices(
  waypoints: NavWaypoint[],
): number[] {
  const out: number[] = [];
  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    if (!wp) continue;
    if (
      isTurnManeuver(wp.maneuver) ||
      wp.isStation === true ||
      Boolean(wp.cue?.trim())
    ) {
      out.push(i);
    }
  }
  return out;
}

function buildCueForSpeakPoint(wp: NavWaypoint): string {
  const existing = wp.cue?.trim();
  if (existing && existing.length > 8) {
    return scrubRoboticNavSpeak(existing);
  }
  const turn = turnWordFromManeuver(wp.maneuver);
  const landmark =
    wp.visibleLandmark?.trim() || wp.landmark?.trim() || null;
  const roadName = wp.roadName?.trim() || null;
  if (landmark) {
    return buildLandmarkFirstCue({
      landmark,
      relation: {
        side: 'front',
        bearingRelDeg: 0,
        sidePhrase: 'voraus',
        shortPhrase: 'vor dir',
      },
      turn: turn !== 'geradeaus' ? turn : null,
      roadName,
    });
  }
  if (wp.isStation && wp.stationName?.trim()) {
    return scrubRoboticNavSpeak(
      `Als Nächstes ${wp.stationName.trim()} — ich sag Bescheid wenn's soweit ist.`,
    );
  }
  if (turn !== 'geradeaus') {
    return buildTurnWithoutLandmark(turn, roadName);
  }
  if (wp.instruction && wp.instruction.length > 8) {
    return scrubRoboticNavSpeak(wp.instruction);
  }
  return scrubRoboticNavSpeak('Weiter geradeaus — du bist richtig.');
}

async function resolveLandmarkNear(
  lat: number,
  lng: number,
): Promise<string | null> {
  try {
    const [localPois, osm] = await Promise.all([
      getAllPois().catch(() => []),
      fetchOsmVisualLandmark({ lat, lng, radiusM: 40 }).catch(() => null),
    ]);
    let bestLocal: string | null = null;
    let bestD = 55;
    for (const p of localPois) {
      if (!p.name?.trim() || p.kind === 'approach') continue;
      const d = distanceMeters(lat, lng, p.lat, p.lng);
      if (d < bestD) {
        bestD = d;
        bestLocal = p.name.replace(/\s*[·•|]\s*Wegweiser\s*$/i, '').trim();
      }
    }
    if (bestLocal) return formatLandmarkName(bestLocal);
    if (osm?.labelDe) return formatLandmarkName(osm.labelDe);
    return null;
  } catch {
    return null;
  }
}

async function enrichSpeakWindow(
  waypoints: NavWaypoint[],
  fromSpeakOrdinal: number,
  count: number,
): Promise<NavWaypoint[]> {
  const speakIdx = listHybridSpeakPointIndices(waypoints);
  const slice = speakIdx.slice(fromSpeakOrdinal, fromSpeakOrdinal + count);
  if (!slice.length) return waypoints;

  const next = waypoints.slice();
  await Promise.all(
    slice.map(async (idx) => {
      const wp = next[idx];
      if (!wp) return;
      let landmark =
        wp.visibleLandmark?.trim() || wp.landmark?.trim() || null;
      if (!landmark && !(await isDeviceOffline())) {
        landmark = await resolveLandmarkNear(wp.lat, wp.lng);
      }
      const withLand: NavWaypoint = landmark
        ? {
            ...wp,
            landmark,
            visibleLandmark: landmark,
          }
        : { ...wp };
      const cue = buildCueForSpeakPoint(withLand);
      next[idx] = { ...withLand, cue };
    }),
  );
  return next;
}

async function persistRouteSnapshot(
  waypoints: NavWaypoint[],
  stations: NavWaypoint[],
): Promise<void> {
  if (!session || waypoints.length < 2) return;
  await putCachedRoute({
    destName: session.destName,
    destLat: session.destLat,
    destLng: session.destLng,
    waypoints,
    stations,
    travelMode: session.travelMode,
    walkingDistanceM: session.walkingDistanceM,
  });
}

async function warmSpeakWindowAudio(
  waypoints: NavWaypoint[],
  fromSpeakOrdinal: number,
  count: number,
): Promise<void> {
  const speakIdx = listHybridSpeakPointIndices(waypoints);
  const slice = speakIdx.slice(fromSpeakOrdinal, fromSpeakOrdinal + count);
  await Promise.all(
    slice.map(async (idx) => {
      const wp = waypoints[idx];
      if (!wp) return;
      const text = buildCueForSpeakPoint(wp);
      if (!text) return;
      const key = turnPrefetchKey(idx, text);
      await warmNavTurnCue(key, text);
    }),
  );
}

async function warmSystemOfflineCues(): Promise<void> {
  if (!session) return;
  const status = buildNavOfflineStatusCue({
    hasTransit: session.hasTransit,
    preparedSpeakCount: Math.max(
      1,
      countPreparedNavAudioSlots() || HYBRID_SPEAK_PREFETCH_AHEAD,
    ),
  });
  const reroute = buildNavOfflineRerouteBlockedCue();
  await Promise.all([
    warmNavTurnCue(
      hybridStatusPrefetchKey('offline_status', status),
      status,
    ),
    warmNavTurnCue(
      hybridStatusPrefetchKey('offline_reroute', reroute),
      reroute,
    ),
  ]);
  // Keys change with variant text — also store stable aliases for announce
  sessionKeys.statusText = status;
  sessionKeys.rerouteText = reroute;
}

const sessionKeys: { statusText: string; rerouteText: string } = {
  statusText: '',
  rerouteText: '',
};

async function speakHybridCue(
  kind: 'offline_status' | 'offline_reroute',
  text: string,
): Promise<void> {
  const key = hybridStatusPrefetchKey(kind, text);
  const played = await playPrefetchedNavTurnIfReady(key);
  if (played) return;
  const cached = takeNavTurnCueText(key);
  try {
    const voice = await getVoiceSettingsForTour();
    await speakNavWithMultitask(cached ?? text, {
      voiceId: voice.voiceId,
      speechRate: voice.speechRate,
    });
  } catch (err) {
    console.warn('[nav-hybrid] speak failed', err);
  }
}

/**
 * Nach Enrich: Landmarken für die nächsten Speak-Points, Cache, Cartesia-WAVs.
 */
export async function bootstrapNavHybridSession(opts: {
  destName: string;
  destLat: number;
  destLng: number;
  travelMode?: PedestrianTravelMode | null;
  walkingDistanceM?: number | null;
  hasTransit: boolean;
  getWaypoints: () => NavWaypoint[];
  applyWaypoints: (wps: NavWaypoint[]) => void;
  getStations: () => NavWaypoint[];
}): Promise<void> {
  prepareEpoch += 1;
  const myEpoch = prepareEpoch;
  session = {
    destName: opts.destName.trim(),
    destLat: opts.destLat,
    destLng: opts.destLng,
    travelMode: opts.travelMode ?? null,
    walkingDistanceM: opts.walkingDistanceM ?? null,
    hasTransit: opts.hasTransit,
    offlineSinceMs: null,
    offlineStatusAnnounced: false,
    lastRerouteOfflineAtMs: 0,
    prepareEpoch: myEpoch,
    applyWaypoints: opts.applyWaypoints,
    getWaypoints: opts.getWaypoints,
    getStations: opts.getStations,
  };

  startNavHybridConnectivityWatch();

  try {
    let wps = opts.getWaypoints();
    if (wps.length < 2) return;
    if (!(await isDeviceOffline())) {
      wps = await enrichSpeakWindow(wps, 0, HYBRID_SPEAK_PREFETCH_AHEAD);
      if (!session || session.prepareEpoch !== myEpoch) return;
      opts.applyWaypoints(wps);
      await persistRouteSnapshot(wps, opts.getStations());
    } else {
      // Offline-Start: vorhandene Cues/Cache nutzen, trotzdem TTS soweit möglich skip
      await persistRouteSnapshot(wps, opts.getStations());
    }
    if (!session || session.prepareEpoch !== myEpoch) return;
    await warmSpeakWindowAudio(wps, 0, HYBRID_SPEAK_PREFETCH_AHEAD);
    await warmSystemOfflineCues();
    lastWindowOrdinal = 0;
  } catch (err) {
    console.warn('[nav-hybrid] bootstrap failed', err);
  }
}

let lastWindowOrdinal = -1;
let windowRefreshInFlight = false;

/**
 * Sliding window: ab aktuellem WP die nächsten 10 Speak-Points nachziehen.
 */
export function ensureHybridAudioWindow(
  waypointIndex: number,
  waypoints: NavWaypoint[],
): void {
  if (!session || waypoints.length < 2) return;
  const speakIdx = listHybridSpeakPointIndices(waypoints);
  if (!speakIdx.length) return;

  let ordinal = 0;
  for (let i = 0; i < speakIdx.length; i++) {
    if (speakIdx[i]! >= waypointIndex) {
      ordinal = i;
      break;
    }
    ordinal = i;
  }

  // Nur wenn sich das Fenster verschiebt oder noch kein Warm-Lauf lief
  if (ordinal === lastWindowOrdinal && countPreparedNavAudioSlots() > 0) {
    return;
  }
  if (windowRefreshInFlight) return;
  lastWindowOrdinal = ordinal;

  const myEpoch = session.prepareEpoch;
  windowRefreshInFlight = true;
  void (async () => {
    try {
      const offline = await isDeviceOffline();
      let wps = waypoints;
      if (!offline) {
        wps = await enrichSpeakWindow(
          waypoints,
          ordinal,
          HYBRID_SPEAK_PREFETCH_AHEAD,
        );
        if (!session || session.prepareEpoch !== myEpoch) return;
        let changed = false;
        for (let i = 0; i < wps.length; i++) {
          if (
            wps[i]?.cue !== waypoints[i]?.cue ||
            wps[i]?.landmark !== waypoints[i]?.landmark
          ) {
            changed = true;
            break;
          }
        }
        if (changed) {
          session.applyWaypoints(wps);
          await persistRouteSnapshot(wps, session.getStations());
        }
      }
      if (!session || session.prepareEpoch !== myEpoch) return;
      await warmSpeakWindowAudio(wps, ordinal, HYBRID_SPEAK_PREFETCH_AHEAD);
    } catch (err) {
      if (__DEV__) console.warn('[nav-hybrid] window refresh failed', err);
    } finally {
      windowRefreshInFlight = false;
    }
  })();
}

export function setNavHybridHasTransit(hasTransit: boolean): void {
  if (session) session.hasTransit = hasTransit;
}

export function startNavHybridConnectivityWatch(): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    void tickNavHybridConnectivity();
  }, CONNECTIVITY_POLL_MS);
  void tickNavHybridConnectivity();
}

export function stopNavHybridSession(): void {
  prepareEpoch += 1;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  session = null;
  sessionKeys.statusText = '';
  sessionKeys.rerouteText = '';
  lastWindowOrdinal = -1;
  windowRefreshInFlight = false;
}

async function tickNavHybridConnectivity(): Promise<void> {
  if (!session) return;
  const offline = await isDeviceOffline();
  const now = Date.now();
  if (!offline) {
    session.offlineSinceMs = null;
    session.offlineStatusAnnounced = false;
    return;
  }
  if (session.offlineSinceMs == null) {
    session.offlineSinceMs = now;
    return;
  }
  if (session.offlineStatusAnnounced) return;
  if (now - session.offlineSinceMs < HYBRID_OFFLINE_ANNOUNCE_AFTER_MS) {
    return;
  }
  session.offlineStatusAnnounced = true;
  const text =
    sessionKeys.statusText ||
    buildNavOfflineStatusCue({
      hasTransit: session.hasTransit,
      preparedSpeakCount: countPreparedNavAudioSlots(),
    });
  await speakHybridCue('offline_status', text);
}

/** Offline-Reroute blockiert — Ansage (mit Prefetch-Stimme wenn vorhanden). */
export async function announceNavHybridOfflineRerouteBlocked(): Promise<void> {
  if (!session) {
    const text = buildNavOfflineRerouteBlockedCue();
    try {
      const voice = await getVoiceSettingsForTour();
      await speakNavWithMultitask(text, {
        voiceId: voice.voiceId,
        speechRate: voice.speechRate,
      });
    } catch {
      /* ignore */
    }
    return;
  }
  const now = Date.now();
  if (now - session.lastRerouteOfflineAtMs < REROUTE_OFFLINE_COOLDOWN_MS) {
    return;
  }
  session.lastRerouteOfflineAtMs = now;
  const text =
    sessionKeys.rerouteText || buildNavOfflineRerouteBlockedCue();
  await speakHybridCue('offline_reroute', text);
}

/** @internal test/helpers */
export function __resetNavHybridForTests(): void {
  stopNavHybridSession();
  clearNavTurnPrefetch();
}
