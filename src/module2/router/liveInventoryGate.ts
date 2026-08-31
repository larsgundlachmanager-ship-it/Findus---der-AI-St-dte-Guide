/**
 * Live-Recherche-Weiche — Chat darf Preise, Events, Namen nie erfinden.
 *
 * Klasse: alles, was Live-API / heutiges Programm + Buttons braucht
 * (Hotel/Stay22, Event-Kalender, Auswahl-Pitch). Follow-ups („ja“) erben
 * den letzten Auftrag — nicht ein neues Chat-Thema.
 */

import { detectPitchKind } from '../pitch/parentBrief';
import {
  getLastLiveInventory,
  noteLastLiveInventory,
  type LiveInventoryKind,
} from '../context/shortTermContext';

export type { LiveInventoryKind };

function shouldHandoffToPitchModuleSafe(text: string): boolean {
  try {
    const { shouldHandoffToPitchModule } = require('../pitch/shouldHandoffPitch') as {
      shouldHandoffToPitchModule: (s: string) => boolean;
    };
    return shouldHandoffToPitchModule(text);
  } catch {
    return false;
  }
}

function isPlaceGoQuerySafe(text: string): boolean {
  try {
    const { isPlaceGoQuery } = require('./placeGoQuery') as {
      isPlaceGoQuery: (s: string) => boolean;
    };
    return isPlaceGoQuery(text);
  } catch {
    return false;
  }
}

function shouldForbidQuickChatSafe(text: string): boolean {
  try {
    const { shouldForbidQuickChat } = require('./placeGoQuery') as {
      shouldForbidQuickChat: (s: string) => boolean;
    };
    return shouldForbidQuickChat(text);
  } catch {
    return false;
  }
}

function isEventQuery(text: string): boolean {
  try {
    const { isEventResearchQuery } = require('../../services/concierge/eventResearchService') as {
      isEventResearchQuery: (s: string) => boolean;
    };
    return isEventResearchQuery(text);
  } catch {
    return /\b(was\s+geht|heute\s+abend|heut\s+abend|events?|veranstaltung|party|konzert|festival|nightlife|nachtleben|ausgehen|feiern|tanzen|disco|club)\b/iu.test(
      text,
    );
  }
}

const AFFIRM_RE =
  /^(ja|jo|jap|jep|yes|yep|genau|stimmt|richtig|ok|okay|klar|gerne|los|mach|tu\s+das|mach\s+das|bitte)(?:\s+bitte)?\s*[.!?]?$/iu;

const PRICE_FOLLOW_RE =
  /\b(wie\s+teuer|was\s+kostet|den\s+preis|preis(?:e)?|günstigste|guenstigste|billigste|die\s+liste|raus\s*suchen|such(?:e|t)?\s+(es|das|mir)|zeig(?:\s+mir)?|partnerlink|buchen)\b/iu;

