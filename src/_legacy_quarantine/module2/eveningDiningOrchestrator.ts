/**
 * Evening Dining Orchestrator — „Was schlägst du heute Abend zum Essen vor?“
 *
 * Deterministisch: Hotel-Anker · Budget · Bewertung · Aussicht/Sonnenuntergang
 * · Barrierefreiheit · Öffnung zur Wunschzeit · 2–4 Rankings · Favorit + Buttons.
 */

import { getAllPois, getFactsForPoi, haversineMeters } from '../../db/database';
import type { Poi } from '../../db/types';
import type { GeminiConciergeResponse, QuickAction } from '../../types/concierge';
import type { BudgetCategory } from '../../types/userProfile';
import { useFinnusStore } from '../../store/useFinnusStore';
import { useUserMemoryStore } from '../../store/useUserMemoryStore';
import { getCachedUserProfile } from '../userProfileService';
import { resolvePersonaEngine } from '../personaEngine';
import { evaluatePoiForProfile } from '../poiFilterService';
import { parseTagsJson } from '../geo/triggerPolicy';
import { estimateTravelEta } from '../navigation/travelEta';
import {
  hasGoogleMapsNavKey,
  searchOpenPlacesAhead,
  searchPlacesByText,
  geocodePlaceNameOsmFirst,
  type DiscoveredPlace,
} from '../navigation/googleMapsNav';
import {
  buildPoiReservationInfo,
  resolveReservationTier,
} from '../reservation/reservationService';
import { fetchCommunityPlaceTipsNear } from '../memory/communityPlaceFeedback';
import {
  closingTimeAllowsStay,
  extractCloseMinutesFromFacts,
} from './closingHours';
import type { EventResearchResult } from './eventResearchService';
import { researchTodaysEvents } from './eventResearchService';
import {
  clampDualLabel,
  DUAL_OPTION_MAX,
} from './dualOptionPolicy';
import { shortenActionLabel } from './actionLabelShorten';
import {
  PLACE_EXPAND_RINGS_M,
  PLACE_FAR_SPEECH_M,
} from '../navigation/expandingPlaceSearch';
const WALK_M_PER_MIN = 80;
const MAX_DIST_FROM_ANCHOR_M = 3500;
const CUISINE_EXPAND_RADIUS_M = 8000;
/** Obergrenze Expanding-Suche (Google Nearby max). */
const FAR_SEARCH_RADIUS_M = 50_000;
const EXPAND_RING_M = PLACE_EXPAND_RINGS_M;
const FAR_SPEECH_M = PLACE_FAR_SPEECH_M;
const MIN_RATING = 3.8;
const LOW_RATING_THRESHOLD = 4.0;
const DEFAULT_MEAL_STAY_MIN = 75;
const BAKERY_RE =
  /\b(bäckerei|baeckerei|backerei|inselbäckerei|inselbeackerei|konditorei|bakery|bäcker\b|baecker\b|backwaren|backstube|allwörden|allwoerden|von\s+allw)\b/i;
const NON_SITDOWN_TYPES_RE =
  /\b(bakery|cafe|meal_takeaway|convenience_store|supermarket|grocery|store|shopping_mall)\b/i;
const NON_GASTRO_RE =
  /\b(verwaltung|gemeindezentrum|straßenverzeichnis|strassenverzeichnis|brücke|bruecke|eisenbahn|denkmal|feuerwache|feuerwehr|kindergarten|kita|schule|zahnarzt|praxis|museum|kirche|bahnhof|haltestelle|fähre|faehre|anleger|parkplatz|toilette|wc\b)\b/i;

const MEAL_BUDGET_EUR: Record<BudgetCategory, number> = {
  sparsam: 22,
  mittel: 38,
  komfort: 65,
};

export type DiningCandidate = {
  name: string;
  lat: number;
  lng: number;
  poiId: number | null;
  distanceM: number;
  walkMin: number;
  distanceFromHotelM: number | null;
  hotelWalkMin: number | null;
  rating: number | null;
  openAtTarget: 'yes' | 'unknown' | 'no';
  hoursHint: string | null;
  insider: string | null;
  hasView: boolean;
  hasTerrace: boolean;
  priceLevel: 'low' | 'mid' | 'high' | 'unknown';
  estimatedMealEur: number | null;
  budgetFit: 'in' | 'stretch' | 'over' | 'unknown';
  budgetOverEur: number | null;
  wheelchairOk: boolean;
  specialties: string[];
  menuUrl: string | null;
  reservationNeeded: boolean;
  eveningEvent: string | null;
  score: number;
  scoreReasons: string[];
  source: 'pack' | 'places';
  /** Profil-relevante Warnungen (Bargeld, Barriere, …) */
  warnings?: string[];
  /** Schließzeit Minuten seit Mitternacht — für Stay-Gate */
  closeMin?: number | null;
};

export type DiningRequest = {
  targetTimeMin: number;
  targetTimeLabel: string;
  wantsSunset: boolean;
  /** Explizit „erinner mich“ zum Sonnenuntergang */
  wantsSunsetReminder: boolean;
  wantsView: boolean;
  wantsTerrace: boolean;
  /** To-go / Mitnehmen */
  wantsTakeaway: boolean;
  /**
   * Essen und Aussicht als zwei Stops (Mitnehmen + weiter zum Spot),
   * nicht ein Restaurant „mit Aussicht“.
   */
  wantsSeparateViewpoint: boolean;
  /** Nie Hunger / immer Appetit → leichte Portions-/Highlight-Formulierung */
  neverHungry: boolean;
  cuisineHints: string[];
  mealItems: string[];
  partySize: number | null;
  excludeNames: string[];
};

export type EveningDiningResult = {
  candidates: DiningCandidate[];
  favorite: DiningCandidate | null;
  sunsetLabel: string | null;
  mealBudgetEur: number;
  budgetCategory: BudgetCategory;
  anchorLabel: string;
  promptBlock: string;
  response: GeminiConciergeResponse;
};

const EVENING_DINING_RE =
  /\b(abendessen|abends?\s+essen|essen\s+gehen|leckeres?\s+essen|geiles?\s+essen|nie\s+hunger|hunger\s+nie|was\s+leckeres|einheimisch|regional(?:e|es|en)?\s+(?:küche|essen|spezial)|spitzen|restaurants?\s+such|wo\s+(?:sollen\s+wir|können\s+wir|kann\s+ich|will\s+ich)\s+essen|was\s+(?:schlägst|schlagst|empfiehlst|kannst)\s+du.{0,40}essen|überleg(?:e|t).{0,40}essen|vorschlagen.{0,30}(restaurants?|essen)|restaurants?.{0,30}(vorschlag|empfehl|idee)|mir\s+(?:was\s+)?vorschlagen|steckst\s+du\s+mir|to\s*[- ]?go|mitnehm|takeaway|imbiss|was\s+zum\s+essen|wo\s+gibt.{0,40}restaurants?|gute\s+restaurants?|restaurants?\s+in\s+der\s+n[aä]he|heute\s+abend.{0,40}(essen|restaurant|tisch|hunger)|essen.{0,40}heute\s+abend)\b/iu;

const NOT_DINING_RE =
  /\b(wetter|anziehen|klamotten|jacke|regen|sonne|temperatur|kirche|kapelle|museum|geschichte|erzähl|wo\s+bin\s+ich|navigation\s+stopp|route\s+abbrechen)\b/iu;

const SUNSET_VIEW_RE =
  /\b(sonnenuntergang|sunset|aussicht|terrasse|promenade|meerblick|strandblick|aussichtsplattform|plattform)\b/iu;

const TRANSIT_NAME_RE =
  /\b(bahnhof|inselbahnhof|haltestelle|bushalt|fähre|faehre|anleger|parkplatz|toilette|wc\b|kurverwaltung)\b/iu;

const VIEWPOINT_NAME_RE =
  /\b(aussicht|plattform|jever|leuchtturm|düne|duene|weststrand|oststrand|promenade|panorama|warte|höhe|hoehe|kliff|meer(?:blick)?)\b/iu;

const KEEP_SEARCHING_RE =
  /\b(weiter\s+suchen|mehr\s+restaurants?|andere\s+option|noch\s+mal\s+suchen|zeig\s+mir\s+mehr)\b/iu;

