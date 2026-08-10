/**
 * Modul-Priorität & Cooldowns nach User-Frage (Modul 2).
 * Mic → nur Modul 2 · danach: Modul 3 sofort · Modul 4 nach 30s · Modul 1 nach 30s.
 * Nach M1/Nav: 10s Stille · nach Planung: 60s.
 */

import { useFinnusStore } from '../../store/useFinnusStore';

/** Sekunden nach Modul-2-Ende bis Modul 4 sprechen darf. */
export const MODULE4_AFTER_M2_MS = 30_000;
/** Sekunden nach Modul-2-Ende bis Modul 1 (Explore) wieder darf. */
export const MODULE1_AFTER_M2_MS = 30_000;
/** Nach Planungs-Session bis Modul 1. */
export const MODULE1_AFTER_PLANNING_MS = 60_000;
/** Nach eigenem Modul-1- oder Nav-Sprechen: Mindeststille (≥30 s zu anderem M1). */
export const MODULE1_AFTER_OWN_SPEECH_MS = 30_000;
/** Mindestabstand zwischen zwei Wegweisern. */
export const WEGWEISER_GAP_MS = 45_000;
/** Nach Wegweiser → zugehöriger Hauptpunkt darf schneller folgen. */
export const WEGWEISER_TO_MAIN_MS = 5_000;
/** Wegweiser → anderer Hauptpunkt. */
export const WEGWEISER_TO_OTHER_MAIN_MS = 20_000;
/** Erinnerung: Approach gehört → 10 Min für Skip-Intro am Hauptpunkt. */
export const APPROACH_MEMORY_MS = 10 * 60_000;
/** Bundling: Wegweiser innerhalb dieses Radius gemeinsam erzählen. */
export const WEGWEISER_BUNDLE_M = 50;

/** Nav-Knoten Mute für Modul 1: zu Fuß. */
export const MODULE1_NAV_MUTE_FOOT_M = 30;
/** Nav-Knoten Mute für Modul 1: Fahrrad. */
export const MODULE1_NAV_MUTE_BIKE_M = 70;

let module2SpeechEndedAtMs: number | null = null;
let planningEndedAtMs: number | null = null;
let lastOwnSpeechAtMs: number | null = null;
let lastWegweiserAtMs: number | null = null;
let lastWegweiserSpotKey: string | null = null;
let lastMainAtMs: number | null = null;
/** Letztes Modul-1-Event (Approach oder Main) — Neutral-3min-Gate. */
let lastModule1EventAtMs: number | null = null;

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

/** Modul 2 aktiv (hört / generiert). */
export function isModule2Busy(): boolean {
  const store = useFinnusStore.getState();
  return store.isListening || store.isGenerating;
}

export type SpeakGate = { ok: boolean; reason?: string; remainingMs?: number };

function remaining(untilMs: number, nowMs: number): number {
  return Math.max(0, untilMs - nowMs);
}

export function canModule4Speak(nowMs = Date.now()): SpeakGate {
  if (isModule2Busy()) return { ok: false, reason: 'module2_busy' };
  const store = useFinnusStore.getState();
  if (store.isPlayingAudio) return { ok: false, reason: 'speaking' };
  if (module2SpeechEndedAtMs != null) {
    const elapsed = nowMs - module2SpeechEndedAtMs;
    if (elapsed < MODULE4_AFTER_M2_MS) {
      return {
        ok: false,
        reason: 'cooldown_30s_after_m2',
        remainingMs: MODULE4_AFTER_M2_MS - elapsed,
      };
    }
  }
  return { ok: true };
}

export function canModule1Speak(nowMs = Date.now()): SpeakGate {
  if (isModule2Busy()) return { ok: false, reason: 'module2_busy' };

  if (lastOwnSpeechAtMs != null) {
    const elapsed = nowMs - lastOwnSpeechAtMs;
    if (elapsed < MODULE1_AFTER_OWN_SPEECH_MS) {
      return {
        ok: false,
        reason: 'silence_30s_after_own',
        remainingMs: MODULE1_AFTER_OWN_SPEECH_MS - elapsed,
      };
    }
  }

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
 * - nach Haupt ≥ 30 s
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

  // Gleicher Spot: Wegweiser → Haupt nur 5 s — nicht die 30 s Own-Speech-Silence
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
    if (lastMainAtMs != null && nowMs - lastMainAtMs < MODULE1_AFTER_M2_MS) {
      return {
        ok: false,
        reason: 'after_main_30s',
        remainingMs: remaining(lastMainAtMs + MODULE1_AFTER_M2_MS, nowMs),
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
 * Modul 3: während M2 zuhört → Pause.
 * Während M2 nachdenkt (generating) darf M3 kurz Ansagen.
 * Während M2 spricht → M3 queue.
 */
export function canModule3Announce(): {
  ok: boolean;
  reason?: string;
} {
  const store = useFinnusStore.getState();
  if (store.isListening) return { ok: false, reason: 'listening' };
  if (store.isPlayingAudio && store.isGenerating) {
    return { ok: false, reason: 'module2_speaking' };
  }
  return { ok: true };
}
