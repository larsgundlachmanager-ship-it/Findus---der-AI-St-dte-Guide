/**
 * Deep Execution Tracking Buffer
 * - Rolling 10-minute window (aligns with telemetry_10min)
 * - Captures "what actually happened" across STT → LLM/UI → user clicks → nav → TTS cues
 *
 * Keine externen Watcher-Logs notwendig: Aufrufpunkte sind in den jeweiligen State-Managern
 * (useVoiceInput, AudioVoiceService, presentConcierge, useConciergeActions, navigationService).
 */

import type { QuickAction } from '../../types/concierge';
import type { NavWaypoint } from '../navigation/navigationTypes';
import type {
  FindusActionsTriggeredRound,
  NavExecutionTracking,
  NavWaypointLite,
  NavUserGpsFix,
  QuickActionLite,
} from '../../types/feedback';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_TEXT_LEN = 2_000;

const MAX_SPEECH_EVENTS = 30;
const MAX_ACTION_ROUNDS = 10;
const MAX_WAYPOINTS = 140;
const MAX_GPS_POINTS = 250;
const MAX_ERROR_STRINGS = 10;

type AtMs<T> = { atMs: number; value: T };

function trimText(value: string): string {
  const t = value.trim();
  if (t.length <= MAX_TEXT_LEN) return t;
  return `${t.slice(0, MAX_TEXT_LEN)}…`;
}

function pruneByWindow<T extends AtMs<unknown>>(arr: T[], nowMs: number): T[] {
  const cutoff = nowMs - WINDOW_MS;
  return arr.filter((e) => e.atMs >= cutoff);
}

function actionKey(a: QuickActionLite): string {
  const p = a.payload ?? {};
  const dest =
    typeof p.destLat === 'number' && typeof p.destLng === 'number'
      ? `${p.destLat.toFixed(5)}:${p.destLng.toFixed(5)}`
      : '';
  return [
    a.type,
    a.label,
    String(p.targetPoiId ?? ''),
    dest,
    p.url ?? '',
    p.textPrompt ?? '',
    p.phoneNumber ?? '',
    p.timeLabel ?? '',
    p.dateIso ?? '',
  ].join('|');
}

function toQuickActionLite(a: QuickAction): QuickActionLite {
  return {
    type: a.type,
    label: trimText(a.label),
    payload: {
      targetPoiId: a.payload.targetPoiId,
      phoneNumber: a.payload.phoneNumber,
      url: a.payload.url,
      textPrompt: a.payload.textPrompt,
      partySize: a.payload.partySize,
      timeLabel: a.payload.timeLabel,
      dateIso: a.payload.dateIso,
      gygTourSlug: a.payload.gygTourSlug,
      gygLocationId: a.payload.gygLocationId,
      destLat: a.payload.destLat,
      destLng: a.payload.destLng,
      destName: a.payload.destName,
      destination: a.payload.destination,
      skipClosingGate: a.payload.skipClosingGate,
      offlineOnly: a.payload.offlineOnly,
      autoFollowUp: a.payload.autoFollowUp,
      taskId: a.payload.taskId,
      placeId: a.payload.placeId,
    },
  };
}

function toNavWaypointLite(w: NavWaypoint): NavWaypointLite {
  return {
    lat: w.lat,
    lng: w.lng,
    maneuver: w.maneuver ?? null,
    roadName: w.roadName ?? null,
    landmark: w.landmark ?? null,
    cue: w.cue ?? null,
    instruction: w.instruction ?? null,
    isStation: w.isStation,
    stationName: w.stationName ?? null,
  };
}

let userSpeechExact: AtMs<string>[] = [];
let findusSpeechExact: AtMs<string>[] = [];
let actionRounds: FindusActionsTriggeredRound[] = [];

let nav: NavExecutionTracking | null = null;

function pruneAll(nowMs = Date.now()): void {
  userSpeechExact = pruneByWindow(userSpeechExact, nowMs).slice(-MAX_SPEECH_EVENTS);
  findusSpeechExact = pruneByWindow(findusSpeechExact, nowMs).slice(-MAX_SPEECH_EVENTS);
  actionRounds = actionRounds
    .filter((r) => r.atMs >= nowMs - WINDOW_MS)
    .slice(-MAX_ACTION_ROUNDS);

  if (nav) {
    nav.nav_user_gps_track = nav.nav_user_gps_track
      .filter((p) => p.atMs >= nowMs - WINDOW_MS)
      .slice(-MAX_GPS_POINTS);
    nav.nav_audio_cues_errors = nav.nav_audio_cues_errors.slice(0, MAX_ERROR_STRINGS);

    const navAge = nowMs - nav.nav_active_atMs;
    if (navAge > WINDOW_MS && nav.nav_user_gps_track.length === 0) {
      nav = null;
    }
  }
}