export function isEveningDiningOrchestratorQuery(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  // Wetter / Outfit / Kirche / Geschichte → nie Dining-Express
  if (NOT_DINING_RE.test(t) && !/\b(restaurants?|essen|hunger|burger|pizza)\b/iu.test(t)) {
    return false;
  }
  // Party/Events ohne Essen-Wort → kein Dining-Express
  if (
    /\b(party|event|konzert|was\s+geht|feier)\b/iu.test(t) &&
    !/\b(restaurants?|essen|hunger|caf(?:e|é)|imbiss|abendessen|mittag)\b/iu.test(t)
  ) {
    return false;
  }
  if (KEEP_SEARCHING_RE.test(t)) return true;
  // Direkt: Restaurant(s) suchen / wo gibt es …
  if (
    /\brestaurants?\b/iu.test(t) &&
    /\b(wo|gibt|suche|gesucht|n[aä]he|empfehl|gut|offen|essen)\b/iu.test(t)
  ) {
    return true;
  }
  if (EVENING_DINING_RE.test(t)) return true;
  // Burger / Pizza / amerikanisch — immer Dining, auch ohne „Restaurant“-Wort
  if (
    /\b(burger|smash\s*burger|pizza|pizzeria|amerikanisch|american\s+food|steakhouse)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  // To-go / Mitnehmen (+ optional Sunset)
  if (
    /\b(to\s*[- ]?go|mitnehm|takeaway|imbiss|snack)\b/iu.test(t) &&
    /\b(essen|hol|kauf|wo|hunger|burger|pommes|fisch)\b/iu.test(t)
  ) {
    return true;
  }
  // Essen + Sonnenuntergang / Erinnerung (auch ohne „Restaurant“-Wort)
  if (
    SUNSET_VIEW_RE.test(t) &&
    /\b(essen|leckeres|restaurant|abend|tisch|hunger|einheimisch|erinner|to\s*[- ]?go|mitnehm)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\b(sonnenuntergang|sunset).{0,80}(essen|restaurant|abend|erinner|to\s*go|mitnehm)/iu.test(
      t,
    ) ||
    /\b(essen|restaurant|abendessen|leckeres|to\s*go|mitnehm).{0,80}(sonnenuntergang|sunset|19\s*uhr|um\s+19|aussicht)/iu.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\b(speisekarte|menü|menu|burger|bier|preis|budget|rollstuhl|barrierefrei)\b/iu.test(t) &&
    /\b(restaurant|essen|abend|tisch)\b/iu.test(t)
  ) {
    return true;
  }
  return false;
}

function formatClock(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function walkMin(distanceM: number): number {
  return Math.max(1, Math.ceil(distanceM / WALK_M_PER_MIN));
}

function parseTargetTimeMin(text: string, sunsetMs: number | null): {
  min: number;
  label: string;
} {
  const m = text.match(/\b(?:um|gegen|circa|ca\.?)\s*(\d{1,2})(?:[.:](\d{2}))?\s*(?:uhr)?\b/iu);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2] ?? 0);
    if (h <= 23 && min <= 59) {
      return {
        min: h * 60 + min,
        label: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
      };
    }
  }
  if (/\bsonnenuntergang|sunset\b/iu.test(text) && sunsetMs != null) {
    const d = new Date(sunsetMs);
    return {
      min: d.getHours() * 60 + d.getMinutes(),
      label: formatClock(sunsetMs),
    };
  }
  return { min: 19 * 60, label: '19:00' };
}

function parseDiningRequest(text: string, sunsetMs: number | null): DiningRequest {
  const time = parseTargetTimeMin(text, sunsetMs);
  const party = text.match(/\b(?:für|fuer)\s+(\d{1,2})\s*(?:person|personen|leute|gäste|gaeste)\b/iu);
  const cuisineHints: string[] = [];
  for (const w of [
    'griech',
    'itali',
    'pizza',
    'burger',
    'amerikan',
    'american',
    'fisch',
    'vegetar',
    'vegan',
    'asiat',
    'steak',
    'regional',
    'einheimisch',
    'nordsee',
    'krabben',
    'fischbrötchen',
  ]) {
    if (new RegExp(w, 'iu').test(text)) cuisineHints.push(w);
  }
  const mealItems: string[] = [];
  if (/\bburger\b/iu.test(text)) mealItems.push('burger');
  if (/\b(amerikanisch|american\s+food)\b/iu.test(text)) {
    mealItems.push('burger');
    if (!cuisineHints.includes('amerikan')) cuisineHints.push('amerikan');
  }
  if (/\bpizza\b/iu.test(text)) mealItems.push('pizza');
  if (/\bbier\b/iu.test(text)) mealItems.push('bier');

  const excludeNames: string[] = [];
  const chat = useFinnusStore.getState().chatHistory.slice(-6);
  for (const msg of chat) {
    if (msg.role !== 'assistant') continue;
    const names = msg.content.match(/(?:Restaurant|Café|Cafe|Bar)\s+[A-ZÄÖÜ][\wäöüß\- ]{2,30}/g);
    if (names) excludeNames.push(...names.map((n) => n.replace(/^Restaurant\s+/i, '').trim()));
  }

  return {
    targetTimeMin: time.min,
    targetTimeLabel: time.label,
    wantsSunset: /\b(sonnenuntergang|sunset)\b/iu.test(text),
    wantsSunsetReminder:
      /\b(erinner|nicht\s+verpass|nicht\s+vergessen)\b/iu.test(text) &&
      /\b(sonnenuntergang|sunset)\b/iu.test(text),
    wantsView: /\b(aussicht|blick|meerblick|promenade|strandblick|plattform)\b/iu.test(
      text,
    ),
    wantsTerrace: /\b(terrasse|draußen|draussen|outside)\b/iu.test(text),
    wantsTakeaway: /\b(to\s*[- ]?go|mitnehm|takeaway|imbiss|snack|zum\s+mitnehmen)\b/iu.test(
      text,
    ),
    wantsSeparateViewpoint:
      (/\b(to\s*[- ]?go|mitnehm|takeaway)\b/iu.test(text) &&
        /\b(sonnenuntergang|sunset|aussicht|plattform|spot|weiter|danach)\b/iu.test(
          text,
        )) ||
      (/\b(essen|hol|kauf).{0,40}(danach|weiter|dann).{0,40}(sonnenuntergang|sunset|aussicht)/iu.test(
        text,
      )),
    neverHungry: /\b(nie\s+hunger|hunger\s+nie|immer\s+appetit|kein\s+hunger)\b/iu.test(text),
    cuisineHints,
    mealItems,
    partySize: party ? Number(party[1]) : null,
    excludeNames,
  };
}

/** Memory/Persona → Küche, wenn User nichts Explizites gesagt hat */
function enrichDiningRequestFromMemory(req: DiningRequest): DiningRequest {
  if (req.cuisineHints.length > 0 || req.mealItems.length > 0) return req;
  const profile = getCachedUserProfile();
  const engine = resolvePersonaEngine(profile);
  const hints: string[] = [...req.cuisineHints];
  const meals: string[] = [...req.mealItems];
  const diet = [
    ...(engine.preferences?.dietaryRestrictions ?? []),
    ...(profile?.dietaryTags ?? []),
  ]
    .join(' ')
    .toLowerCase();
  const blob = [
    diet,
    ...(engine.preferences?.dislikes ?? []),
    profile?.personaEngine?.preferences
      ? JSON.stringify(profile.personaEngine.preferences)
      : '',
  ]
    .join(' ')
    .toLowerCase();

  if (/vegetar|vegan/.test(diet)) hints.push('vegetar');
  if (/itali|pizza/.test(blob)) {
    hints.push('itali');
    meals.push('pizza');
  }
  if (/burger|amerikan/.test(blob)) {
    hints.push('burger');
    meals.push('burger');
  }
  if (/griech|gyros/.test(blob)) hints.push('griech');
  if (/asiat|sushi|thai|viet/.test(blob)) hints.push('asiat');
  if (/fisch|seafood/.test(blob)) hints.push('fisch');

  return {
    ...req,
    cuisineHints: [...new Set(hints)],
    mealItems: [...new Set(meals)],
  };
}

/**
 * Harte Gates vor Top-2: offen, lange genug offen, Bewertung, Preis.
 */
function applyDiningHardFilters(
  ranked: DiningCandidate[],
  req: DiningRequest,
): DiningCandidate[] {
  let list = ranked.filter((c) => {
    if (c.openAtTarget === 'no') return false;
    if (c.rating != null && c.rating < MIN_RATING) return false;
    if (c.budgetFit === 'over') return false;
    return true;
  });
  // Wenn zu streng gefiltert: Budget-Stretch erlauben, Over weiter raus
  if (list.length < 2) {
    list = ranked.filter((c) => {
      if (c.openAtTarget === 'no') return false;
      if (c.rating != null && c.rating < MIN_RATING) return false;
      if (c.budgetFit === 'over') return false;
      return true;
    });
  }
  // Noch dünn: unknown open erlauben, aber Rating halten
  if (list.length < 2) {
    list = ranked.filter(
      (c) =>
        c.openAtTarget !== 'no' &&
        (c.rating == null || c.rating >= MIN_RATING) &&
        c.budgetFit !== 'over',
    );
  }
  return list.length ? list : ranked;
}

function whyGoThere(c: DiningCandidate, req: DiningRequest, isFav: boolean): string {
  const bits: string[] = [];
  if (isFav) bits.push('mein Favorit für dich');
  else bits.push('starke Alternative');

  if (c.rating != null && c.rating >= 4.3) {
    bits.push(`sehr gut bewertet (${c.rating.toFixed(1)})`);
  } else if (c.rating != null) {
    bits.push(`${c.rating.toFixed(1)} Sterne`);
  }

  if (c.specialties[0]) {
    bits.push(`besonders: ${c.specialties[0]}`);
  } else if (c.insider) {
    bits.push(c.insider.slice(0, 70));
  } else if (c.hasView || c.hasTerrace) {
    bits.push(c.hasView ? 'mit Aussicht' : 'mit Terrasse');
  } else {
    const kw = cuisineKeyword(req);
    bits.push(
      kw
        ? `passt zu deinem Geschmack (${kw})`
        : 'sitzt gut für ein entspanntes Essen',
    );
  }

  if (c.openAtTarget === 'yes') {
    bits.push(`offen gegen ${req.targetTimeLabel}`);
  }
  if (c.budgetFit === 'in') bits.push('Preis passt zu dir');
  else if (c.budgetFit === 'stretch') bits.push('Preis knapp drüber, aber ok');

  if (c.distanceM < 1500) bits.push(`nur ${c.walkMin} Minuten von dir`);
  else if (c.distanceM < 5000)
    bits.push(`circa ${(c.distanceM / 1000).toFixed(1)} Kilometer`);

  return bits.slice(0, 4).join(' — ');
}

