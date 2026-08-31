/**
 * Universal Smart Concierge — Kontext für Follow-ups:
 * Essen, Wetter, Infra, Flug, Reservierung + Nav-Offers.
 */

import { getAllPois, getFactsForPoi, haversineMeters } from '../../db/database';
import type { Poi } from '../../db/types';
import { parseTagsJson } from '../geo/triggerPolicy';
import { useFinnusStore } from '../../store/useFinnusStore';
import type { PendingNavOffer } from '../navigation/navigationTypes';
import { useUserMemoryStore } from '../../store/useUserMemoryStore';
import { resolvePersonaEngine } from '../personaEngine';
import { getCachedUserProfile } from '../userProfileService';
import {
  getPlanBikeMPerMin,
  getPlanWalkMPerMin,
  formatPaceForPrompt,
} from '../mobility/paceProfile';
import { isBounceAvailableForCity } from '../affiliate/affiliateService';
import { getWeatherPromptBlock } from '../weatherService';
import {
  buildPoiReservationInfo,
  buildReservationPromptBlock,
} from '../reservation/reservationService';
import {
  communityTipsPromptBlock,
  fetchCommunityPlaceTipsNear,
} from '../memory/communityPlaceFeedback';
import { fallbackSpeech as labeledFallbackSpeech } from '../debug/fallbackLabel';
import { resolveCanonicalDestination, extractNamedDestinationLabel } from './canonicalDestination';
import { isExplicitNavIntent } from '../intent/poiInfoVsNav';
import { shortPoiDisplayName } from '../../utils/poiDisplayName';
import {
  FINDUS_ANSWER_FIRST_BLOCK,
  FINDUS_BOOKING_PLATFORM_HARD_MATCH_BLOCK,
  FINDUS_COMPOUND_PLAN_BLOCK,
  FINDUS_HELP_FIRST_MONETIZATION_BLOCK,
  FINDUS_JUST_DO_IT_BLOCK,
  FINDUS_TOURIST_FRICTION_BLOCK,
} from './findusResponsePolicy';
import {
  namedBookingPortalPromptHints,
  userRequiresNamedBookingPortal,
} from './bookingPlatformActions';
import { isCelestialOrSkyQuery } from './celestialSkyQuery';
import {
  isEventResearchQuery,
  researchTodaysEvents,
  synthesizeEventSpeech,
  type EventResearchResult,
} from './eventResearchService';
import type { WebResearchResult } from '../research/webResearchService';

/** Pack-POIs nur im Speech-Fokus der Pack-Stadt; sonst live/GPS-Stadt. */
function packDatasetUsableForSuggestions(): boolean {
  try {
    const { isPackSpeechAllowed } = require('../softWorkingCity') as {
      isPackSpeechAllowed: () => boolean;
    };
    return isPackSpeechAllowed();
  } catch {
    return true;
  }
}

/** Harte Distanz: Pack-POI jenseits davon nie vorschlagen (andere Stadt). */
const PACK_SUGGEST_MAX_M = 20_000;

export type ConciergeKind =
  | 'food'
  | 'weather'
  | 'infra'
  | 'flight'
  | 'travel'
  | 'luggage'
  | 'accommodation'
  | 'tours'
  | 'reservation'
  | 'general';

export type ConciergeContext = {
  kind: ConciergeKind;
  promptBlock: string;
  primaryOffer: PendingNavOffer | null;
  alternatives: PendingNavOffer[];
  /**
   * User named a concrete place („Restaurant Kreta“).
   * Speech + START_NAVIGATION + reservation/menu MUST bind to primaryOffer only.
   * Open discovery must not override.
   */
  namedDestination?: boolean;
  /** Gemini Search Grounding sinnvoll */
  wantsLiveSearch: boolean;
  /** Mietwagen-Button (DiscoverCars) anbieten */
  wantsCarRental: boolean;
  /** Gepäck-Spot (Bounce) anbieten */
  wantsBounceLuggage: boolean;
  /** Unterkunft (Stay22) anbieten */
  wantsStay22: boolean;
  /** Zielstadt für Stay22 */
  stay22Destination: string | null;
  /** Konkrete Hotels/Pensionen aus dem Stadt-Pack */
  accommodationHints: Array<{
    poiId: number;
    name: string;
    why: string;
    distanceM: number | null;
  }>;
  /** Touren/Tickets (GYG / Musement / Viator) */
  wantsTours: boolean;
  tourKind: 'museum' | 'tour' | 'vip' | 'generic' | null;
  tourDestination: string | null;
  /** Falls die KI leer antwortet — lokale Empfehlungs-Stimme */
  fallbackSpeech?: string | null;
  /** Stichpunkte zu fallbackSpeech */
  fallbackBullets?: string[];
  /** Tagesaktuelle Event-Recherche (PDFs/Kalender) */
  eventResearch?: EventResearchResult | null;
  /** Allgemeine Web-/PDF-Recherche */
  webResearch?: WebResearchResult | null;
  /** Event-Turns: bis 4 Quick-Actions */
  maxQuickActions?: number;
};

const FOOD_RE =
  /\b(hunger|hungrig|bock\s+auf|lust\s+auf|essen|leckeres|einheimisch|regional|spitzen|burger|pizza|döner|doener|sushi|restaurant|café|cafe|kaffee|imbiss|mittag|abendessen|frühstück|fruehstueck|vegetar|vegan|griech|italiener|asia|curry|fisch|schnitzel)\b/iu;

const WEATHER_RE =
  /\b(regen|regnet|wetter|sonne|sonnig|sturm|gewitter|kalt|warm|temperatur|schnee|windig|giessen|gießen|schauer|anziehen|outfit|jacke|pulli|windjacke|kleidung|schirm|regenschirm)\b/iu;

const INFRA_RE =
  /\b(leihfahrrad|stadtrad|fahrrad|bike\s*share|geldautomat|bankomat|atm|haltestelle|bushaltestelle|ladestation|wc|toilette|apotheke|wlan|wifi|wi-?fi|trinkwasser|trinkbrunnen)\b/iu;

const FLIGHT_RE =
  /\b(flug|flieger|abflug|boarding|flughafen|airport|gate|check[\s-]?in)\b/iu;

const CAR_RENTAL_RE =
  /\b(mietwagen|leihwagen|autovermiet|auto\s+mieten|wagen\s+mieten|rent[\s-]?a[\s-]?car|car[\s-]?rental|economy\s*bookings)\b/iu;

const TRAVEL_ROUTE_RE =
  /\b(streckenplan|anreise|abreise|road[\s-]?trip|tagesausflug|mit\s+dem\s+auto|weiterfahrt|nach\s+\w+\s+fahren|reise\s+nach|überland|ueberland)\b/iu;

const LUGGAGE_RE =
  /\b(gepäck|gepaeck|koffer|rucksack|luggage|bounce|aufbewahrung|schlie[ßss]fach|gepäckaufbewahrung|gepaeckaufbewahrung|kofferfrei|ohne\s+koffer|ohne\s+gepäck|ohne\s+gepaeck|früheincheck|frueheincheck|early\s+check[\s-]?in|spätabflug|spaetabflug|später\s+flug|spaeter\s+flug|late\s+(departure|flight)|left[\s-]?luggage)\b/iu;

const ACCOMMODATION_RE =
  /\b(unterkunft|unterkünfte|unterkuenfte|hotel|hotels|ferienwohnung|ferienhaus|apartment|apartments|übernacht|uebernacht|übernachten|uebernachten|airbnb|hostel|pension|zimmer\s+buchen|wo\s+(kann|soll)\s+ich\s+(schlafen|übernachten|uebernachten)|stay22)\b/iu;

