/**
 * Modul-Priorität & Cooldowns nach User-Frage (Modul 2).
 * Mic → nur Modul 2 · danach: Modul 1/4 nach 60s.
 * Nach M1/Nav: 15s Stille für Fremd-Module · nach Busy: 10s.
 * Gleicher Ort Wegweiser→Haupt: 5s · zwei verschiedene Orte: 10s.
 */

import { useFinnusStore } from '../../store/useFinnusStore';

/** Nach Modul-2-Ende bis Modul 4 (Wetter etc.) sprechen darf. */
export const MODULE4_AFTER_M2_MS = 60_000;
/** Nach Modul-2-Ende bis Modul 1 (Explore) wieder darf. */
export const MODULE1_AFTER_M2_MS = 60_000;
/** Nach Planungs-Session bis Modul 1 — gleich wie nach M2. */
export const MODULE1_AFTER_PLANNING_MS = 60_000;
/** Nach Modul-1- oder Nav-Sprechen: Fremd-Module (Regen, Presence) warten. */
export const MODULE1_AFTER_OWN_SPEECH_MS = 15_000;
/** Nach Busy (reden/denken) mindestens so lange Stille. */
export const BUSY_AFTER_MS = 10_000;
/** Zwei verschiedene M1-Orte hintereinander. */
export const MODULE1_BETWEEN_PLACES_MS = 10_000;
/** Mindestabstand zwischen zwei Wegweisern. */
export const WEGWEISER_GAP_MS = 45_000;
/** Nach Wegweiser → zugehöriger Hauptpunkt darf schneller folgen. */
export const WEGWEISER_TO_MAIN_MS = 5_000;
/** Wegweiser → anderer Hauptpunkt. */
export const WEGWEISER_TO_OTHER_MAIN_MS = 10_000;
/** Erinnerung: Approach gehört → 10 Min für Skip-Intro am Hauptpunkt. */
export const APPROACH_MEMORY_MS = 10 * 60_000;
/** Bundling: Wegweiser innerhalb dieses Radius gemeinsam erzählen. */
export const WEGWEISER_BUNDLE_M = 50;

/** Nav-Knoten Mute für Modul 1: zu Fuß — nur enges Abbiege-Fenster. */
export const MODULE1_NAV_MUTE_FOOT_M = 14;
/** Nav-Knoten Mute für Modul 1: Fahrrad. */
export const MODULE1_NAV_MUTE_BIKE_M = 35;

let module2SpeechEndedAtMs: number | null = null;
let planningEndedAtMs: number | null = null;
let lastOwnSpeechAtMs: number | null = null;
let lastWegweiserAtMs: number | null = null;
let lastWegweiserSpotKey: string | null = null;
let lastMainAtMs: number | null = null;
/** Letztes Modul-1-Event (Approach oder Main) — Neutral-3min-Gate. */
let lastModule1EventAtMs: number | null = null;
let lastBusyEndedAtMs: number | null = null;
let wasBusy = false;

/** Neutral-3min Event-Clock (ohne 30s Speech-Silence). */
export function noteModule1Event(atMs = Date.now()): void {
  lastModule1EventAtMs = atMs;
}

export function getLastModule1EventAtMs(): number | null {
  return lastModule1EventAtMs;
}

export function noteModule2SpeechEnded(atMs = Date.now()): void {
  module2SpeechEndedAtMs = atMs;
}

export function notePlanningSessionEnded(atMs = Date.now()): void {
  planningEndedAtMs = atMs;
  mutePlanOpenPointNudges(30 * 60_000, atMs);
}

/** Nach Timeline schließen: keine „noch offene Punkte“-Nachfragen. */
const PLAN_NUDGE_MUTE_DEFAULT_MS = 30 * 60_000;
let planOpenPointNudgeMutedUntilMs = 0;

export function mutePlanOpenPointNudges(
  forMs = PLAN_NUDGE_MUTE_DEFAULT_MS,
  atMs = Date.now(),
): void {
  planOpenPointNudgeMutedUntilMs = Math.max(
    planOpenPointNudgeMutedUntilMs,
    atMs + forMs,
  );
}

export function isPlanOpenPointNudgeMuted(nowMs = Date.now()): boolean {
  return nowMs < planOpenPointNudgeMutedUntilMs;
}

/** Nach Modul-1- oder Nav-Audio. */
export function noteFindusOwnSpeechEnded(atMs = Date.now()): void {
  lastOwnSpeechAtMs = atMs;
}

