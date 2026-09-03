/**
 * Call-1 Dispatch — einzige Weiche nach dem Manager-JSON.
 * Kein userText-Keyword-Routing; nur Call-1-Felder (execution, frame.work, lane, route).
 */

import type { ManagerAnalysis } from './types';
import { frameHasWorker, frameOwnsDayPlan } from './turnFrame';

export type Call1ExecutionBackend =
  | 'chat_lane'
  | 'pitch_module'
  | 'flight_advisor'
  | 'plan_module'
  | 'plan_walkthrough'
  | 'tour_module'
  | 'events_research'
  | 'nav_execute'
  | 'm1_poi'
  | 'memory'
  | 'task_fanout'
  | 'reisebuero';

const EXECUTION_VALUES: Call1ExecutionBackend[] = [
  'chat_lane',
  'pitch_module',
  'flight_advisor',
  'plan_module',
  'plan_walkthrough',
  'tour_module',
  'events_research',
  'nav_execute',
  'm1_poi',
  'memory',
  'task_fanout',
  'reisebuero',
];

export function asCall1Execution(
  raw: unknown,
): Call1ExecutionBackend | null {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  return EXECUTION_VALUES.includes(s as Call1ExecutionBackend)
    ? (s as Call1ExecutionBackend)
    : null;
}

/** Ableitung nur aus Call-1-Output — nie aus userText. */
export function deriveCall1Execution(
  analysis: ManagerAnalysis,
): Call1ExecutionBackend {
  const frame = analysis.frame;
  const lane = String(analysis.chatLane || 'chat');
  const route = analysis.route;
  const handoff = String(analysis.handoff || '').toLowerCase();

  if (handoff === 'reisebuero') return 'reisebuero';
  if (frameHasWorker(frame, 'flight') || analysis.jobHint === 'flight_trip') {
    return 'flight_advisor';
  }
  if (lane === 'nav' || frameHasWorker(frame, 'nav') || route === 'm3_nav_start') {
    return 'nav_execute';
  }
  if (lane === 'm1' || frameHasWorker(frame, 'm1') || route === 'm1_poi') {
    return 'm1_poi';
  }
  if (
    analysis.execution === 'plan_walkthrough' ||
    (frameOwnsDayPlan(frame) && analysis.session === 'continue')
  ) {
    return 'plan_walkthrough';
  }
  if (lane === 'plan' || frameOwnsDayPlan(frame) || route === 'm5_plan') {
    return 'plan_module';
  }
  if (
    lane === 'pitch' ||
    frameHasWorker(frame, 'pitch') ||
    frameHasWorker(frame, 'hotel') ||
    frameHasWorker(frame, 'dining')
  ) {
    return 'pitch_module';
  }
  if (frameHasWorker(frame, 'weather') && lane === 'chat' && !analysis.blueprintId) {
    return 'chat_lane';
  }
  if (route === 'memory') return 'memory';
  if (lane === 'chat' || route === 'blueprint' || route === 'smalltalk') {
    return 'chat_lane';
  }
  if (analysis.tasks?.length) return 'task_fanout';
  return 'chat_lane';
}

/** Finale Ausführung: explizites execution-Feld gewinnt, sonst derive. */
export function resolveCall1Execution(
  analysis: ManagerAnalysis,
): Call1ExecutionBackend {
  const explicit = asCall1Execution(analysis.execution);
  if (explicit) return explicit;
  return deriveCall1Execution(analysis);
}

/**
 * Hotel/Unterkunft mit Amenities/Budget/Daten, aber ohne Zielstadt/Flug/Urlaubsreise
 * → lokal pitchen (Stay22), nicht Reisebüro-Funnel „von wo?“.
 */
export function isLocalHotelAmenityQuery(userText: string): boolean {
  const t = (userText || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  const stay =
    /\b(hotel|hotels|unterkunft|übernacht|uebernacht|hostel|pension|airbnb|ferienwohnung)\b/iu.test(
      t,
    );
  if (!stay) return false;
  // Echte Reise mit Ziel / Flug / Mietwagen → Reisebüro
  if (
    /\b(flug|fliegen|flieger|mietwagen|reisebüro|reisebuero|urlaub|kurztrip|städtetrip|staedtetrip)\b/iu.test(
      t,
    )
  ) {
    return false;
  }
  if (
    /\b(nach|in)\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-']{2,}(?:\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-']{2,}){0,2}\b/u.test(
      t,
    ) &&
    !/\b(in\s+der\s+nähe|in\s+der\s+naehe|hier|vor\s+ort)\b/iu.test(t)
  ) {
    return false;
  }
  if (/\b(irgendwo|inspiration|wo\s+hin)\b/iu.test(t)) return false;
  // Amenities / Budget / Daten → Stay-Pitch lokal
  return (
    /\b(pool|sauna|spa|massage|terrasse|balkon|meerblick|seeblick|frühstück|fruehstueck|all.?inclusive|wellness)\b/iu.test(
      t,
    ) ||
    /\b(\d+)\s*(€|euro)\b/iu.test(t) ||
    /\b(unter|bis|max\.?)\s*\d+/iu.test(t) ||
    /\b(freitag|samstag|sonntag|montag|dienstag|mittwoch|donnerstag|wochenende|heute|morgen)\b/iu.test(
      t,
    ) ||
    /\b(nacht|nächte|naechte|übernachtung|uebernachtung)\b/iu.test(t)
  );
}