async function fetchSunsetMs(lat: number, lng: number): Promise<number | null> {
  try {
    const { fetchOpenWeatherOneCall } = await import(
      '../weather/openWeatherOneCall'
    );
    const owm = await fetchOpenWeatherOneCall({ lat, lng });
    return owm?.sunsetMs ?? null;
  } catch {
    return null;
  }
}

function isBakeryBlob(blob: string): boolean {
  return BAKERY_RE.test(blob);
}

function isNonSitDownPlace(p: {
  name: string;
  types?: string[] | null;
}): boolean {
  if (isBakeryBlob(p.name)) return true;
  const types = (p.types ?? []).join(' ').toLowerCase();
  if (NON_SITDOWN_TYPES_RE.test(types) && !/\brestaurant\b/i.test(types)) {
    return true;
  }
  return false;
}

function isSitDownDinnerPoi(poi: Poi, facts: string[], wantsTakeaway: boolean): boolean {
  const cat = (poi.category ?? '').toLowerCase();
  const tags = parseTagsJson(poi.tags_json).join(' ').toLowerCase();
  const name = poi.name.toLowerCase();
  const blob = `${cat} ${tags} ${name} ${facts.join(' ').toLowerCase()}`;
  if (NON_GASTRO_RE.test(blob) || NON_GASTRO_RE.test(name)) return false;
  if (isBakeryBlob(blob)) return false;
  if (wantsTakeaway) {
    return /(restaurant|café|cafe|gastro|imbiss|gasthof|pizzeria|burger|bar|kneipe|bistro|snack|strandbar|takeaway)/i.test(
      blob,
    );
  }
  // Sit-down Abendessen: kein reines Cafe/Hotel ohne Gastro-Signal
  if (
    /(restaurant|gasthof|pizzeria|burger|bistro|imbiss|trattoria|steakhouse|brasserie)/i.test(
      blob,
    )
  ) {
    return true;
  }
  if (/\b(bar|kneipe|strandbar)\b/i.test(blob) && /essen|küche|speise|gastro/i.test(blob)) {
    return true;
  }
  if (/\bhotel\b/i.test(blob) && /(restaurant|gastro|speise|dining)/i.test(blob)) {
    return true;
  }
  // reines cafe ohne Restaurant-Signal → raus
  return false;
}

function isGastroPoi(poi: Poi): boolean {
  if (poi.kind === 'approach') return false;
  const cat = (poi.category ?? '').toLowerCase();
  const tags = parseTagsJson(poi.tags_json).join(' ').toLowerCase();
  const name = poi.name.toLowerCase();
  const blob = `${cat} ${tags} ${name}`;
  if (NON_GASTRO_RE.test(name) || NON_GASTRO_RE.test(blob)) return false;
  if (isBakeryBlob(blob)) return false;
  return /(restaurant|gastro|imbiss|gasthof|pizzeria|burger|bar|kneipe|bistro|snack|strandbar|café|cafe)/i.test(
    blob,
  );
}

function cuisineKeyword(req: DiningRequest): string | null {
  const hints = [...req.cuisineHints, ...req.mealItems].map((h) => h.toLowerCase());
  if (hints.some((h) => /burger|amerikan|american/.test(h))) return 'burger';
  if (hints.some((h) => /pizza|itali/.test(h))) return 'pizza';
  if (hints.some((h) => /griech|souvlaki|gyros/.test(h))) return 'griechisch';
  if (hints.some((h) => /fisch|seafood|krabben/.test(h))) return 'fisch restaurant';
  if (hints.some((h) => /asia|thai|sushi|vietnam/.test(h))) return 'asiatisch';
  if (hints.some((h) => /vegan|vegetar/.test(h))) return 'vegan';
  return hints[0] ?? null;
}

function matchesCuisine(c: DiningCandidate, req: DiningRequest): boolean {
  const kw = cuisineKeyword(req);
  if (!kw) return true;
  const blob = `${c.name} ${c.specialties.join(' ')} ${c.insider ?? ''}`.toLowerCase();
  const tokens = kw.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.some((t) => blob.includes(t))) return true;
  // soft: rating places without name match still allowed on expand pass if keyword search returned them
  return c.source === 'places' && tokens.length > 0;
}

function cashOnlyFromFacts(facts: string[]): boolean {
  return /\b(nur\s+bar|barzahlung|cash\s+only|kein(?:e)?\s+karte|keine\s+kartenzahlung)\b/i.test(
    facts.join(' '),
  );
}

function extractWarnings(facts: string[], wheelchairRequired: boolean): string[] {
  const out: string[] = [];
  if (cashOnlyFromFacts(facts)) out.push('nur Bargeld');
  if (
    wheelchairRequired &&
    /\b(nicht\s+barrierefrei|keine\s+rampe|stufen\s+nur|nicht\s+rollstuhl)\b/i.test(
      facts.join(' '),
    )
  ) {
    out.push('nicht barrierefrei');
  }
  return out;
}

function extractPriceLevel(facts: string[]): {
  level: DiningCandidate['priceLevel'];
  mealEur: number | null;
} {
  const joined = facts.join(' ').toLowerCase();
  if (/gehoben|fine dining|michelin|premium|\b(50|60|70)\s*€/.test(joined)) {
    return { level: 'high', mealEur: 55 };
  }
  if (/günstig|preiswert|budget|imbiss|\b(8|10|12|15)\s*€/.test(joined)) {
    return { level: 'low', mealEur: 15 };
  }
  const priceMatch = joined.match(/(?:ab|ca\.?|etwa)\s*(\d{1,2})\s*€/);
  if (priceMatch) {
    const n = Number(priceMatch[1]);
    return {
      level: n <= 18 ? 'low' : n <= 35 ? 'mid' : 'high',
      mealEur: n + 8,
    };
  }
  if (/mittel|bistro|à la carte/.test(joined)) {
    return { level: 'mid', mealEur: 32 };
  }
  return { level: 'unknown', mealEur: null };
}

function extractViewSignals(facts: string[], name: string): {
  hasView: boolean;
  hasTerrace: boolean;
} {
  const blob = `${name} ${facts.join(' ')}`.toLowerCase();
  return {
    hasView: /aussicht|meerblick|strandblick|panorama|promenade|blick\s+auf|sunset|sonnenuntergang/.test(
      blob,
    ),
    hasTerrace: /terrasse|außenbereich|aussenbereich|draußen|draussen|biergarten/.test(blob),
  };
}

function extractSpecialties(facts: string[]): string[] {
  const out: string[] = [];
  const joined = facts.join(' ');
  const patterns = [
    /(?:spezialität|spezialitaet|bekannt für|berühmt für|beruehmt für)[:\s]+([^.|]{4,60})/gi,
    /(?:serviert|bietet)\s+([^.|]{4,50})/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(joined)) !== null) {
      const s = m[1]?.trim();
      if (s && s.length > 3) out.push(s.slice(0, 55));
    }
  }
  return out.slice(0, 3);
}

function extractMenuUrl(facts: string[]): string | null {
  const joined = facts.join(' ');
  return (
    joined.match(/https?:\/\/[^\s|]+(?:speisekarte|menu|pdf)[^\s|]*/i)?.[0] ??
    joined.match(/https?:\/\/[^\s|]+\.pdf[^\s|]*/i)?.[0] ??
    null
  );
}

function openAtTargetTime(facts: string[], targetMin: number): 'yes' | 'unknown' | 'no' {
  const joined = facts.join(' ').toLowerCase();
  if (/heute\s+geschlossen|kitchen\s+closed|küche\s+geschlossen/.test(joined)) return 'no';
  const ranges: Array<{ open: number; close: number }> = [];
  const re = /(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(joined)) !== null) {
    const open = Number(m[1]) * 60 + Number(m[2]);
    const close = Number(m[3]) * 60 + Number(m[4]);
    if (close > open) ranges.push({ open, close });
    else ranges.push({ open, close: close + 24 * 60 });
  }
  if (!ranges.length) return 'unknown';
  if (ranges.some((r) => targetMin >= r.open && targetMin < r.close)) return 'yes';
  if (ranges.some((r) => r.open > targetMin && r.open - targetMin <= 90)) return 'unknown';
  return 'no';
}

function estimateMealCost(
  mealItems: string[],
  priceLevel: DiningCandidate['priceLevel'],
  mealEur: number | null,
): number | null {
  if (mealEur != null) return mealEur;
  let base = priceLevel === 'low' ? 14 : priceLevel === 'high' ? 48 : 28;
  if (mealItems.includes('burger')) base = Math.max(base, 16);
  if (mealItems.includes('bier')) base += 5;
  return mealItems.length || priceLevel !== 'unknown' ? base : null;
}

function budgetFit(
  estimated: number | null,
  budgetEur: number,
): { fit: DiningCandidate['budgetFit']; overEur: number | null } {
  if (estimated == null) return { fit: 'unknown', overEur: null };
  if (estimated <= budgetEur) return { fit: 'in', overEur: null };
  const over = estimated - budgetEur;
  if (over <= 12) return { fit: 'stretch', overEur: over };
  return { fit: 'over', overEur: over };
}

function foodKeywordBoost(text: string, blob: string): number {
  let boost = 0;
  const checks: Array<[RegExp, number]> = [
    [/\bburger\b/i, 28],
    [/\bgriech|mediterran\b/i, 24],
    [/\bpizza|itali/i, 20],
    [/\bfisch|seafood\b/i, 18],
    [/\bvegetar|vegan\b/i, 16],
    [/\bbiergarten|bier\b/i, 12],
  ];
  for (const [re, pts] of checks) {
    if (re.test(text) && re.test(blob)) boost += pts;
  }
  return boost;
}