const TOURS_RE =
  /\b(tour|touren|ausflug|ausflüge|ausfluege|stadtführung|stadtfuehrung|sightseeing|aktivität|aktivitaet|ticket|tickets|museum|museen|ausstellung|viator|getyourguide|musement|vip[\s-]?tour|private\s+tour)\b/iu;

const RESERVATION_RE =
  /\b(reservier|tisch\s+(für|fuer|heute|morgen)|platz\s+reserv|buch(e|en)?\s+(einen\s+)?tisch)\b/iu;

const CONCIERGE_ANY =
  /\b(wo\s+kann\s+ich|wo\s+gibt\s+es|empfehl|vorschlagen|jetzt\s+hin|was\s+mach(?:en|)\s+wir)\b/iu;

/** „Was geht heute?“ / Tipps vor Ort — nicht nur Gastro. */
const TODAY_VIBES_RE =
  /\b(was\s+(heute\s+)?geht|was\s+geht\s+heute|was\s+heute\s+geht|was\s+ist\s+(heute\s+)?los|was\s+läuft\s+heute|was\s+laeuft\s+heute|heute\s+(noch\s+)?(machen|unternehmen|los)|was\s+kann\s+(man|ich)\s+(heute|hier)|was\s+lohnt\s+sich|tipps?\s+(für|fuer)\s+heute|was\s+geht\s+hier|heute\s+abend|heut\s+abend|events?|veranstaltungen?|programm|ausgehen|nightlife|nachtleben|party|konzert)\b/iu;

const MAX_FOOD_DIST_M = 2500;
const MAX_TODAY_DIST_M = 3500;

export function detectConciergeKind(text: string): ConciergeKind | null {
  const t = text.trim();
  if (!t) return null;
  if (RESERVATION_RE.test(t)) return 'reservation';
  // Named hotel + fact question (Wann Frühstück / Öffnungszeiten) → food/general, NOT accommodation-nav
  if (
    ACCOMMODATION_RE.test(t) &&
    /\b(wann|frühstück|fruehstueck|breakfast|öffnungs|oeffnungs|gibt\s+es|check[-\s]?in|preis)\b/iu.test(
      t,
    )
  ) {
    if (FOOD_RE.test(t) || /\bfrühstück|fruehstueck|breakfast\b/iu.test(t)) {
      return 'food';
    }
    return 'general';
  }
  if (ACCOMMODATION_RE.test(t)) return 'accommodation';
  if (LUGGAGE_RE.test(t)) return 'luggage';
  if (TOURS_RE.test(t)) return 'tours';
  if (CAR_RENTAL_RE.test(t)) return 'travel';
  if (FLIGHT_RE.test(t)) return 'flight';
  if (TRAVEL_ROUTE_RE.test(t)) return 'travel';
  if (WEATHER_RE.test(t)) return 'weather';
  if (INFRA_RE.test(t)) return 'infra';
  if (FOOD_RE.test(t)) return 'food';
  if (isTodayVibesQuery(t) || CONCIERGE_ANY.test(t)) return 'general';
  return null;
}

export function isTodayVibesQuery(text: string): boolean {
  const t = text.trim();
  if (isCelestialOrSkyQuery(t)) return false;
  return TODAY_VIBES_RE.test(t);
}

export function queryWantsCarRental(text: string, kind?: ConciergeKind | null): boolean {
  if (kind === 'flight' || kind === 'travel') return true;
  const t = text.trim();
  return CAR_RENTAL_RE.test(t) || TRAVEL_ROUTE_RE.test(t);
}

export function queryWantsBounceLuggage(
  text: string,
  kind?: ConciergeKind | null,
): boolean {
  if (kind === 'luggage') return true;
  // Früheinchecken / Spätabflug oft im Flug-Kontext
  if (kind === 'flight' && LUGGAGE_RE.test(text)) return true;
  return LUGGAGE_RE.test(text.trim());
}

/** Ziel für Stay22: Stadt / Nähe / Straße — nie Hotel-Eigenname. */
export function resolveStay22Destination(text: string): string {
  const t = text.trim();

  // Explicit city: „Hotels in Wangerooge“, „Unterkunft nach Harlesiel“
  const cityIn = t.match(
    /\b(?:in|nach|für|fuer|bei)\s+([A-ZÄÖÜ][\wÄÖÜäöüß\-]+(?:\s+[A-ZÄÖÜ][\wÄÖÜäöüß\-]+)?)/u,
  );
  if (cityIn?.[1]) {
    const city = cityIn[1].trim();
    if (
      !/^(Hotel|Ferienwohnung|Apartment|Unterkunft|Airbnb|Hostel|Pension|Nähe|Naehe)$/i.test(
        city,
      )
    ) {
      return city;
    }
  }

  // „Hotel in Hamburg“ only when „in“ is present — never „Hotel Hanken“
  const hotelInCity = t.match(
    /\b(?:hotel|ferienwohnung|apartment|unterkunft|pension)\s+in\s+([A-ZÄÖÜ][\wÄÖÜäöüß\-]+)/iu,
  );
  if (hotelInCity?.[1]) return hotelInCity[1].trim();

  // Nearby / open search → city or GPS area
  const profileCity = getCachedUserProfile()?.cityName?.trim();
  const coords = userCoords();
  if (coords) {
    // Stay22 accepts address strings; city + „Umgebung“ beats a bare hotel name
    if (profileCity) return `${profileCity} Umgebung`;
    return `${coords.lat.toFixed(4)},${coords.lng.toFixed(4)}`;
  }
  return profileCity || 'Germany';
}

export function queryWantsStay22(
  text: string,
  kind?: ConciergeKind | null,
): boolean {
  // Named go-to („führ mich zum Hotel Hanken“) → keine „Mehr Unterkünfte“
  if (isExplicitNavIntent(text) && extractNamedDestinationLabel(text)) {
    return false;
  }
  // Open discovery only
  if (
    /\b(gute|beste|schöne|schoene|günstig|guenstig|andere|mehr)\s+(hotels?|unterkünfte|unterkuenfte|ferienwohnungen)\b/iu.test(
      text,
    ) ||
    /\b(hotels?|unterkünfte|unterkuenfte)\s+(in\s+der\s+nähe|in\s+der\s+naehe|hier|umgebung)\b/iu.test(
      text,
    )
  ) {
    return true;
  }
  if (kind === 'accommodation' && !isExplicitNavIntent(text)) return true;
  if (kind === 'accommodation' && isExplicitNavIntent(text)) return false;
  return (
    ACCOMMODATION_RE.test(text.trim()) &&
    !isExplicitNavIntent(text) &&
    !extractNamedDestinationLabel(text)
  );
}

function isAccommodationPoi(poi: Poi): boolean {
  if (poi.kind === 'approach') return false;
  const blob = `${poi.name} ${(poi.category ?? '')} ${parseTagsJson(poi.tags_json).join(' ')} ${(poi.teaser_text ?? '')}`.toLowerCase();
  if (
    /(hotel|pension|hostel|apartment|ferienwohnung|ferienhaus|gastehaus|gästehaus|unterkunft|motel)/i.test(
      blob,
    )
  ) {
    return true;
  }
  return false;
}

/** Lokale Hotels/Pensionen aus dem Stadt-Pack (konkrete Namens-Tipps). */
export async function findAccommodationCandidates(
  text: string,
  limit = 3,
): Promise<
  Array<{
    poi: Poi;
    distanceM: number | null;
    walkMinutes: number | null;
    why: string;
    score: number;
  }>