/**
 * Session-aware Ausführung nach Call 1 — kein Keyword-Router, aber offener Flug-Thread
 * darf nicht von chat_lane/weather/inventory wegstehlen (z. B. nacktes „um 20 Uhr“).
 * Call-1-Felder + persistierte Flug-Session; hydrateFlightTripSession vorher aufrufen.
 */
export function finalizeCall1Execution(
  analysis: ManagerAnalysis,
  userText: string,
): Call1ExecutionBackend {
  // Explizite Nav („navigiere mich …“) schlägt Pitch/M1/Pack-Story — Just-Do-It.
  try {
    const { isExplicitNavIntent } = require('../../services/intent/poiInfoVsNav') as {
      isExplicitNavIntent: (s: string) => boolean;
    };
    if (isExplicitNavIntent(userText)) {
      return 'nav_execute';
    }
  } catch {
    /* soft */
  }
  // Lokal Hotel-Amenity schlägt LLM-/Situation-Reisebüro (kein „von wo?“).
  if (isLocalHotelAmenityQuery(userText)) {
    return 'pitch_module';
  }
  // Genanntes Produkt im Angebot / Prospekt → immer Knowledge/chat_lane.
  // Nie Reisebüro, nie Pitch/Dining (auch nicht bei „irgendwo“ / sticky Flug).
  try {
    const { isSupermarketOfferQuery } = require('../../services/research/supermarketProspectGates') as {
      isSupermarketOfferQuery: (s: string) => boolean;
    };
    if (isSupermarketOfferQuery(userText)) {
      return 'chat_lane';
    }
  } catch {
    /* soft */
  }
  try {
    const { detectCall1Situation } = require('../reboot/pipeline/call1AnswerContract') as {
      detectCall1Situation: (
        t: string,
        o?: { correction?: boolean },
      ) => string;
    };
    const family = detectCall1Situation(userText);
    if (family === 'reisebuero_collect') {
      return 'reisebuero';
    }
    if (family === 'stay_day_interactive') {
      const resolved = resolveCall1Execution(analysis);
      if (resolved === 'reisebuero' || resolved === 'chat_lane') {
        return 'plan_walkthrough';
      }
      return resolved;
    }
  } catch {
    /* soft */
  }
  // Genannter Termin (Team/Act/Halle): events_research — Call-1 soll das setzen;
  // Soft-Backup nur als Struktur-Weiche, keine Team-Liste.
  try {
    const { looksLikeNamedScheduleQuery } = require('../../services/concierge/sportsScheduleQuery') as {
      looksLikeNamedScheduleQuery: (s: string) => boolean;
    };
    if (looksLikeNamedScheduleQuery(userText)) {
      return 'events_research';
    }
  } catch {
    /* soft */
  }
  try {
    const { shouldEnterFlightAdvisor } = require('../../services/flights/flightTripIntent') as {
      shouldEnterFlightAdvisor: (o: {
        userText: string;
        chatLane?: string | null;
        session?: string | null;
        jobHint?: string | null;
        intentSummary?: string | null;
        hasOpenSession?: boolean;
        flightWorker?: boolean;
      }) => boolean;
    };
    const { hasFlightTripSession } = require('../../services/flights/flightTripSession') as {
      hasFlightTripSession: () => boolean;
    };
    const flightWorker =
      frameHasWorker(analysis.frame, 'flight') || analysis.jobHint === 'flight_trip';
    if (
      shouldEnterFlightAdvisor({
        userText,
        chatLane: analysis.chatLane,
        session: analysis.session,
        jobHint: analysis.jobHint,
        intentSummary: analysis.intentSummary,
        hasOpenSession: hasFlightTripSession(),
        flightWorker,
      })
    ) {
      return 'flight_advisor';
    }
  } catch {
    /* soft */
  }
  // Wetter-Opener (ohne Deixis auf Ort): immer chat_lane — nie Pitch/Nav/Pack-Sticky.
  try {
    const {
      looksLikeOutfitOrWeatherUtterance,
      weatherAskWantsConversationPlace,
    } = require('../planning/planUtteranceGate') as {
      looksLikeOutfitOrWeatherUtterance: (s: string) => boolean;
      weatherAskWantsConversationPlace: (s: string) => boolean;
    };
    const { looksLikePicnicQuery } = require('../pitch/picnicIntent') as {
      looksLikePicnicQuery: (s: string) => boolean;
    };
    if (
      looksLikeOutfitOrWeatherUtterance(userText) &&
      !weatherAskWantsConversationPlace(userText) &&
      !looksLikePicnicQuery(userText)
    ) {
      return 'chat_lane';
    }
  } catch {
    /* soft */
  }
  return resolveCall1Execution(analysis);
}

export function shouldSpeakManagerBridge(analysis: ManagerAnalysis): boolean {
  if (analysis.bridgeSpokenEarly) return false;
  if (!analysis.bridge?.trim()) return false;
  if (analysis.session === 'continue' || analysis.session === 'resume') {
    return false;
  }
  return true;
}

export function executionUsesChatLane(
  execution: Call1ExecutionBackend,
): boolean {
  return execution === 'chat_lane';
}

export function executionUsesPitchModule(
  execution: Call1ExecutionBackend,
): boolean {
  return execution === 'pitch_module' || execution === 'tour_module';
}

export function executionUsesPlanModule(
  execution: Call1ExecutionBackend,
): boolean {
  return execution === 'plan_module' || execution === 'plan_walkthrough';
}

export function executionUsesFlightAdvisor(
  execution: Call1ExecutionBackend,
): boolean {
  return execution === 'flight_advisor';
}

export function executionUsesNav(
  execution: Call1ExecutionBackend,
): boolean {
  return execution === 'nav_execute';
}