function shortName(poi: Poi): string {
  return poi.name.replace(/\s*[·•|]\s*Wegweiser\s*$/i, '').trim();
}

function scoreCandidate(
  c: Omit<DiningCandidate, 'score' | 'scoreReasons'>,
  req: DiningRequest,
  text: string,
  mealBudget: number,
): { score: number; reasons: string[] } {
  let score = 50;
  const reasons: string[] = [];

  if (c.rating != null) {
    const rPts = Math.round((c.rating - 3.5) * 20);
    score += rPts;
    if (c.rating >= 4.3) reasons.push(`★ ${c.rating.toFixed(1)}`);
  }
  if (c.hotelWalkMin != null) {
    score -= c.hotelWalkMin;
    if (c.hotelWalkMin <= 8) reasons.push(`${c.hotelWalkMin} Minuten vom Hotel`);
  } else {
    score -= c.walkMin * 0.7;
    if (c.walkMin <= 10) reasons.push(`${c.walkMin} Minuten entfernt`);
  }
  if (c.openAtTarget === 'yes') {
    score += 12;
    reasons.push(`offen ~${req.targetTimeLabel}`);
  } else if (c.openAtTarget === 'no') score -= 25;

  if (req.wantsView && c.hasView && !req.wantsSeparateViewpoint) {
    score += 18;
    reasons.push('Aussicht');
  }
  if ((req.wantsTerrace || req.wantsSunset) && c.hasTerrace && !req.wantsSeparateViewpoint) {
    score += 14;
    reasons.push('Terrasse');
  }
  if (req.wantsSunset && c.hasView && !req.wantsSeparateViewpoint) score += 8;

  const blob = `${c.name} ${c.specialties.join(' ')} ${c.insider ?? ''}`;

  // To-go: Imbiss/Bistro/Burger bevorzugen; Transit-Namen hart abwerten
  if (TRANSIT_NAME_RE.test(c.name)) {
    score -= 80;
    reasons.push('kein Gastro-Spot');
  }
  if (req.wantsTakeaway) {
    if (
      /\b(imbiss|bistro|burger|snack|strandbar|pommes|fischbrötchen|to\s*go|takeaway)\b/i.test(
        blob,
      )
    ) {
      score += 22;
      reasons.push('gut zum Mitnehmen');
    }
    if (c.reservationNeeded) score -= 10;
    if (c.priceLevel === 'high') score -= 8;
  }

  score += foodKeywordBoost(text, blob);

  if (c.budgetFit === 'in') score += 12;
  else if (c.budgetFit === 'stretch') score += 4;
  else if (c.budgetFit === 'over') score -= 8;

  if (c.insider) score += 8;
  if (c.eveningEvent) score += 14;
  if (c.reservationNeeded && req.partySize != null) score += 4;

  return { score, reasons: reasons.slice(0, 4) };
}

function matchEveningEvent(
  name: string,
  events: EventResearchResult | null,
): string | null {
  if (!events?.events.length) return null;
  const lower = name.toLowerCase();
  for (const e of events.events) {
    const venue = e.venue.toLowerCase();
    if (!venue || venue.length < 4) continue;
    if (lower.includes(venue) || venue.includes(lower.slice(0, 8))) {
      return e.title + (e.startTime ? ` (${e.startTime})` : '');
    }
  }
  return null;
}

async function collectPackCandidates(
  anchor: { lat: number; lng: number },
  hotel: { lat: number; lng: number } | null,
  req: DiningRequest,
  text: string,
  mealBudget: number,
  budgetCategory: BudgetCategory,
  events: EventResearchResult | null,
): Promise<DiningCandidate[]> {
  const profile = getCachedUserProfile();
  const engine = resolvePersonaEngine(profile);
  const pois = (await getAllPois()).filter(isGastroPoi);
  const out: DiningCandidate[] = [];

  for (const poi of pois) {
    const name = shortName(poi);
    if (req.excludeNames.some((x) => name.toLowerCase().includes(x.toLowerCase()))) continue;

    const filter = evaluatePoiForProfile(poi, profile, {
      userLat: anchor.lat,
      userLng: anchor.lng,
    });
    if (!filter.allowed && filter.reason === 'wheelchair_inaccessible') continue;

    const distanceM = Math.round(haversineMeters(anchor.lat, anchor.lng, poi.lat, poi.lng));
    if (distanceM > MAX_DIST_FROM_ANCHOR_M) continue;

    const facts = (await getFactsForPoi(poi.id)).map((f) => f.fact_text);
    if (!isSitDownDinnerPoi(poi, facts, req.wantsTakeaway)) continue;

    const openAtTarget = openAtTargetTime(facts, req.targetTimeMin);
    if (openAtTarget === 'no') continue;

    const closeMin = extractCloseMinutesFromFacts(facts);
    const etaPreview = estimateTravelEta({
      userLat: anchor.lat,
      userLng: anchor.lng,
      destLat: poi.lat,
      destLng: poi.lng,
      destName: name,
    });
    const arrivalMin = req.targetTimeMin;
    if (
      !req.wantsTakeaway &&
      !closingTimeAllowsStay(arrivalMin, closeMin, DEFAULT_MEAL_STAY_MIN)
    ) {
      continue;
    }

    const { hasView, hasTerrace } = extractViewSignals(facts, name);
    const { level, mealEur } = extractPriceLevel(facts);
    const estimated = estimateMealCost(req.mealItems, level, mealEur);
    const { fit, overEur } = budgetFit(estimated, mealBudget);
    const resInfo = buildPoiReservationInfo(poi, facts);
    const tiers = resolveReservationTier(resInfo, profile);
    const warnings = extractWarnings(
      facts,
      !!engine.accessibility.wheelchairRequired,
    );

    const hotelDistM = hotel
      ? Math.round(haversineMeters(hotel.lat, hotel.lng, poi.lat, poi.lng))
      : null;

    const eta = etaPreview;

    const base: Omit<DiningCandidate, 'score' | 'scoreReasons'> = {
      name,
      lat: poi.lat,
      lng: poi.lng,
      poiId: poi.id,
      distanceM,
      walkMin: eta.totalMinutes,
      distanceFromHotelM: hotelDistM,
      hotelWalkMin: hotelDistM != null ? walkMin(hotelDistM) : null,
      rating: null,
      openAtTarget,
      hoursHint:
        facts.find((f) => /\d{1,2}[:.]\d{2}/.test(f))?.slice(0, 80) ?? null,
      insider: facts.find((f) => f.length > 35 && f.length < 160) ?? null,
      hasView,
      hasTerrace,
      priceLevel: level,
      estimatedMealEur: estimated,
      budgetFit: fit,
      budgetOverEur: overEur,
      wheelchairOk: !engine.accessibility.wheelchairRequired || filter.allowed,
      specialties: extractSpecialties(facts),
      menuUrl: extractMenuUrl(facts),
      reservationNeeded: tiers.length > 0 || /reservier/i.test(facts.join(' ')),
      eveningEvent: matchEveningEvent(name, events),
      source: 'pack',
      warnings,
      closeMin,
    };

    const { score, reasons } = scoreCandidate(base, req, text, mealBudget);
    out.push({ ...base, score, scoreReasons: reasons });
  }

  return out;
}

const RURAL_SUBURB_RE =
  /prisdorf|priesdorf|prießdorf|appen|heister|tornesch|uetersen/i;
/** Feste Pinneberg-Mitte — Geocode-Ausfall darf Expand nicht killen. */
const PINNEBERG_ANCHOR = { lat: 53.6616, lng: 9.7986, label: 'Pinneberg' };