> {
  const coords = userCoords();
  if (!packDatasetUsableForSuggestions()) return [];
  const pois = await getAllPois();
  const wantCheap = /\b(günstig|guenstig|billig|budget|hostel)\b/iu.test(text);
  const wantApartment =
    /\b(apartment|ferienwohnung|ferienhaus|airbnb)\b/iu.test(text);

  const out: Array<{
    poi: Poi;
    distanceM: number | null;
    walkMinutes: number | null;
    why: string;
    score: number;
  }> = [];

  for (const poi of pois) {
    if (!isAccommodationPoi(poi)) continue;
    let distanceM: number | null = null;
    let walkMinutes: number | null = null;
    if (coords) {
      distanceM = Math.round(
        haversineMeters(coords.lat, coords.lng, poi.lat, poi.lng),
      );
      if (distanceM > PACK_SUGGEST_MAX_M) continue;
      walkMinutes = walkMin(distanceM);
    }

    const blob =
      `${poi.name} ${(poi.category ?? '')} ${(poi.teaser_text ?? '')}`.toLowerCase();
    let score = 20;
    let why = 'Unterkunft vor Ort';
    if (/hotel/i.test(blob)) {
      score += 12;
      why = 'Hotel';
    }
    if (/pension|gastehaus|gästehaus/i.test(blob)) {
      score += 8;
      why = 'Pension / Gästehaus';
    }
    if (wantApartment && /(apartment|ferien)/i.test(blob)) {
      score += 18;
      why = 'Ferienwohnung / Apartment';
    }
    if (wantCheap && /(hostel|budget|günstig)/i.test(blob)) score += 10;
    if (distanceM != null) {
      score += Math.max(0, 30 - Math.min(30, Math.floor(distanceM / 200)));
    }

    // Kurzer Fakt-Schnipsel als Why-Zusatz
    try {
      const facts = await getFactsForPoi(poi.id);
      const tip = facts[0]?.fact_text?.trim();
      if (tip) {
        const short = tip.length > 90 ? `${tip.slice(0, 87)}…` : tip;
        why = `${why}: ${short}`;
        score += 4;
      }
    } catch {
      /* ignore */
    }

    out.push({ poi, distanceM, walkMinutes, why, score });
  }

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

export function resolveTourKind(
  text: string,
): 'museum' | 'tour' | 'vip' | 'generic' {
  if (/\b(museum|museen|ausstellung)\b/iu.test(text)) return 'museum';
  if (/\b(vip|private\s+tour|weltweit)\b/iu.test(text)) return 'vip';
  if (TOURS_RE.test(text)) return 'tour';
  return 'generic';
}

export function queryWantsTours(
  text: string,
  kind?: ConciergeKind | null,
): boolean {
  if (kind === 'tours') return true;
  return TOURS_RE.test(text.trim());
}

export function isConciergeQuery(text: string): boolean {
  if (detectConciergeKind(text) != null) return true;
  return (
    isExplicitNavIntent(text) && extractNamedDestinationLabel(text) != null
  );
}

function shortName(poi: Poi): string {
  return shortPoiDisplayName(
    poi.name.replace(/\s+und\s+historisches.*$/i, ''),
  );
}

function userCoords(): { lat: number; lng: number } | null {
  const s = useFinnusStore.getState();
  if (s.lastGpsLat == null || s.lastGpsLng == null) return null;
  return { lat: s.lastGpsLat, lng: s.lastGpsLng };
}

function walkMin(distanceM: number): number {
  const mobility = resolvePersonaEngine(getCachedUserProfile()).mobilityMode;
  const mpm =
    mobility === 'bike' ? getPlanBikeMPerMin() : getPlanWalkMPerMin();
  return Math.max(1, Math.ceil(distanceM / mpm));
}

function isGastroPoi(poi: Poi): boolean {
  if (poi.kind === 'approach') return false;
  const cat = (poi.category ?? '').toLowerCase();
  const tags = parseTagsJson(poi.tags_json).join(' ').toLowerCase();
  const name = poi.name.toLowerCase();
  const blob = `${cat} ${tags} ${name}`;
  if (
    /kindergarten|kita|schule|feuerwehr|zahnarzt|praxis|museum|kirche|bahnhof/.test(
      name,
    )
  ) {
    return false;
  }
  return /(restaurant|café|cafe|gastro|imbiss|hotel|gasthof|bäck|baeck|pizzeria|burger|bar|kneipe|goldschätzchen|goldschaetzchen)/i.test(
    blob,
  );
}

function foodKeywordBoost(text: string, poi: Poi, factsJoined: string): number {
  const blob = `${poi.name} ${factsJoined}`.toLowerCase();
  let boost = 0;
  const checks: Array<[RegExp, number]> = [
    [/\bburger\b/i, 30],
    [/\bgriech|santorini|mediterran\b/i, 28],
    [/\bpizza|itali/i, 22],
    [/\bkaffee|café|cafe|goldschätzchen\b/i, 20],
    [/\bfisch|seafood\b/i, 18],
    [/\bvegetar|vegan\b/i, 15],
    [/\bbiergarten\b/i, 10],
  ];
  for (const [re, pts] of checks) {
    if (re.test(text) && re.test(blob)) boost += pts;
  }
  return boost;
}

function extractHoursHint(facts: string[]): string | null {
  const joined = facts.join(' | ');
  const range =
    joined.match(
      /(montags?|dienstags?|mittwochs?|donnerstags?|freitags?|samstags?|sonntags?|mo|di|mi|do|fr|sa|so)[^.]{0,40}?(\d{1,2}[:.]\d{2})\s*[-–]\s*(\d{1,2}[:.]\d{2})/i,
    ) ||
    joined.match(
      /\b(?:von|ab)\s+(\d{1,2}[:.]\d{2})\s*(?:bis|[-–])\s*(\d{1,2}[:.]\d{2})\b/i,
    );
  if (range) return range[0].replace(/\s+/g, ' ').trim().slice(0, 80);

  if (/\bgeschlossen\b/i.test(joined) && /\bheute\b/i.test(joined)) {
    return 'laut Fakten heute geschlossen';
  }
  if (/\breservier/i.test(joined)) {
    return 'Reservierung oft empfohlen';
  }
  return null;
}

function extractInsiderTip(facts: string[]): string | null {
  for (const f of facts) {
    const t = f.replace(/^User-Frage:.*Antwort:\s*/i, '').trim();
    if (t.length < 40 || t.length > 180) continue;
    if (
      /(bekannt|empfohlen|besonders|legendär|hammer|voll|reservier|serviert|bietet|à la carte|a la carte|smash|burger|vegetar)/i.test(
        t,
      )
    ) {
      return t.slice(0, 160);
    }
  }
  // Fallback: kürzerer „now“-artiger Satz
  const short = facts.find((f) => f.length > 30 && f.length < 120);
  return short ? short.slice(0, 140) : null;
}

function parseOpenStatus(facts: string[]): 'open' | 'closed' | 'unknown' {
  const joined = facts.join(' ').toLowerCase();
  if (/heute\s+geschlossen|aktuell\s+geschlossen/.test(joined)) return 'closed';
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const ranges: Array<{ open: number; close: number }> = [];
  const re =
    /(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(joined)) !== null) {
    const open = Number(m[1]) * 60 + Number(m[2]);
    const close = Number(m[3]) * 60 + Number(m[4]);
    if (close > open) ranges.push({ open, close });
  }
  if (!ranges.length) return 'unknown';
  if (ranges.some((r) => mins >= r.open && mins < r.close)) return 'open';
  // Abendgastro: wenn jetzt vor Öffnung und Öffnung heute noch kommt
  if (ranges.some((r) => r.open > mins && r.open - mins <= 180)) return 'unknown';
  return 'closed';
}

async function buildFoodCandidates(
  text: string,
): Promise<
  Array<{
    poi: Poi;
    distanceM: number;
    walkMinutes: number;
    hoursHint: string | null;
    insider: string | null;
    status: 'open' | 'closed' | 'unknown';
  }>