export function recordUserSpeechExact(text: string, atMs = Date.now()): void {
  const t = text.trim();
  if (!t) return;
  userSpeechExact.push({ atMs, value: trimText(t) });
  pruneAll(atMs);
}

export function recordFindusSpeechExact(text: string, _atMs = Date.now()): void {
  const t = text.trim();
  if (!t) return;
  findusSpeechExact.push({ atMs: _atMs, value: trimText(t) });
  pruneAll(_atMs);
}

export function recordFindusActionsTriggered(
  generatedActions: QuickAction[],
  atMs = Date.now(),
): void {
  const generated = generatedActions.map(toQuickActionLite).slice(0, 10);
  if (generated.length === 0) return;
  actionRounds.push({
    atMs,
    generated,
    clicked: [],
  });
  pruneAll(atMs);
}

export function recordFindusActionClicked(
  clickedAction: QuickAction,
  atMs = Date.now(),
): void {
  const lite = toQuickActionLite(clickedAction);
  const key = actionKey(lite);

  const nowMs = atMs;
  pruneAll(nowMs);

  // Prefer the newest round that still has the generated action.
  const bestRound = [...actionRounds]
    .reverse()
    .find((r) => r.generated.some((g) => actionKey(g) === key));

  const attachTo = bestRound ?? null;

  if (attachTo) {
    if (!attachTo.clicked.some((c) => actionKey(c) === key)) {
      attachTo.clicked.push(lite);
      // Ensure deterministic ordering
      attachTo.clicked.sort((a, b) => actionKey(a).localeCompare(actionKey(b)));
    }
    return;
  }

  // Race condition fallback (no generation captured): keep clicked info anyway.
  actionRounds.push({
    atMs,
    generated: [],
    clicked: [lite],
  });
  pruneAll(atMs);
}

export function navTrackingStart(
  target: { lat: number; lng: number },
  waypoints: NavWaypoint[],
  atMs = Date.now(),
): void {
  nav = {
    nav_active_atMs: atMs,
    nav_target_coordinates: target,
    nav_waypoints_generated: waypoints.slice(0, MAX_WAYPOINTS).map(toNavWaypointLite),
    nav_user_gps_track: [],
    nav_audio_cues_success: false,
    nav_audio_cues_success_count: 0,
    nav_audio_cues_failed_count: 0,
    nav_audio_cues_errors: [],
  };
  pruneAll(atMs);
}

export function navTrackingUpdateWaypoints(waypoints: NavWaypoint[]): void {
  if (!nav) return;
  nav.nav_waypoints_generated = waypoints.slice(0, MAX_WAYPOINTS).map(toNavWaypointLite);
  pruneAll();
}

export function navTrackingPushGpsFix(lat: number, lng: number, atMs = Date.now()): void {
  if (!nav) return;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  const point: NavUserGpsFix = { lat, lng, atMs };
  nav.nav_user_gps_track.push(point);
  if (nav.nav_user_gps_track.length > MAX_GPS_POINTS) {
    nav.nav_user_gps_track = nav.nav_user_gps_track.slice(-MAX_GPS_POINTS);
  }
  pruneAll(atMs);
}

export function navTrackingAudioCueResult(opts: {
  ok: boolean;
  errorHint?: string;
  atMs?: number;
}): void {
  if (!nav) return;
  const atMs = opts.atMs ?? Date.now();

  if (opts.ok) {
    nav.nav_audio_cues_success = true;
    nav.nav_audio_cues_success_count += 1;
  } else {
    nav.nav_audio_cues_failed_count += 1;
    if (opts.errorHint?.trim()) {
      nav.nav_audio_cues_errors.push(trimText(opts.errorHint));
      nav.nav_audio_cues_errors = nav.nav_audio_cues_errors.slice(0, MAX_ERROR_STRINGS);
    }
  }

  pruneAll(atMs);
}

export function navTrackingStop(_atMs = Date.now()): void {
  // no explicit stop field in schema; we keep the object for WINDOW_MS.
  pruneAll(_atMs);
}

export function clearExecutionTracking(): void {
  userSpeechExact = [];
  findusSpeechExact = [];
  actionRounds = [];
  nav = null;
}

export function snapshotExecutionTracking(): {
  user_speech_exact: string[];
  findus_speech_exact: string[];
  findus_actions_triggered: FindusActionsTriggeredRound[];
  nav_execution_tracking: NavExecutionTracking | null;
} {
  const nowMs = Date.now();
  pruneAll(nowMs);

  return {
    user_speech_exact: userSpeechExact.map((e) => e.value),
    findus_speech_exact: findusSpeechExact.map((e) => e.value),
    findus_actions_triggered: actionRounds,
    nav_execution_tracking: nav,
  };
}

