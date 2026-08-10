/**
 * Lokale TTS-Floskel-Engine — Zero-Latency Acks.
 *
 * - Offline-Bibliothek (40+ Kategorien, 200+ Sätze)
 * - Smart Selection + Anti-Repetition (45 Min)
 * - Latency-Gate: nur wenn Antwort voraussichtlich > 2,5 s
 * - Action-Button-Floskeln bei UI-Klicks
 */

import floskelLibrary from '../../assets/data/floskelLibrary.json';
import { getCachedUserProfile } from '../userProfileService';
import { getVoiceSettingsForTour } from '../ttsService';
import { speakRuntimeText } from '../../runtime/speechModule';
import {
  analyzeSmartRoute,
  type SmartIntentKind,
  type SmartRouteDecision,
} from './smartRouteLite';
import type { QuickActionType } from '../../types/concierge';

export const FLOSKEL_SLOW_THRESHOLD_MS = 2_000;
export const FLOSKEL_ANTI_REPEAT_MS = 45 * 60_000;

type CategoryEntry = { label?: string; phrases: string[] };

type FloskelLibrary = {
  version: number;
  categories: Record<string, CategoryEntry>;
  actionButtons: Record<string, string[]>;
};

const lib = floskelLibrary as FloskelLibrary;

/** phrase → last spoken at ms */
const recentSpoken = new Map<string, number>();
let lastAckAtMs = 0;
let lastAckLine = '';
const GLOBAL_ACK_GAP_MS = 2_500;

const QUICK_LOCAL_RE =
  /\b(wie\s+spät|uhrzeit|stopp|halt|lauter|leiser|danke|ok\b|okay|ja\b|nein\b)\b/iu;

const INTENT_TO_CATEGORY: Record<SmartIntentKind, string> = {
  weather: 'weather',
  park: 'park',
  bar: 'bar',
  dining: 'dining',
  nav: 'nav',
  transit: 'transit',
  hotel: 'hotel',
  events: 'events',
  flight: 'flight',
  plan: 'complex_plan',
  knowledge: 'knowledge',
  hours: 'hours',
  menu: 'menu',
  phone: 'phone',
  research: 'research_web',
};