> {
  const coords = userCoords();
  if (!packDatasetUsableForSuggestions()) return [];
  const pois = (await getAllPois()).filter(isGastroPoi);
  const scored: Array<{
    poi: Poi;
    distanceM: number;
    walkMinutes: number;
    hoursHint: string | null;
    insider: string | null;
    status: 'open' | 'closed' | 'unknown';
    score: number;
  }> = [];

  for (const poi of pois) {
    const distanceM = coords
      ? Math.round(haversineMeters(coords.lat, coords.lng, poi.lat, poi.lng))
      : 800;
    if (distanceM > MAX_FOOD_DIST_M) continue;

    const facts = (await getFactsForPoi(poi.id)).map((f) => f.fact_text);
    const status = parseOpenStatus(facts);
    if (status === 'closed') continue;

    const hoursHint = extractHoursHint(facts);
    const insider = extractInsiderTip(facts);
    const walkMinutes = walkMin(distanceM);
    let score = 40 - walkMinutes * 2;
    score += foodKeywordBoost(text, poi, facts.join(' '));
    if (status === 'open') score += 15;
    if (insider) score += 8;
    if (/hotel|gasthof/i.test(poi.name) && /burger|griech|pizza/i.test(text)) {
      score -= 10;
    }

    scored.push({
      poi,
      distanceM,
      walkMinutes,
      hoursHint,
      insider,
      status,
      score,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).map(({ score: _s, ...rest }) => rest);
}

type TodayCandidate = {
  poi: Poi;
  name: string;
  distanceM: number;
  walkMinutes: number;
  motto: string | null;
  wasGeht: string | null;
  status: 'open' | 'closed' | 'unknown';
};

function shortenMotto(raw: string | null | undefined): string | null {
  const t = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  // Teaser oft „Siehst du schon…“ — fürs Motto etwas knapper
  const cleaned = t
    .replace(/^Siehst du schon[^—–-]*[—–-]\s*/i, '')
    .replace(/^Genau da gehen wir hin\s*[—–-]?\s*/i, '')
    .replace(/\s*Komm näher(?:\s+ran)?\.?\s*$/i, '')
    .trim();
  const base = cleaned || t;
  if (base.length <= 110) return base;
  return `${base.slice(0, 107).trim()}…`;
}

function scoreTodayPoi(poi: Poi): number {
  const tags = parseTagsJson(poi.tags_json).join(' ').toLowerCase();
  const cat = (poi.category ?? '').toLowerCase();
  const name = poi.name.toLowerCase();
  const blob = `${name} ${cat} ${tags}`;
  let s = 2;
  if (
    /denkmal|museum|kirche|schloss|rathaus|platz|markt|histor|wartehäuschen|bahnhof|hafen|strand|leuchtturm|aussicht|insel/.test(
      blob,
    )
  ) {
    s += 10;
  }
  if (/park|natur|brücke|teich|see|dünen|watt|promenade/.test(blob)) s += 6;
  if (/café|cafe|restaurant|bäck|baeck|gastro|imbiss|bar/.test(blob)) s += 5;
  if (
    /schule|kindergarten|kita|feuerwehr|gewerbe|pflegeheim|zahnarzt|praxis|atm|geldautomat/.test(
      blob,
    )
  ) {
    s -= 8;
  }
  if (poi.kind === 'approach' || poi.kind === 'sub') s -= 6;
  if ((poi.teaser_text ?? '').trim().length > 20) s += 4;
  return s;
}

function formatDistCasual(distanceM: number, walkMinutes: number): string {
  if (distanceM < 1000) {
    return `${Math.round(distanceM / 10) * 10} Meter, etwa ${walkMinutes} Minuten zu Fuß`;
  }
  return `${(distanceM / 1000).toFixed(1)} Kilometer, etwa ${walkMinutes} Minuten zu Fuß`;
}

async function buildTodayCandidates(limit = 3): Promise<TodayCandidate[]> {
  const coords = userCoords();
  if (!packDatasetUsableForSuggestions()) return [];
  const pois = await getAllPois();
  const scored: Array<TodayCandidate & { score: number }> = [];

  for (const poi of pois) {
    if (poi.kind === 'approach' || poi.kind === 'sub') continue;
    const base = scoreTodayPoi(poi);
    if (base < 4) continue;

    const distanceM = coords
      ? Math.round(haversineMeters(coords.lat, coords.lng, poi.lat, poi.lng))
      : 900;
    if (distanceM > MAX_TODAY_DIST_M) continue;

    const facts = (await getFactsForPoi(poi.id)).map((f) => f.fact_text);
    const status = parseOpenStatus(facts);
    if (status === 'closed') continue;

    const motto =
      shortenMotto(poi.teaser_text) ||
      shortenMotto(extractInsiderTip(facts));
    const rawWasGeht =
      extractInsiderTip(facts) ||
      extractHoursHint(facts) ||
      (facts[0] ? facts[0].replace(/\s+/g, ' ').trim().slice(0, 140) : null);
    const wasGeht =
      rawWasGeht && isAddressLikeFact(rawWasGeht) ? null : rawWasGeht;

    const walkMinutes = walkMin(distanceM);
    let score = base + Math.max(0, 25 - Math.min(25, Math.floor(distanceM / 120)));
    if (status === 'open') score += 8;
    if (motto) score += 5;
    if (wasGeht) score += 3;

    scored.push({
      poi,
      name: shortName(poi),
      distanceM,
      walkMinutes,
      motto,
      wasGeht:
        wasGeht && motto && wasGeht.slice(0, 60) === motto.slice(0, 60)
          ? null
          : wasGeht,
      status,
      score,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ score: _s, ...rest }) => rest);
}

function isAddressLikeFact(text: string): boolean {
  return (
    /\b(adresse|anschrift)\b/i.test(text) ||
    /\b(straße|strasse|promenade|weg|gasse|platz)\s+\d{1,4}\b/i.test(text) ||
    /\b\d{5}\b/.test(text) ||
    /\b\d{1,4}[a-z]?\s*,\s*\d{5}\b/i.test(text)
  );
}

function synthesizeTodaySpeech(candidates: TodayCandidate[]): string {
  if (!candidates.length) {
    return 'Gerade hab ich keine frischen Tipps in der Nähe — frag mich gleich nochmal, oder sag mir, worauf du Lust hast.';
  }
  const picks = candidates.slice(0, 2);
  const parts: string[] = ['Hier ist, was heute gut geht.'];
  for (const c of picks) {
    const dist = formatDistCasual(c.distanceM, c.walkMinutes);
    let line = `${c.name} — ${dist}.`;
    if (c.motto && !isAddressLikeFact(c.motto)) {
      line += ` ${c.motto.replace(/\.\s*$/, '')}.`;
    }
    if (c.wasGeht && !isAddressLikeFact(c.wasGeht)) {
      line += ` Was dort lohnt: ${c.wasGeht.replace(/\.\s*$/, '')}.`;
    }
    parts.push(line);
  }
  if (picks.length >= 2) {
    parts.push(
      `An der Straße ist oft viel los — am besten diese beiden: ${picks[0].name} und ${picks[1].name}. Welchen nehmen wir?`,
    );
  } else {
    parts.push(`Route zu ${picks[0].name} starten?`);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function todayBullets(candidates: TodayCandidate[]): string[] {
  return candidates.slice(0, 3).map((c) => {
    const dist =
      c.distanceM < 1000
        ? `${c.distanceM} m`
        : `${(c.distanceM / 1000).toFixed(1)} km`;
    const tipRaw = c.motto || c.wasGeht || 'Tipp vor Ort';
    const tip = isAddressLikeFact(tipRaw) ? 'Tipp vor Ort' : tipRaw;
    const short = tip.length > 48 ? `${tip.slice(0, 45)}…` : tip;
    return `${c.name} · ${dist} · ${short}`;
  });
}

async function fetchWeatherBlock(
  lat: number,
  lng: number,
): Promise<string | null> {
  return getWeatherPromptBlock(lat, lng);
}

async function buildInfraCandidates(
  text: string,
): Promise<
  Array<{ poi: Poi; distanceM: number; walkMinutes: number; why: string }>
> {
  const coords = userCoords();
  if (!packDatasetUsableForSuggestions()) return [];
  const pois = await getAllPois();
  const wantBike = /fahrrad|stadtrad|leih|bike/i.test(text);
  const wantAtm = /geldautomat|bankomat|atm|bargeld/i.test(text);
  const wantStop = /haltestelle|bus|öpnv|oepnv/i.test(text);

  const out: Array<{
    poi: Poi;
    distanceM: number;
    walkMinutes: number;
    why: string;
    score: number;
  }> = [];

  for (const poi of pois) {
    if (poi.kind === 'approach') continue;
    const blob = `${poi.name} ${(poi.category ?? '')} ${parseTagsJson(poi.tags_json).join(' ')}`.toLowerCase();
    let why = '';
    let score = 0;
    if (wantBike && /(fahrrad|bike|radstation|stadtrad)/i.test(blob)) {
      why = 'Leihfahrrad / Rad-Station';
      score = 40;
    } else if (wantAtm && /(geldautomat|atm|bank|sparkasse)/i.test(blob)) {
      why = 'Geldautomat / Bank';
      score = 40;
    } else if (
      wantStop &&
      /(haltestelle|bahnhof|haltepunkt|bus)/i.test(blob)
    ) {
      why = 'ÖPNV / Haltepunkt';
      score = 35;
    } else continue;

    const distanceM = coords
      ? Math.round(haversineMeters(coords.lat, coords.lng, poi.lat, poi.lng))
      : 500;
    if (distanceM > 3000) continue;
    const walkMinutes = walkMin(distanceM);
    score += Math.max(0, 25 - walkMinutes);
    out.push({ poi, distanceM, walkMinutes, why, score });
  }

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 2).map(({ score: _s, ...r }) => r);
}

function flightMemoryHint(): string | null {
  const entities = useUserMemoryStore.getState().entities ?? [];
  const flightish = entities.filter((e) =>
    /flug|flight|airport|mailand|milan|ew\s*\d+/i.test(
      `${e.name} ${e.notes ?? ''}`,
    ),
  );
  if (!flightish.length) {
    return 'Kein gespeicherter Flug im Langzeitgedächtnis. Wenn der User Flugdaten nennt, damit rechnen — sonst nachfragen (Airline/Uhrzeit) ODER mit Grounding live prüfen.';
  }
  return flightish
    .slice(0, 3)
    .map((e) => `- ${e.name}${e.notes ? `: ${e.notes}` : ''}`)
    .join('\n');
}

export async function prepareConciergeContext(
  text: string,
): Promise<ConciergeContext | null> {
  let kind = detectConciergeKind(text);
  // Named go-to without other kind cues still needs context (e.g. only „zum Kreta“)
  if (!kind && isExplicitNavIntent(text)) {
    kind =
      FOOD_RE.test(text) ||
      /\b(restaurant|café|cafe|bistro|bar|imbiss)\b/iu.test(text)
        ? 'food'
        : 'general';
  }
  if (!kind) return null;

  const coords = userCoords();
  const dietary =
    resolvePersonaEngine(getCachedUserProfile()).preferences.dietaryRestrictions.join(
      ', ',
    ) || 'keine';

  let primaryOffer: PendingNavOffer | null = null;
  const alternatives: PendingNavOffer[] = [];
  const parts: string[] = [
    '=== CONCIERGE LIVE-KONTEXT (PFLICHT NUTZEN) ===',
    `Absicht: ${kind}`,
    `Ernährung des Nutzers: ${dietary}`,
    coords
      ? `Nutzer-Position: ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`
      : 'Nutzer-Position: unbekannt — Gehzeiten schätzen / nachfragen.',
    formatPaceForPrompt(),
  ];

  // Wetter immer für Planung (gecacht; frisch bei Bedarf)
  if (coords) {
    const wx = await fetchWeatherBlock(coords.lat, coords.lng);
    if (wx) {
      parts.push(wx);
      parts.push(
        'Wetter in Tipps mitdenken (Regen→Indoor/Jacke, Hitze→Schatten/Pause, Wind→geschützt).',
      );
    }
  }

  try {
    if (coords) {
      const { maybeGrowPackFromUserTurn } = await import(
        '../research/packGrowthFromTurn'
      );
      const grown = await maybeGrowPackFromUserTurn({
        userText: text,
        lat: coords.lat,
        lng: coords.lng,
      });
      if (grown?.promptBlock) {
        parts.push(grown.promptBlock);
      }
    }
  } catch {
    /* soft */
  }

  let eventResearch: EventResearchResult | null = null;
  let webResearch: WebResearchResult | null = null;
  let maxQuickActions: number | undefined;

  let wantsLiveSearch =
    kind === 'flight' ||
    kind === 'travel' ||
    kind === 'luggage' ||
    kind === 'accommodation' ||
    kind === 'tours' ||
    kind === 'weather' ||
    kind === 'food';

  let fallbackSpeech: string | null = null;
  let fallbackBullets: string[] = [];
  let namedDestination = false;

  // ── CANONICAL NAMED DESTINATION (before open food discovery) ──
  // „Ich möchte zu Restaurant Kreta“ → Kreta is SSOT for speech + buttons
  {
    const canonical = await resolveCanonicalDestination(text);
    if (canonical) {
      namedDestination = true;
      primaryOffer = canonical.offer;
      alternatives.length = 0;
      const goTo = isExplicitNavIntent(text);
      parts.push(
        `=== KANONISCHES ZIEL (PFLICHT) ===`,
        `Der User meint GENAU diesen Ort: „${canonical.offer.name}“ (query: „${canonical.queryName}“).`,
        `poiId=${canonical.offer.poiId}.`,
        `Sprich NUR über diesen Ort — keine anderen Restaurants vorschlagen.`,
        goTo
          ? `User will HINGEHEN: kurze Bestätigung („klar, nicht weit“), dann fragen ob Route starten — quickActions: START_NAVIGATION Label „📍 Route starten“ + ggf. Tisch/Speisekarte.`
          : `Info/Reservierung zu diesem Ort — gleiche targetPoiId für alle Actions.`,
        `VERBOTEN: anderen Ort (nächster Gastro / Discovery) als START_NAVIGATION oder pendingNavOffer setzen.`,
      );
      if (goTo) {
        fallbackSpeech = labeledFallbackSpeech(
          'Concierge-Nav',
          `Na klar — ${canonical.offer.name} ist nicht weit. Wollen wir die Route starten?`,
        );
        fallbackBullets = [canonical.offer.name, 'Route starten'];
      }
      if (kind === 'food' || kind === 'reservation' || goTo) {
        // Skip open food discovery ranking entirely
        wantsLiveSearch = false;
      }
    }
  }

  if (
    !namedDestination &&
    (kind === 'food' || kind === 'reservation')
  ) {
    const food = await buildFoodCandidates(text);
    if (food.length) {
      parts.push('Gastro-Kandidaten (lokal, nach Distanz/Relevanz gefiltert):');
      food.forEach((c, i) => {
        const name = shortName(c.poi);
        parts.push(
          `${i + 1}) ${name} — ${c.walkMinutes} Min / ${c.distanceM} m` +
            `${c.status !== 'unknown' ? ` · Status:${c.status}` : ''}` +
            `${c.hoursHint ? ` · ${c.hoursHint}` : ''}` +
            `${c.insider ? ` · Insider: ${c.insider}` : ''}`,
        );
        const offer = {
          poiId: c.poi.id,
          name,
          lat: c.poi.lat,
          lng: c.poi.lng,
        };
        if (i === 0) primaryOffer = offer;
        else alternatives.push(offer);
      });
      // Binary choice: max 1 Alternative → 2 Chips
      if (alternatives.length > 1) alternatives.length = 1;
      parts.push(
        'Antworte wie im Concierge-Beispiel: genau 1–2 Optionen, Insider-Highlight, Gehzeit, dann „Welchen nehmen wir?“. ' +
          'speechText: Name + Entfernung + warum es lohnt. ' +
          'quickActions: GENAU die genannten Orte als START_NAVIGATION — Label = Ortsname (keine Uber-/Playlist-/Partner-Chips in diesem Turn). ' +
          'START_NAVIGATION nur mit targetPoiId aus dieser Liste — keine erfundenen IDs.',
      );
    } else {
      parts.push(
        'Keine passenden lokalen Gastro-POIs in Reichweite. Nutze Search-Grounding für echte geöffnete Orte in der Nähe — nur gut bewertet und erreichbar.',
      );
      wantsLiveSearch = true;
      try {
        const { communityDiscoveredPlacesPromptBlock } = await import(
          '../memory/collectiveLearning'
        );
        const city =
          getCachedUserProfile()?.cityName ??
          useFinnusStore.getState().currentLocationName ??
          null;
        const overlay = communityDiscoveredPlacesPromptBlock({
          cityHint: city,
          limit: 6,
          kinds: ['restaurant', 'cafe', 'place'],
        });
        if (overlay) {
          parts.push(overlay);
          parts.push(
            'Wenn Community-Orte passen: nutze sie als echte Optionen (Name + Distanz wenn GPS), Buttons START_NAVIGATION mit destName.',
          );
        }
      } catch {
        /* soft */
      }
    }
  } else if (
    namedDestination &&
    (kind === 'food' || kind === 'reservation')
  ) {
    // named already handled — keep live search only if coords-less geocode
    if (primaryOffer && primaryOffer.poiId < 0) {
      wantsLiveSearch = true;
    }
  }

  // Community-Meinungen (anonym) — Essen / Unterkunft / allgemein
  if (
    coords &&
    (kind === 'food' ||
      kind === 'reservation' ||
      kind === 'accommodation' ||
      kind === 'general')
  ) {
    try {
      const tips = await fetchCommunityPlaceTipsNear({
        lat: coords.lat,
        lng: coords.lng,
        radiusM: kind === 'food' ? 2200 : 3500,
        limit: 6,
      });
      const block = communityTipsPromptBlock(tips);
      if (block) parts.push(block);
    } catch {
      /* soft-fail */
    }
  }

  if (kind === 'general') {
    if (isTodayVibesQuery(text) || isEventResearchQuery(text)) {
      try {
        eventResearch = await researchTodaysEvents(text);
      } catch {
        eventResearch = null;
      }
    }

    if (eventResearch?.events.length) {
      parts.push(eventResearch.promptBlock);
      wantsLiveSearch = false;
      maxQuickActions = 4;
      primaryOffer = eventResearch.venueOffers[0] ?? null;
      alternatives.length = 0;
      for (const v of eventResearch.venueOffers.slice(1, 3)) {
        alternatives.push(v);
      }
      fallbackSpeech = labeledFallbackSpeech(
        'Concierge-Events',
        synthesizeEventSpeech(eventResearch),
      );
      fallbackBullets = eventResearch.events.slice(0, 3).map((e) => {
        const t = e.startTime ? `${e.startTime} · ` : '';
        return `${t}${e.title} @ ${e.venue}`;
      });
    } else {
      const today = await buildTodayCandidates(3);
      if (today.length && !isEventResearchQuery(text)) {
        parts.push(
          'HEUTE-VOR-ORT Tipps (lokal, Pflicht nutzen — nichts erfinden):',
        );
        today.forEach((c, i) => {
          parts.push(
            `${i + 1}) ${c.name} (#${c.poi.id}) — ${c.walkMinutes} Min / ${c.distanceM} m` +
              `${c.status !== 'unknown' ? ` · Status:${c.status}` : ''}` +
              `${c.motto ? ` · Motto: ${c.motto}` : ''}` +
              `${c.wasGeht ? ` · Was geht: ${c.wasGeht}` : ''}`,
          );
          const offer = {
            poiId: c.poi.id,
            name: c.name,
            lat: c.poi.lat,
            lng: c.poi.lng,
          };
          if (i === 0) primaryOffer = offer;
          else alternatives.push(offer);
        });
        parts.push(
          'speechText PFLICHT: genau 2 Tipps, flüssig gewebt (kein „Erstens“). Pro Tipp: Name + Entfernung/Gehzeit + Motto/Highlight in den Satz. ' +
            'KEINE Adressen, KEINE vollen DB-Marketingtitel (Slogan/Klammern kürzen). ' +
            'Kumpelton, keine Bullet-Liste im speechText. Am Ende: „Welchen nehmen wir?“ ' +
            'quickActions: GENAU diese 2 Orte als START_NAVIGATION — Label = kurzer Ortsname. KEINE Chip-Flut. ' +
            'visualBullets: 1–3 Stichpunkte à 1 Zeile — Name · Distanz · Highlight (ohne Adresse).',
        );
        fallbackSpeech = labeledFallbackSpeech(
          'Concierge-Heute',
          synthesizeTodaySpeech(today.slice(0, 2)),
        );
        fallbackBullets = todayBullets(today.slice(0, 2));
        if (alternatives.length > 1) {
          alternatives.length = 1;
        }
      } else {
        if (isEventResearchQuery(text) || isTodayVibesQuery(text)) {
          maxQuickActions = 4;
        }
        parts.push(
          eventResearch?.promptBlock ||
            'EVENT-RECHERCHE leer. Nutze Search-Grounding für HEUTIGE Events/Flyer/PDFs in der Stadt — keine generischen Behörden. ' +
              'Pro Event: Name, Ort, Uhrzeit, was passiert. speechText darf nicht leer sein.',
        );
        wantsLiveSearch = true;
        fallbackSpeech = labeledFallbackSpeech(
          'Concierge-Events-leer',
          eventResearch && eventResearch.events.length === 0
            ? synthesizeEventSpeech(eventResearch)
            : 'Gerade hab ich keine frischen Tipps in der Nähe — sag mir, ob du eher Kultur, Natur oder was zum Essen willst.',
        );
      }
    }
  }

  // Allgemeine Web-/PDF-Recherche (Öffnungszeiten, Checkout, Formulare, Quellen)
  {
    try {
      // Pack-only zuerst (offline, €0) für Öffnungszeiten/Menü
      if (
        /\b(öffnung|oeffnung|speisekarte|menü|menu|frühstück|fruehstueck|noch\s+offen|wann\s+hat)\b/iu.test(
          text,
        )
      ) {
        const { lookupPackHoursOrMenu } = await import(
          '../research/packHoursOffline'
        );
        const packHit = await lookupPackHoursOrMenu({
          userText: text,
          placeNameHint: extractNamedDestinationLabel(text),
        });
        if (packHit && packHit.trust >= 0.45) {
          parts.push(
            `=== PACK-ÖFFNUNGSZEITEN/MENÜ (offline, Vertrauen ${Math.round(packHit.trust * 100)}%) ===`,
            packHit.line,
            'PFLICHT: Diese Pack-Info nutzen; Web nur wenn User explizit Aktualität verlangt.',
          );
          if (!fallbackSpeech) {
            fallbackSpeech = labeledFallbackSpeech(
              'Pack-Öffnungszeiten',
              packHit.line,
            );
          }
          wantsLiveSearch = false;
        }
      }
    } catch {
      /* soft */
    }
    try {
      const { isWebResearchQuery, runWebResearch } = await import(
        '../research/webResearchService'
      );
      const { webAgentIsNeeded } = await import(
        '../research/webAgent/runOpenWebAgent'
      );
      const should =
        isWebResearchQuery(text) ||
        webAgentIsNeeded(text) ||
        userRequiresNamedBookingPortal(text).length > 0 ||
        kind === 'accommodation' ||
        kind === 'infra' ||
        kind === 'travel' ||
        (kind === 'food' &&
          /\b(öffnung|oeffnung|speisekarte|menü|menu|frühstück|fruehstueck|preis)\b/iu.test(
            text,
          ));
      if (should && !eventResearch?.events.length) {
        webResearch = await runWebResearch(text);
        if (webResearch) {
          parts.push(webResearch.promptBlock);
          maxQuickActions = Math.max(maxQuickActions ?? 0, 4);
          if (webResearch.facts.length || webResearch.sources.length) {
            wantsLiveSearch = false;
          }
          if (!fallbackSpeech && webResearch.speechHint) {
            fallbackSpeech = labeledFallbackSpeech(
              'Concierge-WebResearch',
              webResearch.speechHint,
            );
          }
          if (!fallbackBullets.length && webResearch.facts.length) {
            fallbackBullets = webResearch.facts.slice(0, 3).map((f) => {
              const bits = [f.label, f.value];
              if (f.time) bits.push(f.time);
              if (f.place) bits.push(f.place);
              return bits.join(' · ');
            });
          }
        }
      }
    } catch (err) {
      if (__DEV__) console.warn('[concierge] webResearch failed', err);
      parts.push(
        '=== WEB-RECHERCHE ===\nRecherche kurz fehlgeschlagen — ehrlich sagen, nichts erfinden, Hilfe anbieten.',
      );
    }
  }

  if (kind === 'reservation') {
    const profile = getCachedUserProfile();
    const food = await buildFoodCandidates(text);
    const target = food[0];
    if (target) {
      const facts = (await getFactsForPoi(target.poi.id)).map((f) => f.fact_text);
      const info = buildPoiReservationInfo(target.poi, facts);
      parts.push(buildReservationPromptBlock(info, profile));
      if (!primaryOffer) {
        primaryOffer = {
          poiId: target.poi.id,
          name: shortName(target.poi),
          lat: target.poi.lat,
          lng: target.poi.lng,
        };
      }
    } else {
      parts.push(
        'Reservierung: Kein klares Restaurant gefunden — nachfragen welcher Ort. Kein Fake-„Tisch ist gebucht“.',
      );
    }
  }

  if (kind === 'weather' || (kind === 'general' && WEATHER_RE.test(text))) {
    if (coords) {
      const wx = await fetchWeatherBlock(coords.lat, coords.lng);
      if (wx) parts.push(wx);
      else parts.push('Wetter-API gerade nicht erreichbar — Grounding nutzen.');
    }
    // Indoor-Alternative vorschlagen
    const food = await buildFoodCandidates('kaffee café restaurant');
    if (food[0]) {
      const name = shortName(food[0].poi);
      parts.push(
        `Indoor-Alternative falls Regen: ${name} (${food[0].walkMinutes} Min).`,
      );
      if (!primaryOffer) {
        primaryOffer = {
          poiId: food[0].poi.id,
          name,
          lat: food[0].poi.lat,
          lng: food[0].poi.lng,
        };
      } else {
        alternatives.push({
          poiId: food[0].poi.id,
          name,
          lat: food[0].poi.lat,
          lng: food[0].poi.lng,
        });
      }
    }
    parts.push(
      'Bei Regen: aktive Empfehlung (jetzt los ODER Indoor). Bei Outfit-Fragen: Wetter kurz erklären (Jetzt + Tageshoch/Trend) + Kleidung für Jetzt und den Rest des Tages — keine nachgetragene Morgenkühle, Abend nur kühl nennen wenn belegt; begründete Tipps in visualBullets. Action-Outro nur wenn sinnvoll.',
    );
    wantsLiveSearch = true;
  }

  if (kind === 'infra') {
    const infra = await buildInfraCandidates(text);
    if (infra.length) {
      parts.push('Infra-Treffer:');
      infra.forEach((c, i) => {
        const name = shortName(c.poi);
        parts.push(
          `${i + 1}) ${c.why}: ${name} — ${c.walkMinutes} Min / ${c.distanceM} m`,
        );
        const offer = {
          poiId: c.poi.id,
          name,
          lat: c.poi.lat,
          lng: c.poi.lng,
        };
        if (i === 0) primaryOffer = offer;
        else alternatives.push(offer);
      });
    } else {
      parts.push(
        'Kein lokaler Infra-POI. Pragmatisch antworten (z. B. Prisdorf: oft kein Bus → Bahnhof). Grounding ok.',
      );
      wantsLiveSearch = true;
    }
    if (/haltestelle|bus/i.test(text)) {
      parts.push(
        'Hinweis Prisdorf: oft kein regulärer Bus — Bahnhof als ÖPNV-Anker nennen, wenn passend.',
      );
    }
  }

  if (kind === 'flight') {
    parts.push('Flug-Kontext aus Memory:', flightMemoryHint() ?? '—');
    parts.push(
      'Logik: Boarding/Abflug vs. Weg zum Flughafen (Bahn+S-Bahn oder Taxi). Knappheit klar aussprechen. Action: Route zur Bahn ODER Taxi-Hinweis.',
    );
    parts.push(
      'Wenn Weiterfahrt oder Flexibilität sinnvoll: BOOK_CAR_RENTAL („🚗 Mietwagen buchen“) anbieten — DiscoverCars.',
    );
    wantsLiveSearch = true;
  }

  if (kind === 'travel') {
    parts.push(
      'Reise-/Strecken-Kontext: Bei sinnvoller Mietwagen-Empfehlung BOOK_CAR_RENTAL anbieten (Label „🚗 Mietwagen buchen“). App öffnet DiscoverCars Affiliate.',
    );
    wantsLiveSearch = true;
  }

  if (kind === 'luggage') {
    const profile = getCachedUserProfile();
    const bounceOk = isBounceAvailableForCity(
      profile?.cityId,
      profile?.cityName,
    );
    if (bounceOk) {
      parts.push(
        'Gepäck-Kontext: Partner Bounce NUR wenn Spot plausibel in der Nähe (Hotel, Bahnhof, Anleger) — BOOK_BOUNCE_LUGGAGE.',
        'Kein „hier ist unser Partner“ ohne konkretes nahbares Ergebnis. App öffnet Bounce-Link.',
      );
    } else {
      parts.push(
        'Gepäck-Kontext: Bounce/Partner hier NICHT verfügbar (z. B. Insel ohne Station). NICHT BOOK_BOUNCE_LUGGAGE.',
        'Alternative vorschlagen: Hotel-Gepäck/Rezeption, Bahnhof/Inselbahnhof, Fähr-Anleger — ehrlich sagen, dass kein Partner-Spot vor Ort ist.',
      );
    }
    wantsLiveSearch = true;
  }

  const stay22Destination = queryWantsStay22(text, kind)
    ? resolveStay22Destination(text)
    : null;

  const accommodationHints: ConciergeContext['accommodationHints'] = [];

  if (
    !namedDestination &&
    (kind === 'accommodation' || queryWantsStay22(text, kind))
  ) {
    const hotels = await findAccommodationCandidates(text, 3);
    for (const h of hotels) {
      const name = shortName(h.poi);
      accommodationHints.push({
        poiId: h.poi.id,
        name,
        why: h.why,
        distanceM: h.distanceM,
      });
      if (!primaryOffer) {
        primaryOffer = {
          poiId: h.poi.id,
          name,
          lat: h.poi.lat,
          lng: h.poi.lng,
        };
      } else {
        alternatives.push({
          poiId: h.poi.id,
          name,
          lat: h.poi.lat,
          lng: h.poi.lng,
        });
      }
    }

    const hintLines =
      accommodationHints.length > 0
        ? accommodationHints
            .map((h, i) => {
              const dist =
                h.distanceM != null
                  ? h.distanceM < 1000
                    ? `${h.distanceM} m`
                    : `${(h.distanceM / 1000).toFixed(1)} km`
                  : 'Entfernung unbekannt';
              return `${i + 1}. ${h.name} (#${h.poiId}) — ${dist} — ${h.why}`;
            })
            .join('\n')
        : 'Keine Hotels/Pensionen im lokalen Stadt-Pack gefunden.';

    parts.push(
      `Unterkunft-Kontext für ${stay22Destination ?? 'diese Stadt'}:`,
      'KONKRETE LOKALE TIPPS (nur diese nennen — nichts erfinden):',
      hintLines,
      'In speechText 1–3 konkrete Namen aus der Liste nennen (kurz warum/Entfernung).',
      'visualBullets: 1–3 Stichpunkte à 1 Zeile (oft 1 reicht); Name + Distanz/Highlight — nicht auffüllen.',
      'START_NAVIGATION NUR bei explizitem Bewegungswunsch („Bring mich“, „Navigiere“, „Wie komme ich“). Bei Info-Fragen (Wann/Gibt es/Frühstück/Öffnungszeiten) KEINE Navigation — nur antworten.',
      'Zusätzlich BOOK_STAY22 („🏨 Mehr Unterkünfte“) für weitere Hotels/Ferienwohnungen online — Stay22, Affiliate findus.',
      'Keine erfundenen Hotelketten oder Sterne-Bewertungen ohne Beleg.',
    );
    wantsLiveSearch = accommodationHints.length === 0;
  }

  const wantsTours = queryWantsTours(text, kind);
  const tourKind = wantsTours ? resolveTourKind(text) : null;
  const tourDestination = wantsTours
    ? resolveStay22Destination(text)
    : null;

  if (kind === 'tours' || wantsTours) {
    parts.push(
      `Tour-/Ticket-Kontext: Ziel „${tourDestination ?? 'Stadt'}“, Typ ${tourKind ?? 'tour'}.`,
      'App hängt automatisch OPEN_URL (GYG/Musement/Viator-Suche) an — keine Fake-Slugs erfinden.',
      'Bei Museen Musement bevorzugen; VIP/weltweit Viator; sonst GetYourGuide-Suche.',
    );
    wantsLiveSearch = true;
  }

  parts.push(
    'VERBOTEN: geschlossene/schlechte/weite Tipps; „schau in die App“ als Ausweichmanöver; lange Rückfragen.',
    'ADRESSEN: nie aussprechen, außer der User fragt explizit nach Adresse/Straße — dann VOLL (Straße + Hausnummer + Ort) und in visualBullets.',
    'ANTI-HALLUZINATION: Öffnungs-/Frühstückszeiten/Preise NUR aus Tools/Live-Daten — nichts schätzen oder erfinden.',
    FINDUS_JUST_DO_IT_BLOCK,
    FINDUS_ANSWER_FIRST_BLOCK,
    FINDUS_HELP_FIRST_MONETIZATION_BLOCK,
    FINDUS_COMPOUND_PLAN_BLOCK,
    FINDUS_TOURIST_FRICTION_BLOCK,
    FINDUS_BOOKING_PLATFORM_HARD_MATCH_BLOCK,
  );

  for (const hint of namedBookingPortalPromptHints(text)) {
    parts.push(hint);
  }

  try {
    const { softAddressingPromptBlock } = await import(
      '../memory/preferenceCaptureMiddleware'
    );
    parts.push(softAddressingPromptBlock());
  } catch {
    /* ignore */
  }
  try {
    const {
      matchLearnedRules,
      formatLearnedRulesPromptBlock,
      noteLearnedRulesMatched,
    } = await import('../memory/correctionLearning');
    const matched = matchLearnedRules({ userText: text, limit: 4 });
    const block = formatLearnedRulesPromptBlock(matched);
    if (block) {
      parts.push(block);
      void noteLearnedRulesMatched(matched).catch(() => {});
    }
  } catch {
    /* ignore */
  }
  try {
    const {
      matchProductSituationBlueprints,
      formatProductBlueprintsPromptBlock,
    } = await import('../memory/betaSituationSync');
    const productRules = await matchProductSituationBlueprints({
      userText: text,
      limit: 3,
    });
    const pBlock = formatProductBlueprintsPromptBlock(productRules);
    if (pBlock) parts.push(pBlock);
  } catch {
    /* ignore */
  }
  try {
    const {
      collectiveLearningPromptBlock,
      communityDiscoveredPlacesPromptBlock,
    } = await import('../memory/collectiveLearning');
    const intentFamily =
      kind === 'food' || kind === 'reservation'
        ? 'dining'
        : kind === 'accommodation'
          ? 'hotel'
          : kind === 'infra' || kind === 'travel'
            ? 'navigation'
            : 'general';
    const city =
      getCachedUserProfile()?.cityName ??
      useFinnusStore.getState().currentLocationName ??
      null;
    const collective = collectiveLearningPromptBlock({ intentFamily });
    if (collective) parts.push(collective);
    const overlay = communityDiscoveredPlacesPromptBlock({
      cityHint: city,
      limit: 8,
      kinds:
        kind === 'food' || kind === 'reservation'
          ? ['restaurant', 'cafe', 'place']
          : kind === 'accommodation'
            ? ['hotel', 'place']
            : null,
    });
    if (overlay) parts.push(overlay);
  } catch {
    /* ignore */
  }
  try {
    const { temporalPromptBlock } = await import('../time/temporalGerman');
    parts.push(temporalPromptBlock());
  } catch {
    /* ignore */
  }
  try {
    const { contextTriggerPromptBlock } = await import(
      '../ui/contextTriggerMatrix'
    );
    const ctxTrig = contextTriggerPromptBlock();
    if (ctxTrig) parts.push(ctxTrig);
  } catch {
    /* ignore */
  }
  try {
    const { proactiveReasoningPromptBlock } = await import(
      './proactiveReasoning'
    );
    parts.push(proactiveReasoningPromptBlock(text));
  } catch {
    /* ignore */
  }

  return {
    kind,
    promptBlock: parts.join('\n'),
    primaryOffer,
    alternatives,
    namedDestination,
    wantsLiveSearch,
    wantsCarRental: queryWantsCarRental(text, kind),
    wantsBounceLuggage: queryWantsBounceLuggage(text, kind),
    wantsStay22: !namedDestination && queryWantsStay22(text, kind),
    stay22Destination: namedDestination ? null : stay22Destination,
    accommodationHints,
    wantsTours,
    tourKind,
    tourDestination,
    fallbackSpeech,
    fallbackBullets,
    eventResearch,
    webResearch,
    maxQuickActions,
  };
}

/** Nav-Offers setzen, damit „Ja“ / Name sofort startet. */
export function applyConciergeNavOffers(ctx: ConciergeContext): void {
  const store = useFinnusStore.getState();
  if (ctx.primaryOffer) {
    store.setPendingNavOffer(ctx.primaryOffer);
  }
  store.setPendingNavAlternatives(ctx.alternatives);
}