async function collectPlacesCandidates(
  anchor: { lat: number; lng: number },
  hotel: { lat: number; lng: number } | null,
  req: DiningRequest,
  text: string,
  mealBudget: number,
  events: EventResearchResult | null,
  opts?: { keyword?: string | null; radiusM?: number; cityHint?: string | null },
): Promise<DiningCandidate[]> {
  let places: DiscoveredPlace[] = [];
  const radiusM = opts?.radiusM ?? 8_000;
  const keyword =
    (opts?.keyword ?? cuisineKeyword(req) ?? 'restaurant').trim() ||
    'restaurant';
  const cityHint =
    opts?.cityHint ??
    text.match(
      /\bin\s+([A-ZÄÖÜ][a-zäöüß]{2,}(?:\s+[A-ZÄÖÜ][a-zäöüß]+){0,2})\b/u,
    )?.[1] ??
    null;
  try {
    const placeType = req.wantsTakeaway ? 'meal_takeaway' : 'restaurant';
    // 1) Text Search zuerst (Nearby+keyword ist oft ZERO_RESULTS)
    if (hasGoogleMapsNavKey()) {
      const q = [
        keyword === 'restaurant' ? 'Restaurant' : keyword,
        cityHint,
      ]
        .filter(Boolean)
        .join(' ')
        .trim() || 'Restaurant';
      places = await searchPlacesByText({
        query: q,
        lat: anchor.lat,
        lng: anchor.lng,
        radiusM: Math.max(radiusM, 8_000),
      }).catch(() => [] as DiscoveredPlace[]);
    }

    // 2) Nearby ohne openNow (Abend-Empfehlung ≠ gerade geöffnet)
    if (places.length < 2 && hasGoogleMapsNavKey()) {
      const nearby = await searchOpenPlacesAhead({
        lat: anchor.lat,
        lng: anchor.lng,
        placeType,
        radiusM,
        openNow: false,
        keyword: keyword === 'restaurant' ? null : keyword,
      }).catch(() => [] as DiscoveredPlace[]);
      const seen = new Set(places.map((p) => p.name.toLowerCase()));
      for (const p of nearby) {
        if (seen.has(p.name.toLowerCase())) continue;
        seen.add(p.name.toLowerCase());
        places.push(p);
      }
    }

    // 3) OSM-Fallback wenn Google leer / Key fehlt
    if (places.length < 2) {
      try {
        const { searchOsmPlacesNearby } = await import(
          '../navigation/overpassService'
        );
        const osm = await searchOsmPlacesNearby({
          lat: anchor.lat,
          lng: anchor.lng,
          placeType: 'restaurant',
          radiusM: Math.min(Math.max(radiusM, 2_000), 5_000),
        }).catch(() => []);
        const seen = new Set(places.map((p) => p.name.toLowerCase()));
        for (const p of osm) {
          if (seen.has(p.name.toLowerCase())) continue;
          seen.add(p.name.toLowerCase());
          places.push({
            placeId: p.placeId,
            name: p.name,
            types: p.types ?? ['restaurant'],
            lat: p.lat,
            lng: p.lng,
            distanceM: p.distanceM,
            rating: null,
            openNow: true,
          });
        }
      } catch {
        /* soft */
      }
    }
  } catch {
    return [];
  }

  const out: DiningCandidate[] = [];
  const seen = new Set<string>();

  for (const p of places) {
    const key = p.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (TRANSIT_NAME_RE.test(p.name) || NON_GASTRO_RE.test(p.name)) continue;
    if (isNonSitDownPlace(p)) continue;
    if (req.excludeNames.some((x) => key.includes(x.toLowerCase()))) continue;
    // Unbewertet (OSM) ok; harte 3.8-Grenze erst bei genug Auswahl
    if (p.rating != null && p.rating < 3.5) continue;

    const hotelDistM = hotel
      ? Math.round(haversineMeters(hotel.lat, hotel.lng, p.lat, p.lng))
      : null;
    if (p.distanceM > radiusM + 500) continue;

    const eta = estimateTravelEta({
      userLat: anchor.lat,
      userLng: anchor.lng,
      destLat: p.lat,
      destLng: p.lng,
      destName: p.name,
    });
    const travelMin =
      p.distanceM >= 3000
        ? Math.max(8, Math.round((p.distanceM / 1000 / 40) * 60) + 5)
        : eta.totalMinutes;

    const estimated =
      p.rating != null && p.rating >= 4.3 ? mealBudget + 8 : mealBudget - 2;
    const { fit, overEur } = budgetFit(estimated, mealBudget);

    const base: Omit<DiningCandidate, 'score' | 'scoreReasons'> = {
      name: p.name,
      lat: p.lat,
      lng: p.lng,
      poiId: null,
      distanceM: p.distanceM,
      walkMin: travelMin,
      distanceFromHotelM: hotelDistM,
      hotelWalkMin: hotelDistM != null ? walkMin(hotelDistM) : null,
      rating: p.rating,
      openAtTarget: p.openNow === false ? 'no' : p.openNow === true ? 'yes' : 'unknown',
      hoursHint:
        p.openNow === false
          ? 'laut Maps gerade zu'
          : p.openNow === true
            ? 'laut Maps gerade offen'
            : null,
      insider: null,
      hasView: /promenade|terrasse|aussicht|meer|strand|blick/i.test(p.name),
      hasTerrace: /terrasse|garten|promenade|beach/i.test(p.name),
      priceLevel: p.rating != null && p.rating >= 4.4 ? 'mid' : 'unknown',
      estimatedMealEur: estimated,
      budgetFit: fit,
      budgetOverEur: overEur,
      wheelchairOk: true,
      specialties: [],
      menuUrl: null,
      reservationNeeded: false,
      eveningEvent: matchEveningEvent(p.name, events),
      source: 'places',
      warnings: [],
      closeMin: null,
    };

    const { score, reasons } = scoreCandidate(base, req, text, mealBudget);
    if (p.rating != null && p.rating >= LOW_RATING_THRESHOLD) {
      reasons.unshift(`★ ${p.rating.toFixed(1)}`);
    }
    out.push({ ...base, score, scoreReasons: reasons });
  }

  return out;
}

/** Nachbarort / größerer Radius wenn lokal zu wenig Sit-down — immer vom GPS-Anker. */
async function expandCuisineSearch(
  anchor: { lat: number; lng: number },
  hotel: { lat: number; lng: number } | null,
  req: DiningRequest,
  text: string,
  mealBudget: number,
  events: EventResearchResult | null,
  cityName: string | null | undefined,
): Promise<{ candidates: DiningCandidate[]; expandLabel: string | null }> {
  const kw = cuisineKeyword(req) ?? 'restaurant';
  const collected: DiningCandidate[] = [];
  let expandLabel: string | null = null;

  // Max 2 Ringe — Memory-Küche darf NICHT 6×50km sequentiell triggern
  const ringsForQuery = ([3_500, 8_000] as const);
  for (const ring of ringsForQuery) {
    const batch = await collectPlacesCandidates(
      anchor,
      hotel,
      req,
      text,
      mealBudget,
      events,
      { keyword: kw, radiusM: ring },
    );
    for (const c of batch) {
      if (!collected.some((x) => x.name.toLowerCase() === c.name.toLowerCase())) {
        collected.push(c);
      }
    }
    if (collected.length >= 2) {
      const farthest = Math.max(...collected.map((c) => c.distanceM));
      expandLabel =
        farthest >= FAR_SPEECH_M
          ? `weiterem Umkreis (bis etwa ${Math.round(farthest / 1000)} Kilometer)`
          : cityName
            ? `Umgebung von deinem Standort`
            : 'der Umgebung';
      break;
    }
  }

  // Nachbarorte / 50km-Last-Resort entfallen auf dem Critical Path —
  // lieber schnell antworten als Minuten warten.

  collected.sort((a, b) => a.distanceM - b.distanceM || b.score - a.score);
  return {
    candidates: collected,
    expandLabel:
      expandLabel ??
      (collected.length
        ? 'weiterem Umkreis'
        : 'bis etwa 8 Kilometer'),
  };
}

function mergeCandidates(pack: DiningCandidate[], places: DiningCandidate[]): DiningCandidate[] {
  const byName = new Map<string, DiningCandidate>();
  for (const c of [...pack, ...places]) {
    const key = c.name.toLowerCase().replace(/\s+/g, ' ').trim();
    const prev = byName.get(key);
    if (!prev || c.score > prev.score) {
      if (prev?.poiId != null && c.poiId == null) {
        byName.set(key, { ...c, poiId: prev.poiId, insider: prev.insider ?? c.insider });
      } else {
        byName.set(key, c);
      }
    }
  }
  return [...byName.values()].sort((a, b) => b.score - a.score);
}

async function findViewpointSpot(
  anchor: { lat: number; lng: number },
  food: DiningCandidate | null,
): Promise<{
  name: string;
  lat: number;
  lng: number;
  poiId: number | null;
  distanceM: number;
  walkMin: number;
} | null> {
  const pois = await getAllPois();
  type Cand = {
    name: string;
    lat: number;
    lng: number;
    poiId: number;
    distanceM: number;
    walkMin: number;
    score: number;
  };
  const cands: Cand[] = [];
  for (const p of pois) {
    if (p.kind === 'approach') continue;
    const name = shortName(p);
    if (TRANSIT_NAME_RE.test(name)) continue;
    if (!VIEWPOINT_NAME_RE.test(name)) {
      const tags = parseTagsJson(p.tags_json).join(' ').toLowerCase();
      const cat = (p.category ?? '').toLowerCase();
      if (!VIEWPOINT_NAME_RE.test(`${tags} ${cat}`)) continue;
    }
    const distFromUser = Math.round(
      haversineMeters(anchor.lat, anchor.lng, p.lat, p.lng),
    );
    if (distFromUser > 5000) continue;
    let score = 40;
    if (/jever|aussichtsplattform|leuchtturm|weststrand|düne|duene/i.test(name)) {
      score += 35;
    }
    if (/aussicht|plattform|panorama/i.test(name)) score += 20;
    if (food) {
      const fromFood = Math.round(
        haversineMeters(food.lat, food.lng, p.lat, p.lng),
      );
      // Ideal: 0.5–2.5 km vom To-go-Stop
      if (fromFood >= 400 && fromFood <= 2800) score += 25;
      else if (fromFood < 200) score -= 15;
      else score -= Math.min(20, Math.floor(fromFood / 400));
    }
    score -= Math.floor(distFromUser / 200);
    cands.push({
      name,
      lat: p.lat,
      lng: p.lng,
      poiId: p.id,
      distanceM: food
        ? Math.round(haversineMeters(food.lat, food.lng, p.lat, p.lng))
        : distFromUser,
      walkMin: walkMin(
        food
          ? Math.round(haversineMeters(food.lat, food.lng, p.lat, p.lng))
          : distFromUser,
      ),
      score,
    });
  }
  cands.sort((a, b) => b.score - a.score);
  const best = cands[0];
  if (!best) return null;
  return {
    name: best.name,
    lat: best.lat,
    lng: best.lng,
    poiId: best.poiId,
    distanceM: best.distanceM,
    walkMin: best.walkMin,
  };
}