export function getModule2SpeechEndedAtMs(): number | null {
  return module2SpeechEndedAtMs;
}

export function noteWegweiserSpoken(
  spotKey?: string | null,
  atMs = Date.now(),
): void {
  lastWegweiserAtMs = atMs;
  lastWegweiserSpotKey = spotKey?.trim() || null;
  // Neutral-Clock ja — aber KEINE 30s Own-Speech (sonst blockiert 5s→Haupt)
  lastModule1EventAtMs = atMs;
}

export function noteMainPoiSpoken(atMs = Date.now()): void {
  lastMainAtMs = atMs;
  lastModule1EventAtMs = atMs;
  lastOwnSpeechAtMs = atMs;
}

export function getLastWegweiserAtMs(): number | null {
  return lastWegweiserAtMs;
}

/** Redet oder denkt — nie dazwischenquatschen. */
export function isFindusBusy(): boolean {
  const store = useFinnusStore.getState();
  return (
    store.isListening ||
    store.isGenerating ||
    store.isPlayingAudio ||
    store.isAudiblySpeaking
  );
}

function noteBusyTransition(nowMs: number): void {
  const busy = isFindusBusy();
  if (busy) {
    wasBusy = true;
    return;
  }
  if (wasBusy) {
    lastBusyEndedAtMs = nowMs;
    wasBusy = false;
  }
}

function isTimelineBlockingProactive(): boolean {
  try {
    const { usePlanCalendarUiStore } = require('../../module2/timeline/planCalendarUiStore') as {
      usePlanCalendarUiStore: { getState: () => { calendarVisible: boolean } };
    };
    if (usePlanCalendarUiStore.getState().calendarVisible) return true;
  } catch {
    /* soft */
  }
  try {
    const { isPlanningModuleActive } = require('../../module2/planning/planSessionState') as {
      isPlanningModuleActive: () => boolean;
    };
    if (isPlanningModuleActive()) return true;
  } catch {
    /* soft */
  }
  return false;
}

/** Ungefragt (Regen, Presence, Welcome, Akku): Busy, Timeline, Pausen. */
export function canSpeakUnsolicited(nowMs = Date.now()): SpeakGate {
  noteBusyTransition(nowMs);
  if (isFindusBusy()) return { ok: false, reason: 'busy' };
  if (isTimelineBlockingProactive()) return { ok: false, reason: 'timeline' };
  if (lastBusyEndedAtMs != null && nowMs - lastBusyEndedAtMs < BUSY_AFTER_MS) {
    return {
      ok: false,
      reason: 'silence_after_busy',
      remainingMs: BUSY_AFTER_MS - (nowMs - lastBusyEndedAtMs),
    };
  }
  return canModule4Speak(nowMs);
}

/** Modul 2 aktiv (hört / generiert). */
export function isModule2Busy(): boolean {
  return isFindusBusy();
}

export type SpeakGate = { ok: boolean; reason?: string; remainingMs?: number };

function remaining(untilMs: number, nowMs: number): number {
  return Math.max(0, untilMs - nowMs);
}

export function canModule4Speak(nowMs = Date.now()): SpeakGate {
  if (isModule2Busy()) return { ok: false, reason: 'module2_busy' };
  if (isTimelineBlockingProactive()) return { ok: false, reason: 'timeline' };
  if (lastOwnSpeechAtMs != null) {
    const elapsed = nowMs - lastOwnSpeechAtMs;
    if (elapsed < MODULE1_AFTER_OWN_SPEECH_MS) {
      return {
        ok: false,
        reason: 'silence_after_m1_nav',
        remainingMs: MODULE1_AFTER_OWN_SPEECH_MS - elapsed,
      };
    }
  }
  if (module2SpeechEndedAtMs != null) {
    const elapsed = nowMs - module2SpeechEndedAtMs;
    if (elapsed < MODULE4_AFTER_M2_MS) {
      return {
        ok: false,
        reason: 'cooldown_60s_after_m2',
        remainingMs: MODULE4_AFTER_M2_MS - elapsed,
      };
    }
  }
  return { ok: true };
}