/** Text-Heuristik → Kategorie (feinere Mapping als SmartIntent allein) */
function detectFloskelCategory(userText: string): string {
  const t = userText.toLowerCase();

  if (
    /\b(to\s*go|mitnehm|takeaway)\b/u.test(t) &&
    /\b(sonnenuntergang|sunset|aussicht)\b/u.test(t)
  ) {
    return 'compound_togo_sunset';
  }
  if (/\b(speisekarte|menü|menu|karte\s+vom)\b/u.test(t)) return 'menu';
  if (/\b(öffnungszeit|oeffnungszeit|geöffnet|geoeffnet|bis\s+wann)\b/u.test(t)) {
    return 'hours';
  }
  if (/\b(telefon|nummer|anruf)\b/u.test(t)) return 'phone';
  if (/\b(party|nachtleben)\b/u.test(t)) return 'nightlife';
  // Outfit/Wetter VOR „heute Abend“→events — sonst falscher Ack + falsche Erwartung
  if (
    /\b(outfit|anziehen|anzieh|kleidung|jacke|pulli|was\s+soll\s+ich\s+an|mitnehmen\s+soll)\b/u.test(
      t,
    )
  ) {
    return 'weather_outfit';
  }
  if (/\b(wetter|regen|schirm|sonne|temperatur|wie\s+kalt|wie\s+warm)\b/u.test(t)) {
    return 'weather';
  }
  if (/\b(gewonnen|gewinn|sieg|geschafft|erste\s+runde)\b/u.test(t)) {
    return 'cheer';
  }
  if (
    /\b(spikeball|bouldern|surfen|wandern|joggen|kitesurf|beachvolleyball)\b/u.test(
      t,
    )
  ) {
    return 'activity_sport';
  }
  if (/\b(was\s+geht|events?|veranstaltung|heute\s+abend|konzert)\b/u.test(t)) {
    return 'events';
  }
  if (/\b(kino|film|vorstellung)\b/u.test(t)) return 'cinema';
  if (/\b(geschicht|denkmal|wahrzeichen|wer\s+(war|baute))\b/u.test(t)) {
    return 'history';
  }
  if (/\b(museum|ausstellung)\b/u.test(t)) return 'museum';
  if (/\b(plan(e|en)|ablauf|tagesplan|optimier|zusammenstell)\b/u.test(t)) {
    return 'complex_plan';
  }
  if (/\b(leave.?by|losgehen|wann\s+muss\s+ich)\b/u.test(t)) return 'leave_by';
  if (/\b(wecker|aufsteh|weck\s+mich)\b/u.test(t)) return 'wake_alarm';
  if (/\b(flug|gate|abflug|flughafen)\b/u.test(t)) return 'flight';
  if (/\b(zug|bus|bahn|öpnv|oepnv|verbindung|verspät)\b/u.test(t)) {
    return 'transit';
  }
  if (/\b(regen).{0,20}\b(unterstell|trocken|indoor|café|cafe)\b/u.test(t)) {
    return 'rain_shelter';
  }
  if (/\b(reserv|buch|tisch\s+für)\b/u.test(t)) return 'reservation';
  if (/\b(hotel|unterkunft|übernacht|uebernacht)\b/u.test(t)) {
    return 'accommodation_search';
  }
  if (/\b(café|cafe|kaffee|cappuccino)\b/u.test(t)) return 'cafe';
  if (/\b(vegetar|vegan|allerg|gluten|laktos)\b/u.test(t)) return 'food_allergy';
  if (
    /\b(essen|restaurant|hunger|imbiss|bistro|burger|pizza|amerikan|pizzeria)\b/u.test(
      t,
    )
  ) {
    return 'dining';
  }
  if (/\b(park|garten|grün)\b/u.test(t)) return 'park';
  if (/\b(bar|kneipe|pub|cocktail)\b/u.test(t)) return 'bar';
  if (/\b(strand|düne|duene|insel|beach)\b/u.test(t)) return 'beach_island';
  if (/\b(führ|fuehr|navigier|route|bring\s+mich|kompass)\b/u.test(t)) {
    return 'nav';
  }
  if (/\b(sonnenuntergang|sunset|aussicht|plattform)\b/u.test(t)) {
    return 'sunset';
  }
  if (/\b(wo\s+bin\s+ich|wo\s+stehe\s+ich)\b/u.test(t)) return 'where_am_i';
  if (/\b(wo\s+(ist|liegt|find)|lage|adresse)\b/u.test(t)) return 'location';
  if (/\b(pdf|flyer|programmheft)\b/u.test(t)) return 'pdf_flyer';
  if (/\b(ticket|eintritt|karte\s+kaufen)\b/u.test(t)) return 'ticket';
  if (/\b(tour|gepäck|koffer|bounce)\b/u.test(t)) return 'luggage';
  if (/\b(tour|aktivität|ausflug)\b/u.test(t)) return 'tours';
  if (/\b(uber|taxi|bolt)\b/u.test(t)) return 'uber_taxi';
  if (/\b(mietwagen|auto\s+mieten)\b/u.test(t)) return 'car_rental';
  if (/\b(einkauf|supermarkt|drogerie|besorgen|prospekt|angebot|aktionspreis)\b/u.test(t)) return 'shopping';
  if (/\b(notfall|hilfe|apotheke|arzt|112)\b/u.test(t)) return 'safety';
  if (/\b(recherch|webseite|website|nachschau)\b/u.test(t)) return 'research_web';
  if (/\b(wer\s+hat|was\s+ist\s+findus|programmier|über\s+dich)\b/u.test(t)) {
    return 'knowledge';
  }
  return 'generic';
}

/** Öffentlich für researchAck-Kompatibilität */
export function detectFloskelCategoryPublic(userText: string): string {
  return detectFloskelCategory(userText);
}

function pruneCache(now = Date.now()): void {
  for (const [phrase, at] of recentSpoken) {
    if (now - at > FLOSKEL_ANTI_REPEAT_MS) recentSpoken.delete(phrase);
  }
}

function isFreshlyUsed(phrase: string, now = Date.now()): boolean {
  const at = recentSpoken.get(phrase);
  return at != null && now - at < FLOSKEL_ANTI_REPEAT_MS;
}

function markSpoken(phrase: string, now = Date.now()): void {
  recentSpoken.set(phrase, now);
  lastAckLine = phrase;
  lastAckAtMs = now;
}

function getCategoryPhrases(category: string): string[] {
  const entry = lib.categories[category] ?? lib.categories.generic;
  return entry?.phrases?.length ? entry.phrases : lib.categories.generic.phrases;
}

/**
 * Wählt eine Floskel: meidet Wiederholung innerhalb 45 Min + letzte Linie.
 */
export function pickFloskelPhrase(category: string): string {
  pruneCache();
  const pool = getCategoryPhrases(category);
  const now = Date.now();
  const fresh = pool.filter((p) => !isFreshlyUsed(p, now) && p !== lastAckLine);
  const use = fresh.length > 0 ? fresh : pool.filter((p) => p !== lastAckLine);
  const finalPool = use.length > 0 ? use : pool;
  return finalPool[Math.floor(Math.random() * finalPool.length)]!;
}