function buildFavoriteReason(
  fav: DiningCandidate,
  req: DiningRequest,
  budgetCategory: BudgetCategory,
): string {
  const parts: string[] = [];
  const kw = cuisineKeyword(req);
  if (kw && /burger/i.test(kw) && fav.rating != null && fav.rating >= 4.2) {
    parts.push('einer der starken Burger-Tipps hier');
  } else if (fav.rating != null && fav.rating >= 4.3) {
    parts.push('starke Bewertung');
  }
  if (fav.specialties[0]) {
    parts.push(`Spezialität: ${fav.specialties[0]}`);
  } else if (fav.insider) {
    parts.push(fav.insider.slice(0, 80));
  } else {
    parts.push('richtiges Restaurant zum Abendessen — kein Bäcker/Café');
  }
  if (fav.specialties[1]) parts.push(fav.specialties[1]);
  if (fav.hasView || fav.hasTerrace) parts.push('gute Location');
  if (fav.eveningEvent) parts.push(`danach ${fav.eveningEvent}`);
  if (fav.budgetFit === 'over' && fav.budgetOverEur) {
    parts.push(`etwas über ${budgetCategory}-Budget (+${fav.budgetOverEur} €)`);
  }
  if (!parts.length) parts.push('passt zu deinem Abend');
  return parts.slice(0, 3).join(' · ');
}

function describeOption(c: DiningCandidate, isFav: boolean): string {
  const bits: string[] = [];
  if (isFav) bits.push('mein Favorit');
  else bits.push('gute Alternative');
  if (c.rating != null) bits.push(`${c.rating.toFixed(1)} Sterne`);
  if (c.specialties[0]) bits.push(c.specialties[0]);
  if (c.warnings?.length) bits.push(`Hinweis: ${c.warnings.join(', ')}`);
  if (c.distanceM >= FAR_SPEECH_M) {
    bits.push(
      `circa ${(c.distanceM / 1000).toFixed(0)} Kilometer / etwa ${c.walkMin} Minuten Fahrt`,
    );
  } else if (c.distanceM >= 3000) {
    bits.push(`circa ${(c.distanceM / 1000).toFixed(1)} Kilometer`);
  } else {
    bits.push(`${c.walkMin} Minuten von dir`);
  }
  return bits.join(' — ');
}

function minutesUntilTarget(targetTimeMin: number): number {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  let delta = targetTimeMin - nowMin;
  if (delta < -6 * 60) delta += 24 * 60;
  return delta;
}

function buildDiningNavOrReminderActions(
  places: DiningCandidate[],
  req: DiningRequest,
): QuickAction[] {
  // Vorschlagsphase: Speisekarte / Web / Auswahl — Route erst nach User-Pick
  const actions: QuickAction[] = [];
  for (const p of places.slice(0, DUAL_OPTION_MAX)) {
    if (p.menuUrl) {
      actions.push({
        type: 'OPEN_URL',
        label: clampDualLabel(`🍽 ${p.name}`),
        payload: { url: p.menuUrl, destName: p.name },
      });
    } else {
      actions.push({
        type: 'SHOW_MORE',
        label: clampDualLabel(`✅ ${p.name}`),
        payload: {
          textPrompt: `Ich nehme ${p.name} fürs Abendessen — Speisekarte und Details`,
          destName: p.name,
          destLat: p.lat,
          destLng: p.lng,
          targetPoiId: p.poiId ?? undefined,
        },
      });
    }
  }

  const minsUntil = minutesUntilTarget(req.targetTimeMin);
  const fav = places[0];
  const eta = fav?.walkMin ?? 15;
  const leaveBuffer = 10;
  const shouldDeferNav = minsUntil > eta + leaveBuffer + 30;

  if (shouldDeferNav && fav && actions.length < DUAL_OPTION_MAX) {
    const leaveMin = Math.max(0, req.targetTimeMin - eta - leaveBuffer);
    const leaveH = Math.floor(leaveMin / 60) % 24;
    const leaveM = leaveMin % 60;
    const leaveLabel = `${String(leaveH).padStart(2, '0')}:${String(leaveM).padStart(2, '0')}`;
    const leaveDate = new Date();
    leaveDate.setHours(leaveH, leaveM, 0, 0);
    if (leaveDate.getTime() < Date.now()) {
      leaveDate.setDate(leaveDate.getDate() + 1);
    }
    actions.push({
      type: 'SET_DEPARTURE_REMINDER',
      label: clampDualLabel(`⏰ Losgehen ~${leaveLabel}`),
      payload: {
        dateIso: leaveDate.toISOString(),
        destName: fav.name,
        destLat: fav.lat,
        destLng: fav.lng,
        targetPoiId: fav.poiId ?? undefined,
      },
    });
  }

  return actions.slice(0, DUAL_OPTION_MAX);
}

/** To-go + separater Sunset-Spot → Speech + Multi-Route Buttons überschreiben. */
function applyCompoundTakeawaySunset(
  result: EveningDiningResult,
  viewpoint: {
    name: string;
    lat: number;
    lng: number;
    poiId: number | null;
    distanceM: number;
    walkMin: number;
  },
  req: DiningRequest,
): EveningDiningResult {
  const favorite = result.favorite;
  if (!favorite) return result;
  const km = (viewpoint.distanceM / 1000).toFixed(1);
  let speech =
    `Perfekt für To-go und Sunset: Hol dir was bei ${favorite.name}` +
    (favorite.specialties[0] ? ` (${favorite.specialties[0]})` : '') +
    ` — gut zum Mitnehmen` +
    (favorite.walkMin ? `, circa ${favorite.walkMin} Minuten von dir` : '') +
    `. Danach weiter zur ${viewpoint.name}` +
    (viewpoint.distanceM >= 300
      ? ` — etwa ${km} Kilometer / ${viewpoint.walkMin} Minuten zu Fuß`
      : '') +
    `. `;
  if (result.sunsetLabel) {
    speech += `Sonnenuntergang ist gegen ${result.sunsetLabel} Uhr. `;
  }
  speech += 'Welchen Stop starten wir zuerst?';

  const bullets = [
    `🍔 ${favorite.name}`,
    `🌅 ${viewpoint.name} · ${viewpoint.walkMin} Min vom Essen`,
    ...(result.sunsetLabel ? [`Sonnenuntergang ~${result.sunsetLabel}`] : []),
    ...result.response.visualBullets.slice(0, 2),
  ];

  const quickActions: QuickAction[] = [
    {
      type: 'START_NAVIGATION',
      label: shortenActionLabel(`📍 ${favorite.name}`),
      payload: {
        destLat: favorite.lat,
        destLng: favorite.lng,
        destName: favorite.name,
        targetPoiId: favorite.poiId ?? undefined,
      },
    },
    {
      type: 'START_NAVIGATION',
      label: shortenActionLabel(`🌅 ${viewpoint.name}`),
      payload: {
        destLat: viewpoint.lat,
        destLng: viewpoint.lng,
        destName: viewpoint.name,
        targetPoiId: viewpoint.poiId ?? undefined,
      },
    },
    {
      type: 'SHOW_MORE',
      label: shortenActionLabel('📍 Essen→View'),
      payload: {
        textPrompt: `Starte Multi-Stop: erst ${favorite.name}, dann ${viewpoint.name}`,
        multiStop: [
          {
            name: favorite.name,
            lat: favorite.lat,
            lng: favorite.lng,
            poiId: favorite.poiId ?? undefined,
          },
          {
            name: viewpoint.name,
            lat: viewpoint.lat,
            lng: viewpoint.lng,
            poiId: viewpoint.poiId ?? undefined,
          },
        ],
      },
    },
  ];
  if (favorite.menuUrl) {
    quickActions.push({
      type: 'OPEN_URL',
      label: 'Webseite: Speisekarte',
      payload: { url: favorite.menuUrl },
    });
  }

  return {
    ...result,
    promptBlock:
      result.promptBlock +
      `\nCompound: Essen=${favorite.name} → Aussicht=${viewpoint.name} (${viewpoint.walkMin} Min)` +
      (req.wantsTakeaway ? '\nModus: To-go' : ''),
    response: {
      speechText: speech.replace(/\s+/g, ' ').trim(),
      visualBullets: bullets.slice(0, 5),
      quickActions: quickActions.slice(0, 4),
      cardTitle: 'To-go + Sunset',
    },
  };
}