const TIME_FOLLOW_RE =
  /(?:^|[^\p{L}\p{N}_])(?:uhrzeit(?:en)?|spielzeit(?:en)?|welche\s+zeiten|die\s+zeiten|öffnungszeit(?:en)?|oeffnungszeit(?:en)?|wann\s+(?:geht(?:'s|s)?|startet|fängt|anfaengt|anfängt|los|hat)|ab\s+wann|bis\s+wann|noch\s+offen)(?=$|[^\p{L}\p{N}_])/iu;

/** Event-Follow-up: Vertiefen / Bestätigen ohne neues Keyword „Festival“. */
const EVENT_DEEPEN_FOLLOW_RE =
  /\b(erzähl|erzaehl|mehr\s+dazu|mehr\s+darüber|mehr\s+darueber|mehr\s+programm|läuft|laeuft|wirklich|tatsächlich|tatsaechlich|programm|flyer|pdf|eintritt|details?|darüber|darueber)\b/iu;

/** Pitch-Follow-up: Ablehnung / mehr Optionen / weitermachen — gleicher Suchkontext. */
const PITCH_FOLLOW_RE =
  /\b(?:(?:das|die|den|es)\s+)?(?:mag\s+ich\s+nicht|gefällt\s+mir\s+nicht|gefaellt\s+mir\s+nicht|will\s+ich\s+nicht|nichts\s+für\s+mich|nicht\s+so\s+gerne|nicht\s+gerne)|(?:nee|nö|nein)(?:\s+(?:das|die|den))?(?:\s+mag\s+ich\s+nicht)?|\b(?:was\s+gibt(?:'s|s|\s+es)\s+noch|was\s+noch|andere(?:s|n)?\s+option(?:en)?|andere(?:r|s)?\s+vorschlag|neu\s*suchen|beides\s+nicht|lieber\s+was\s+anderes|etwas\s+anderes|was\s+anderes|wie\s+geht(?:'s|s|\s+es)\s+(?:denn\s+)?(?:da\s+)?weiter|und\s+weiter|zeig\s+(?:mir\s+)?(?:noch\s+)?(?:mehr|andere)|kein(?:e|en)?\s+\w{3,20}\s+(?:so\s+)?gerne)\b/iu;

/** Nackte Uhrzeit am offenen Auftrag („um 20 Uhr“) — kein neues Thema. */
const BARE_CLOCK_FOLLOW_RE =
  /^(?:(?:so\s+)?(?:gerne\s+)?(?:gegen|ab|bis|um|ca\.?|circa)\s+)?(?:\d{1,2})(?:[:.]\d{2})?\s*(?:uhr)?\s*[.!?]?$/iu;

const NEW_TOPIC_RE =
  /\b(wetter|anziehen|wecker|timer|erinner|sternschnuppe|finsternis|nordlicht|geschichte|historie|führ\s+mich|fahr\s+mich|tour|erkunden|taxi|uber|hotel|flug|flüge|fluege|flieger|fliegen|party|konzert|festival|was\s+geht|neues\s+thema|anderes\s+thema|picknick|picnic|grillen|wochenende|wochenendurlaub|urlaub|städtetrip|staedtetrip|kurztrip|planen|einplanen|wie\s+alt\s+ist|wer\s+(?:ist|war))\b/iu;

const FOOD_NOT_EVENT_RE =
  /\b(essen|restaurant|pizza|burger|sushi|imbiss|café|cafe|frühstück|fruehstueck)\b/iu;

const EVENT_OVERRIDE_RE =
  /\b(party|event|konzert|festival|nightlife|nachtleben|club|was\s+geht|feiern|tanzen|disco)\b/iu;

export function detectLiveInventoryKind(
  text: string,
): LiveInventoryKind | null {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const kind = detectPitchKind(t);
  if (kind === 'hotel') return 'hotel';
  try {
    const { isParkingSearchIntent } = require('../../services/concierge/timeCareIntent') as {
      isParkingSearchIntent: (s: string) => boolean;
    };
    if (isParkingSearchIntent(t)) return 'pitch_choice';
  } catch {
    /* soft */
  }

  const eventQ = isEventQuery(t);
  const foodTonight =
    kind === 'food' && FOOD_NOT_EVENT_RE.test(t) && !EVENT_OVERRIDE_RE.test(t);
  const cinemaTonight = kind === 'cinema' && !EVENT_OVERRIDE_RE.test(t);

  // „heute Abend essen/Kino“ → Auswahl-Pitch, nicht Event-Kalender
  if (foodTonight || cinemaTonight) return 'pitch_choice';
  if (eventQ) return 'events';
  if (
    (kind === 'food' ||
      kind === 'cinema' ||
      kind === 'bar' ||
      kind === 'sight') &&
    shouldHandoffToPitchModuleSafe(t)
  ) {
    return 'pitch_choice';
  }
  // Strand / Amenity / „wo hingehen“ → Pitch mit Distanz, nicht 2-Satz-Chat
  if (isPlaceGoQuerySafe(t)) return 'pitch_choice';
  if (shouldHandoffToPitchModuleSafe(t)) return 'pitch_choice';
  return null;
}

export function isInventoryFollowUp(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  try {
    const { shouldPreserveFlightTripSession } = require('../../services/flights/flightTripIntent') as {
      shouldPreserveFlightTripSession: (s: string) => boolean;
    };
    if (shouldPreserveFlightTripSession(t)) return false;
  } catch {
    /* soft */
  }
  // Personen-Alter / Trivia: nie an Events/Sport-Inventory kleben.
  try {
    const { isQuickLookupQuery } = require('../../services/concierge/celestialSkyQuery') as {
      isQuickLookupQuery: (s: string) => boolean;
    };
    if (isQuickLookupQuery(t)) return false;
  } catch {
    /* soft */
  }
  try {
    const { classifyUtteranceFamily } = require('../kernel/utteranceFamily') as {
      classifyUtteranceFamily: (s: string) => { family: string };
    };
    const fam = classifyUtteranceFamily(t).family;
    if (fam === 'knowledge' || fam === 'weather') return false;
  } catch {
    /* soft */
  }
  // Named Trivia ohne Quick-Lookup-Hit (Fallback-Struktur).
  if (
    /\b(?:wie\s+(?:alt|groß|gross|hoch|breit)|wer)\b/iu.test(t) &&
    /\b(?:ist|war|sind)\s+(?:(?:der|die|das)\s+)?[A-ZÄÖÜ][\wÄÖÜäöüß\-]/u.test(t)
  ) {
    return false;
  }
  if (AFFIRM_RE.test(t)) return true;
  if (t.length > 160) return false;
  const pending = getLastLiveInventory();
  if (
    pending &&
    /\b(partner\s*link|partnerlink|buchungslink|deeplink)\b/iu.test(t)
  ) {
    return true;
  }
  if (pending && /\bzeig\s+mir\b/iu.test(t) && t.split(/\s+/).length <= 6) {
    return true;
  }
  const eventDeepen =
    pending?.kind === 'events' &&
    (TIME_FOLLOW_RE.test(t) || EVENT_DEEPEN_FOLLOW_RE.test(t));
  if (eventDeepen) return true;
  if (pending?.kind === 'pitch_choice' && PITCH_FOLLOW_RE.test(t)) {
    return true;
  }
  if (pending?.kind === 'hotel' && PITCH_FOLLOW_RE.test(t)) {
    return true;
  }
  if (
    pending &&
    t.length <= 40 &&
    BARE_CLOCK_FOLLOW_RE.test(t)
  ) {
    try {
      const { getFlightTripSession } = require('../../services/flights/flightTripSession') as {
        getFlightTripSession: () => { pendingAsk?: string | null } | null;
      };
      const flightAsk = getFlightTripSession()?.pendingAsk;
      if (flightAsk === 'when' || flightAsk === 'which' || flightAsk === 'luggage') {
        return false;
      }
    } catch {
      /* soft */
    }
    if (
      pending.kind === 'pitch_choice' ||
      pending.kind === 'hotel' ||
      pending.kind === 'events'
    ) {
      return true;
    }
  }
  if (
    NEW_TOPIC_RE.test(t) &&
    !PRICE_FOLLOW_RE.test(t) &&
    !TIME_FOLLOW_RE.test(t) &&
    !EVENT_DEEPEN_FOLLOW_RE.test(t) &&
    !PITCH_FOLLOW_RE.test(t) &&
    !BARE_CLOCK_FOLLOW_RE.test(t)
  ) {
    return false;
  }
  return (
    PRICE_FOLLOW_RE.test(t) ||
    TIME_FOLLOW_RE.test(t) ||
    EVENT_DEEPEN_FOLLOW_RE.test(t) ||
    (Boolean(pending) && PITCH_FOLLOW_RE.test(t)) ||
    (Boolean(pending) && t.length <= 40 && BARE_CLOCK_FOLLOW_RE.test(t))
  );
}

/**
 * Kurzes „ja“ / Ablehnung / „was noch“ → letzter Live-Auftrag.
 * Volle Hotel-/Event-/Pitch-Frage bleibt unverändert.
 */
export function resolveLiveInventoryUserText(userText: string): {
  text: string;
  inherited: boolean;
  kind: LiveInventoryKind | null;
} {
  const t = (userText || '').replace(/\s+/g, ' ').trim();
  const pending = getLastLiveInventory();
  if (pending && isInventoryFollowUp(t)) {
    if (AFFIRM_RE.test(t)) {
      return {
        text: pending.query,
        inherited: true,
        kind: pending.kind,
      };
    }
    if (PITCH_FOLLOW_RE.test(t) && pending.kind === 'pitch_choice') {
      const rejected =
        t.match(
          /\b(?:kein(?:e|en)?|ohne)\s+([A-Za-zÄÖÜäöüß-]{3,24})\b/iu,
        )?.[1] ||
        t.match(
          /\bmag\s+(?:eigentlich\s+)?kein(?:e|en)?\s+([A-Za-zÄÖÜäöüß-]{3,24})\b/iu,
        )?.[1];
      let base = pending.query;
      if (rejected) {
        const re = new RegExp(`\\b${rejected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'ig');
        base = base.replace(re, '').replace(/\s{2,}/g, ' ').trim();
      }
      const merged = rejected
        ? `${base || 'Restaurant'}. Kein ${rejected} — andere passende Optionen. (${t})`
        : `${pending.query}. Feedback: ${t}. Andere passende Optionen — Abgelehntes weglassen.`;
      return {
        text: merged.replace(/\s+/g, ' ').trim().slice(0, 480),
        inherited: true,
        kind: pending.kind,
      };
    }
    const merged = `${pending.query} ${t}`;
    return {
      text: merged.replace(/\s+/g, ' ').trim(),
      inherited: true,
      kind: pending.kind,
    };
  }
  const direct = detectLiveInventoryKind(t);
  if (direct) {
    return { text: t, inherited: false, kind: direct };
  }
  return { text: t, inherited: false, kind: null };
}

export function mustSkipChatLane(
  userText: string,
  analysis?: {
    chatLane?: string | null;
    blueprintId?: string | null;
  },
): boolean {
  const lane = analysis?.chatLane || '';
  if (lane === 'pitch') return true;
  const bp = String(analysis?.blueprintId || '');
  if (bp === 'hotel' || bp.startsWith('hotel/')) return true;
  if (bp === 'live_events' || bp.startsWith('live_events')) return true;
  const resolved = resolveLiveInventoryUserText(userText);
  if (
    resolved.kind === 'hotel' ||
    resolved.kind === 'pitch_choice' ||
    resolved.kind === 'events'
  ) {
    return true;
  }
  if (shouldHandoffToPitchModuleSafe(resolved.text)) return true;
  try {
    const { isExplicitNavIntent } = require('../../services/intent/poiInfoVsNav') as {
      isExplicitNavIntent: (s: string) => boolean;
    };
    const {
      looksLikeStreetAddress,
      extractStreetAddressFromUtterance,
    } = require('../../services/navigation/streetAddressQuery') as {
      looksLikeStreetAddress: (s: string) => boolean;
      extractStreetAddressFromUtterance: (s: string) => string | null;
    };
    if (
      isExplicitNavIntent(userText) ||
      isExplicitNavIntent(resolved.text) ||
      looksLikeStreetAddress(resolved.text) ||
      extractStreetAddressFromUtterance(userText)
    ) {
      return true;
    }
  } catch {
    /* soft */
  }
  try {
    const { wantsTaxiRide } = require('../../services/mobility/taxiRideIntent') as {
      wantsTaxiRide: (s: string) => boolean;
    };
    if (wantsTaxiRide(userText) || wantsTaxiRide(resolved.text)) return true;
  } catch {
    /* soft */
  }
  if (shouldForbidQuickChatSafe(resolved.text) && isPlaceGoQuerySafe(resolved.text)) {
    return true;
  }
  try {
    if (isEventQuery(resolved.text)) return true;
  } catch {
    /* soft */
  }
  try {
    const {
      wantsLiveChatVoiceCommand,
      wantsStopLiveChatVoiceCommand,
    } = require('../../services/handsFree/liveChatSession') as {
      wantsLiveChatVoiceCommand: (s: string) => boolean;
      wantsStopLiveChatVoiceCommand: (s: string) => boolean;
    };
    if (
      wantsLiveChatVoiceCommand(userText) ||
      wantsStopLiveChatVoiceCommand(userText)
    ) {
      return true;
    }
  } catch {
    /* soft */
  }
  return false;
}

export function rememberLiveInventoryQuery(
  userText: string,
  kind: LiveInventoryKind | null,
): void {
  const k = kind || detectLiveInventoryKind(userText);
  if (!k) return;
  noteLastLiveInventory({ kind: k, query: userText });
}