export function pickFloskelForUserText(userText: string): {
  category: string;
  phrase: string;
} {
  const decision = analyzeSmartRoute(userText);
  let category = detectFloskelCategory(userText);

  if (decision.intentDensity >= 2 || decision.mode === 'deep') {
    // Multi-Intent / Deep → oft „komplexe Planung“ oder multi_intent
    if (
      decision.intentDensity >= 2 &&
      !['compound_togo_sunset', 'complex_plan', 'events'].includes(category)
    ) {
      category = decision.wordCount > 15 ? 'complex_plan' : 'multi_intent';
    }
  } else if (decision.intents.length === 1) {
    const mapped = INTENT_TO_CATEGORY[decision.intents[0]!];
    if (mapped && category === 'generic') category = mapped;
  }

  if (!lib.categories[category]) category = 'generic';
  return { category, phrase: pickFloskelPhrase(category) };
}

export function pickActionButtonFloskel(actionType: QuickActionType | string): string | null {
  pruneCache();
  const pool = lib.actionButtons[actionType];
  if (!pool?.length) return null;
  const now = Date.now();
  const fresh = pool.filter((p) => !isFreshlyUsed(p, now) && p !== lastAckLine);
  const use = fresh.length > 0 ? fresh : pool;
  return use[Math.floor(Math.random() * use.length)]!;
}

/**
 * Router sagt: Antwort dauert voraussichtlich > 2,5 s?
 * Deep-Pipeline, Research/Events/Hours, Multi-Intent, volle Concierge-Recherche.
 */
export function expectsSlowResponse(
  userText: string,
  decision?: SmartRouteDecision,
): boolean {
  const d = decision ?? analyzeSmartRoute(userText);
  if (d.mode === 'deep') return true;
  if (d.intentDensity >= 2) return true;
  if (d.contextProfile === 'full') return true;

  const slowIntents: SmartIntentKind[] = [
    'events',
    'research',
    'hours',
    'menu',
    'phone',
    'hotel',
    'flight',
    'plan',
    'transit',
  ];
  if (d.intents.some((i) => slowIntents.includes(i))) return true;

  const t = userText.toLowerCase();
  if (
    /\b(recherch|öffnungs|speisekarte|veranstaltung|was\s+geht|webseite|pdf|ticket|reserv|kino|film|vorstellung|bahn|zug|öpnv|verbindung|fahrplan|abfahrt)\b/u.test(
      t,
    )
  ) {
    return true;
  }
  // Lange Frage auch ohne Multi-Intent-Match
  if (d.wordCount > 12) return true;

  return false;
}

export function hadRecentLatencyAck(withinMs = 10_000): boolean {
  return Date.now() - lastAckAtMs < withinMs;
}

export function shouldSpeakLatencyFloskel(
  userText: string,
  decision?: SmartRouteDecision,
): boolean {
  const t = userText.replace(/\s+/g, ' ').trim();
  if (t.length < 6) return false;
  if (QUICK_LOCAL_RE.test(t) && t.length < 40) return false;
  if (Date.now() - lastAckAtMs < GLOBAL_ACK_GAP_MS) return false;
  return expectsSlowResponse(t, decision);
}

async function speakLine(line: string): Promise<void> {
  markSpoken(line);
  try {
    const cached = getCachedUserProfile();
    const voice = cached
      ? { voiceId: cached.voiceId, speechRate: 1 as const }
      : await getVoiceSettingsForTour();
    await speakRuntimeText(
      line,
      {
        voiceId: voice.voiceId,
        speechRate: voice.speechRate,
      },
      {
        priority: 'system',
        deliveryKind: 'assistant',
      },
    );
  } catch {
    /* soft */
  }
}

/**
 * Zero-Latency Ack — DEAKTIVIERT (Manager-Bridge SSOT).
 */
export function speakLatencyFloskelFireAndForget(
  _userText: string,
  _decision?: SmartRouteDecision,
): void {
  /* no-op — Concierge-Manager owns the only bridge */
}

/**
 * Action-Button: keine Floskeln mehr (Bridge/Hauptantwort reichen).
 */
export function speakActionButtonFloskelFireAndForget(
  _actionType: QuickActionType | string,
): void {
  /* no-op — bewusst still */
}

/** Debug / Tests */
export function getFloskelLibraryStats(): {
  categoryCount: number;
  researchPhraseCount: number;
  actionPhraseCount: number;
} {
  const cats = Object.keys(lib.categories);
  let researchPhraseCount = 0;
  for (const c of cats) researchPhraseCount += lib.categories[c]!.phrases.length;
  let actionPhraseCount = 0;
  for (const p of Object.values(lib.actionButtons)) actionPhraseCount += p.length;
  return {
    categoryCount: cats.length,
    researchPhraseCount,
    actionPhraseCount,
  };
}

/** Test-Hook: Cache leeren */
export function resetFloskelCacheForTests(): void {
  recentSpoken.clear();
  lastAckAtMs = 0;
  lastAckLine = '';
}