function buildResponse(input: {
  ranked: DiningCandidate[];
  req: DiningRequest;
  sunsetLabel: string | null;
  sunsetMs: number | null;
  mealBudgetEur: number;
  budgetCategory: BudgetCategory;
  anchorLabel: string;
  nowLabel: string;
  expandLabel?: string | null;
  userText?: string;
}): EveningDiningResult {
  const {
    ranked,
    req,
    sunsetLabel,
    sunsetMs,
    mealBudgetEur,
    budgetCategory,
    anchorLabel,
    nowLabel,
    expandLabel,
    userText = '',
  } = input;
  const top = ranked.slice(0, DUAL_OPTION_MAX);
  const favorite = top[0] ?? null;
  const alternative = top[1] ?? null;

  let speech: string;
  if (!favorite) {
    // Ohne Online-Ergebnis: nur Fallback — Online wird im Orchestrator vorher versucht
    const ringBit = expandLabel
      ? `Ich hab ${expandLabel} abgesucht`
      : 'Ich hab bis etwa 50 Kilometer abgesucht';
    speech =
      `${ringBit} und finde lokal nichts Passendes für heute Abend um ${req.targetTimeLabel}. ` +
      `Ich kann online weiterrecherchieren — tippe Weiter oder sag Küche/Budget.`;
    return {
      candidates: [],
      favorite: null,
      sunsetLabel,
      mealBudgetEur,
      budgetCategory,
      anchorLabel,
      promptBlock: '=== DINING ===\nKeine Kandidaten — Expand leer',
      response: {
        speechText: speech,
        visualBullets: [`Abend ~${req.targetTimeLabel}`, anchorLabel],
        quickActions: [
          {
            type: 'SHOW_MORE',
            label: shortenActionLabel('🔍 Weiter'),
            payload: {
              textPrompt:
                'Such bitte online weiter nach Restaurants für heute Abend — Wunsch erfüllen',
            },
          },
          {
            type: 'SHOW_MORE',
            label: shortenActionLabel('🍽 Andere Küche'),
            payload: {
              textPrompt:
                'Andere Küche oder Budget fürs Abendessen — such nochmal mit Expand und Online',
            },
          },
        ],
        cardTitle: 'Abend-Essen',
      },
    };
  }

  const favReason = whyGoThere(favorite, req, true);
  const altReason = alternative ? whyGoThere(alternative, req, false) : null;
  const minsUntil = minutesUntilTarget(req.targetTimeMin);
  const deferNav = minsUntil > (favorite.walkMin ?? 15) + 40;
  const memoryCuisine = cuisineKeyword(req);

  speech =
    `Klar — ich hab bei Google Maps um dich herum geschaut` +
    `${req.targetTimeLabel ? ` für gegen ${req.targetTimeLabel}` : ''}. `;
  if (memoryCuisine && !/\b(itali|burger|pizza|griech|asiat|fisch|vegetar)/iu.test(userText)) {
    speech += `Weil du eher auf ${memoryCuisine} stehst, hab ich danach gefiltert. `;
  }
  if (expandLabel) {
    speech +=
      `Direkt hier war wenig Passendes — ich hab im ${expandLabel} weitergesucht. `;
  }

  speech += `Zwei Optionen: `;
  speech += `${favorite.name} — ${favReason}. `;
  if (altReason && alternative) {
    speech += `Oder ${alternative.name} — ${altReason}. `;
  }
  if (favorite.warnings?.length) {
    speech += `Hinweis bei ${favorite.name}: ${favorite.warnings.join(', ')}. `;
  }
  speech +=
    favorite.menuUrl
      ? 'Welchen nimmst du? Speisekarte liegt bereit. '
      : 'Welchen nehmen wir? Dann hole ich Speisekarte und Route. ';
  if (deferNav) {
    speech +=
      `Navigation starte ich noch nicht — sobald Ort fest ist, erinnere ich dich zum Losgehen. `;
  }

  const bullets = top.map((c, i) => {
    const dist =
      c.distanceM >= FAR_SPEECH_M
        ? `~${(c.distanceM / 1000).toFixed(0)} km`
        : c.distanceM >= 3000
          ? `~${(c.distanceM / 1000).toFixed(1)} km`
          : `${c.walkMin} Min`;
    const rating = c.rating != null ? ` · ★${c.rating.toFixed(1)}` : '';
    const spec = c.specialties[0] ? ` · ${c.specialties[0].slice(0, 28)}` : '';
    return `${i === 0 ? '⭐ ' : ''}${c.name} — ${dist}${rating}${spec}`;
  });

  if (sunsetLabel && req.wantsSunset) {
    bullets.push(`Sonnenuntergang ~${sunsetLabel}`);
  }

  const quickActions = buildDiningNavOrReminderActions(top, req);

  if (req.wantsSunsetReminder && sunsetMs != null && sunsetLabel) {
    const remindAt = sunsetMs - 30 * 60_000;
    if (remindAt > Date.now() + 60_000 && quickActions.length < DUAL_OPTION_MAX) {
      quickActions.push({
        type: 'SET_DEPARTURE_REMINDER',
        label: clampDualLabel(`⏰ Sunset ${sunsetLabel}`),
        payload: {
          dateIso: new Date(remindAt).toISOString(),
          destName: `Sonnenuntergang (~${sunsetLabel})`,
        },
      });
      void import('../notifications/notificationService')
        .then((m) =>
          m.scheduleFlightDepartureReminder({
            departureMs: sunsetMs,
            walkEtaMinutes: 30,
            flightLabel: `Sonnenuntergang (~${sunsetLabel})`,
            reminderKey: `sunset-${sunsetMs}`,
          }),
        )
        .catch(() => undefined);
    }
  }

  const promptBlock = [
    '=== EVENING DINING (VERIFIZIERT) ===',
    `Jetzt: ${nowLabel} · Zielzeit: ${req.targetTimeLabel}`,
    sunsetLabel ? `Sonnenuntergang: ${sunsetLabel}` : '',
    expandLabel ? `Expand: ${expandLabel}` : '',
    `Anker: ${anchorLabel} · Budget ${budgetCategory} (~${mealBudgetEur} €/Person)`,
    req.mealItems.length ? `Wunsch: ${req.mealItems.join(' + ')}` : '',
    `Top ${top.length}:`,
    ...top.map(
      (c, i) =>
        `${i + 1}) ${c.name} score=${c.score} ${c.scoreReasons.join(' · ')}` +
        (c.warnings?.length ? ` WARN ${c.warnings.join(',')}` : ''),
    ),
    `Favorit: ${favorite.name} — ${favReason}`,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    candidates: top,
    favorite,
    sunsetLabel,
    mealBudgetEur,
    budgetCategory,
    anchorLabel,
    promptBlock,
    response: {
      speechText: speech.replace(/\s+/g, ' ').trim(),
      visualBullets: bullets.slice(0, 5),
      quickActions: quickActions.slice(0, DUAL_OPTION_MAX),
      cardTitle: req.wantsSunset ? 'Abend mit Aussicht' : 'Abend-Essen',
    },
  };
}

/**
 * Haupt-Orchestrator für Abend-Essen-Empfehlungen.
 */