export function canModule1Speak(nowMs = Date.now()): SpeakGate {
  if (isModule2Busy()) return { ok: false, reason: 'module2_busy' };
  if (isTimelineBlockingProactive()) return { ok: false, reason: 'timeline' };

  if (module2SpeechEndedAtMs != null) {
    const elapsed = nowMs - module2SpeechEndedAtMs;
    if (elapsed < MODULE1_AFTER_M2_MS) {
      return {
        ok: false,
        reason: 'cooldown_60s_after_m2',
        remainingMs: MODULE1_AFTER_M2_MS - elapsed,
      };
    }
  }

  if (planningEndedAtMs != null) {
    const elapsed = nowMs - planningEndedAtMs;
    if (elapsed < MODULE1_AFTER_PLANNING_MS) {
      return {
        ok: false,
        reason: 'cooldown_60s_after_planning',
        remainingMs: MODULE1_AFTER_PLANNING_MS - elapsed,
      };
    }
  }

  return { ok: true };
}

/**
 * Feingranulare Modul-1-Pausen:
 * - zwei Wegweiser ≥ 45 s
 * - Wegweiser → zugehöriger Haupt ≥ 5 s
 * - Wegweiser → anderer Haupt ≥ 20 s
 * - nach Haupt ≥ 10 s
 */
export function canSpeakExploreEvent(
  kind: 'approach' | 'main' | 'other',
  opts?: { spotKey?: string | null; relatedToLastWegweiser?: boolean },
  nowMs = Date.now(),
): SpeakGate {
  const related =
    opts?.relatedToLastWegweiser === true ||
    (!!opts?.spotKey &&
      !!lastWegweiserSpotKey &&
      opts.spotKey === lastWegweiserSpotKey);

  // Gleicher Spot: Wegweiser → Haupt nur 5 s — nicht die Own-Speech-Silence
  if (kind === 'main' && related && lastWegweiserAtMs != null) {
    if (isModule2Busy()) return { ok: false, reason: 'module2_busy' };
    if (module2SpeechEndedAtMs != null) {
      const elapsed = nowMs - module2SpeechEndedAtMs;
      if (elapsed < MODULE1_AFTER_M2_MS) {
        return {
          ok: false,
          reason: 'cooldown_30s_after_m2',
          remainingMs: MODULE1_AFTER_M2_MS - elapsed,
        };
      }
    }
    const sinceW = nowMs - lastWegweiserAtMs;
    if (sinceW < WEGWEISER_TO_MAIN_MS) {
      return {
        ok: false,
        reason: 'wegweiser_to_main_5s',
        remainingMs: WEGWEISER_TO_MAIN_MS - sinceW,
      };
    }
    return { ok: true };
  }

  const base = canModule1Speak(nowMs);
  if (!base.ok) return base;

  if (kind === 'approach') {
    if (
      lastWegweiserAtMs != null &&
      nowMs - lastWegweiserAtMs < WEGWEISER_GAP_MS
    ) {
      return {
        ok: false,
        reason: 'wegweiser_gap_45s',
        remainingMs: remaining(lastWegweiserAtMs + WEGWEISER_GAP_MS, nowMs),
      };
    }
    if (lastMainAtMs != null && nowMs - lastMainAtMs < MODULE1_BETWEEN_PLACES_MS) {
      return {
        ok: false,
        reason: 'after_main',
        remainingMs: remaining(lastMainAtMs + MODULE1_BETWEEN_PLACES_MS, nowMs),
      };
    }
    return { ok: true };
  }

  if (lastWegweiserAtMs != null) {
    const sinceW = nowMs - lastWegweiserAtMs;
    if (sinceW < WEGWEISER_TO_OTHER_MAIN_MS) {
      return {
        ok: false,
        reason: 'wegweiser_to_other_20s',
        remainingMs: WEGWEISER_TO_OTHER_MAIN_MS - sinceW,
      };
    }
  }

  return { ok: true };
}

/** Mute-Radius für Modul-1 nahe Nav-Abbiege-Knoten. */
export function module1NavMuteRadiusM(): number {
  const mode = useFinnusStore.getState().transportMode;
  if (mode === 'bicycle') return MODULE1_NAV_MUTE_BIKE_M;
  if (mode === 'transit_bus' || mode === 'transit_train') {
    return MODULE1_NAV_MUTE_BIKE_M;
  }
  return MODULE1_NAV_MUTE_FOOT_M;
}

/**
 * Modul 3: während M2 zuhört oder nachdenkt → Pause.
 * Während M2 spricht → M3 queue.
 */
export function canModule3Announce(): {
  ok: boolean;
  reason?: string;
} {
  const store = useFinnusStore.getState();
  if (store.isListening) return { ok: false, reason: 'listening' };
  if (store.isGenerating) return { ok: false, reason: 'thinking' };
  if (store.isPlayingAudio || store.isAudiblySpeaking) {
    return { ok: false, reason: 'module2_speaking' };
  }
  return { ok: true };
}