export async function runEveningDiningOrchestrator(
  userText: string,
  opts?: { eventResearch?: EventResearchResult | null },
): Promise<EveningDiningResult | null> {
  const store = useFinnusStore.getState();
  const profile = getCachedUserProfile();
  const engine = resolvePersonaEngine(profile);
  const budgetCategory = engine.budgetCategory ?? 'mittel';
  const mealBudgetEur = MEAL_BUDGET_EUR[budgetCategory];

  const hotel = useUserMemoryStore.getState().getConfirmedHotel(profile?.cityId);
  const gpsLat = store.lastGpsLat;
  const gpsLng = store.lastGpsLng;

  // Explizite Stadt im Text („in Pinneberg“) → dort suchen, nicht nur am GPS-Vorort.
  const cityFromText =
    userText.match(
      /\bin\s+([A-ZÄÖÜ][a-zäöüß]{2,}(?:\s+[A-ZÄÖÜ][a-zäöüß]+){0,2})\b/u,
    )?.[1] ?? null;
  let cityGeo: { lat: number; lng: number; label: string } | null = null;
  if (cityFromText) {
    try {
      const g = await geocodePlaceNameOsmFirst(cityFromText);
      if (g?.lat != null && g?.lng != null) {
        cityGeo = { lat: g.lat, lng: g.lng, label: cityFromText };
      }
    } catch {
      /* soft */
    }
  }

  // Essen-Suche: Stadt-Wunsch zuerst, sonst Live-GPS, sonst Hotel.
  const anchor =
    cityGeo ??
    (gpsLat != null && gpsLng != null
      ? { lat: gpsLat, lng: gpsLng, label: 'deinem Standort' }
      : hotel?.lat != null && hotel?.lng != null
        ? {
            lat: hotel.lat,
            lng: hotel.lng,
            label: `Unterkunft ${hotel.name ?? ''}`.trim(),
          }
        : null);

  if (!anchor) return null;

  // Request zuerst ohne Sunset-API parsen — Sunset nur wenn wirklich nötig
  let req = parseDiningRequest(userText, null);
  let sunsetMs: number | null = null;
  let sunsetLabel: string | null = null;
  if (req.wantsSunset || req.wantsSunsetReminder || req.wantsView) {
    sunsetMs = await fetchSunsetMs(anchor.lat, anchor.lng);
    sunsetLabel = sunsetMs != null ? formatClock(sunsetMs) : null;
    req = parseDiningRequest(userText, sunsetMs);
  } else {
    // Default Abendzeit ohne Weather-Roundtrip
    req = parseDiningRequest(userText, null);
  }
  req = enrichDiningRequestFromMemory(req);

  let events = opts?.eventResearch ?? null;
  // Event-Recherche NUR bei explizitem Party/Konzert — nicht bei jedem Abendessen/Sunset
  // (sonst blockiert Gemini+Search die Antwort unnötig lange).
  if (!events && /\b(party|konzert|live\s*musik|dj|veranstaltung|event)\b/iu.test(userText)) {
    try {
      events = await researchTodaysEvents(
        `Party Konzert Live-Musik heute abend ${profile?.cityName ?? ''}`,
      );
    } catch {
      events = null;
    }
  }

  const hotelCoords =
    hotel?.lat != null && hotel?.lng != null
      ? { lat: hotel.lat, lng: hotel.lng }
      : null;

  const diningT0 = Date.now();
  console.log(
    '[dining] start',
    userText.slice(0, 80),
    `maps=${hasGoogleMapsNavKey() ? 'yes' : 'NO'}`,
  );

  // Critical Path: Google Text Search (+ Nearby) — Pack parallel
  const placesPromise = collectPlacesCandidates(
    anchor,
    hotelCoords,
    req,
    userText,
    mealBudgetEur,
    events,
    {
      keyword: cuisineKeyword(req) ?? 'restaurant',
      radiusM: 8_000,
      cityHint: cityFromText ?? profile?.cityName ?? null,
    },
  );
  const packPromise = collectPackCandidates(
    anchor,
    hotelCoords,
    req,
    userText,
    mealBudgetEur,
    budgetCategory,
    events,
  ).catch(() => [] as DiningCandidate[]);

  const places = await placesPromise;
  console.log('[dining] places', places.length, `${Date.now() - diningT0}ms`);
  const pack = await Promise.race([
    packPromise,
    new Promise<DiningCandidate[]>((r) => setTimeout(() => r([]), 250)),
  ]);
  console.log('[dining] pack', pack.length, `${Date.now() - diningT0}ms`);

  void fetchCommunityPlaceTipsNear({
    lat: anchor.lat,
    lng: anchor.lng,
    radiusM: 3000,
    limit: 8,
  }).catch(() => undefined);

  let ranked = mergeCandidates(pack, places).filter(
    (c) => !TRANSIT_NAME_RE.test(c.name) && !NON_GASTRO_RE.test(c.name) && !isBakeryBlob(c.name),
  );

  let expandLabel: string | null = null;
  const cuisineSet = cuisineKeyword(req) != null;
  // Expand nur wenn lokal dünn — aber nicht nochmal dieselben leeren Maps-Ringe
  const needExpand = ranked.length < 2 && (places.length > 0 || pack.length > 0);
  if (needExpand) {
    console.log('[dining] expand start', `${Date.now() - diningT0}ms`);
    const cuisineHits = cuisineSet
      ? ranked.filter((c) => matchesCuisine(c, req))
      : ranked;
    const expanded = await expandCuisineSearch(
      anchor,
      hotelCoords,
      req,
      userText,
      mealBudgetEur,
      events,
      profile?.cityName,
    );
    console.log(
      '[dining] expand done',
      expanded.candidates.length,
      `${Date.now() - diningT0}ms`,
    );
    expandLabel = expanded.expandLabel;
    const merged = mergeCandidates(cuisineHits, expanded.candidates).filter(
      (c) =>
        !TRANSIT_NAME_RE.test(c.name) &&
        !NON_GASTRO_RE.test(c.name) &&
        !isBakeryBlob(c.name) &&
        c.distanceM <= 12_000,
    );
    const cuisineFiltered = cuisineSet
      ? merged.filter((c) => matchesCuisine(c, req))
      : merged;
    ranked = (cuisineFiltered.length ? cuisineFiltered : merged).sort(
      (a, b) => a.distanceM - b.distanceM || b.score - a.score,
    );
  } else if (ranked.length < 2) {
    console.log('[dining] skip expand rings — empty sources');
  } else if (cuisineSet) {
    // Soft: Memory-Küche nur umsortieren, nicht hart filtern (sonst Expand-Spirale)
    ranked = [...ranked].sort((a, b) => {
      const am = matchesCuisine(a, req) ? 1 : 0;
      const bm = matchesCuisine(b, req) ? 1 : 0;
      if (bm !== am) return bm - am;
      return b.score - a.score;
    });
  }

  ranked.sort((a, b) => b.score - a.score);
  ranked = applyDiningHardFilters(ranked, req);

  const nowLabel = formatClock(Date.now());

  // Ein schneller Text-Retry wenn immer noch leer — kein Geocode-Nachbar-Marathon
  if (ranked.length === 0) {
    try {
      const retryKw = cuisineKeyword(req) ?? 'restaurant';
      const textRetry = await searchPlacesByText({
        query: `${retryKw} Restaurant`,
        lat: anchor.lat,
        lng: anchor.lng,
        radiusM: 12_000,
      }).catch(() => [] as DiscoveredPlace[]);
      const mapped: DiningCandidate[] = [];
      for (const p of textRetry.slice(0, 8)) {
        if (TRANSIT_NAME_RE.test(p.name) || NON_GASTRO_RE.test(p.name)) continue;
        if (isBakeryBlob(p.name)) continue;
        const travelMin =
          p.distanceM >= 3000
            ? Math.max(8, Math.round((p.distanceM / 1000 / 40) * 60) + 5)
            : Math.max(1, Math.ceil(p.distanceM / WALK_M_PER_MIN));
        mapped.push({
          name: p.name,
          lat: p.lat,
          lng: p.lng,
          poiId: null,
          distanceM: p.distanceM,
          walkMin: travelMin,
          distanceFromHotelM: null,
          hotelWalkMin: null,
          rating: p.rating,
          openAtTarget: 'unknown',
          hoursHint: null,
          insider: null,
          hasView: false,
          hasTerrace: false,
          priceLevel: 'unknown',
          estimatedMealEur: mealBudgetEur,
          budgetFit: 'in',
          budgetOverEur: 0,
          wheelchairOk: true,
          specialties: [],
          menuUrl: null,
          reservationNeeded: false,
          eveningEvent: null,
          source: 'places',
          warnings: [],
          closeMin: null,
          score: 40 + (p.rating ?? 0) * 8,
          scoreReasons: ['Google Maps'],
        });
      }
      ranked = mapped.sort(
        (a, b) => a.distanceM - b.distanceM || b.score - a.score,
      );
      if (ranked.length) expandLabel = expandLabel ?? 'Textsuche';
    } catch {
      /* soft */
    }
  }

  // Immer noch leer → Pinneberg automatisch durchsuchen (nicht nur als Button vorschlagen)
  let autoTriedPinneberg = false;
  if (ranked.length === 0) {
    const where = cityFromText || profile?.cityName || 'der Nähe';
    const alreadyPinneberg =
      /pinneberg/i.test(where) || /pinneberg/i.test(cityFromText ?? '');
    const rural =
      RURAL_SUBURB_RE.test(where) ||
      RURAL_SUBURB_RE.test(profile?.cityName ?? '') ||
      RURAL_SUBURB_RE.test(anchor.label);
    if (!alreadyPinneberg && (rural || !cityFromText)) {
      try {
        autoTriedPinneberg = true;
        console.log('[dining] auto-expand Pinneberg');
        const near = await collectPlacesCandidates(
          PINNEBERG_ANCHOR,
          hotelCoords,
          req,
          'Restaurants in Pinneberg',
          mealBudgetEur,
          events,
          {
            keyword: cuisineKeyword(req) ?? 'restaurant',
            radiusM: 6_000,
            cityHint: 'Pinneberg',
          },
        );
        if (near.length) {
          ranked = near
            .map((c) => ({
              ...c,
              distanceM: Math.round(
                haversineMeters(anchor.lat, anchor.lng, c.lat, c.lng),
              ),
            }))
            .sort((a, b) => a.distanceM - b.distanceM);
          expandLabel = 'Pinneberg';
        }
      } catch {
        /* soft */
      }
    }
  }

  if (ranked.length === 0) {
    const cuisine = cuisineKeyword(req);
    const where = cityFromText || profile?.cityName || 'der Nähe';
    const alreadyPinneberg = /pinneberg/i.test(where);
    const nextCity = alreadyPinneberg ? 'Hamburg' : 'Pinneberg';
    const speech = alreadyPinneberg
      ? `In Pinneberg finde ich gerade keine klaren Restaurant-Treffer${
          cuisine ? ` für ${cuisine}` : ''
        }. Ich kann Richtung Hamburg weiter suchen — oder du nennst mir einen Namen, den ich einplane.`
      : autoTriedPinneberg
        ? `Lokal und in Pinneberg finde ich gerade keine klaren Restaurant-Treffer${
            cuisine ? ` für ${cuisine}` : ''
          }. Nenn mir einen Namen, den ich einplane — oder ich suche Richtung Hamburg.`
        : `In ${where} finde ich gerade keine klaren Restaurant-Treffer${
            cuisine ? ` für ${cuisine}` : ''
          }. Ich schaue parallel Richtung ${nextCity} — oder du nennst mir einen Namen.`;
    const tipCity = alreadyPinneberg || autoTriedPinneberg ? 'Hamburg' : nextCity;
    return {
      candidates: [],
      favorite: null,
      sunsetLabel,
      mealBudgetEur,
      budgetCategory,
      anchorLabel: anchor.label,
      promptBlock: [
        '=== EVENING DINING — LEER ===',
        `Expand: ${expandLabel ?? 'lokal'} leer`,
        `hasMapsKey: ${hasGoogleMapsNavKey() ? 'yes' : 'no'}`,
      ].join('\n'),
      response: {
        speechText: speech,
        visualBullets: [
          `Ort: ${where}`,
          cuisine ? `Küche: ${cuisine}` : 'Restaurant',
          `Tipp: ${tipCity} / Name`,
        ],
        quickActions: [
          {
            type: 'SHOW_MORE',
            label: shortenActionLabel(tipCity),
            payload: {
              textPrompt: `Such gut bewertete ${
                cuisine ?? ''
              } Restaurants in ${tipCity} für heute Abend`
                .replace(/\s+/g, ' ')
                .trim(),
            },
          },
          {
            type: 'SHOW_MORE',
            label: shortenActionLabel('Nochmal hier'),
            payload: {
              textPrompt: `Such nochmal Restaurants in ${where}`,
            },
          },
        ],
        cardTitle: 'Abend-Essen',
      },
    };
  }

  console.log(
    '[dining] done',
    ranked.length,
    `total ${Date.now() - diningT0}ms`,
    expandLabel ?? 'local',
  );

  let result = buildResponse({
    ranked,
    req,
    sunsetLabel,
    sunsetMs,
    mealBudgetEur,
    budgetCategory,
    anchorLabel: anchor.label,
    nowLabel,
    expandLabel,
    userText,
  });

  if (req.wantsSeparateViewpoint && result.favorite) {
    const viewpoint = await findViewpointSpot(
      { lat: anchor.lat, lng: anchor.lng },
      result.favorite,
    );
    if (viewpoint) {
      result = applyCompoundTakeawaySunset(result, viewpoint, req);
    }
  }

  return result;
}
