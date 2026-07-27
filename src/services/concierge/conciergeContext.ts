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
import { isBounceAvailableForCity } from '../affiliate/affiliateService';
import { getWeatherPromptBlock } from '../weatherService';
import {
  buildPoiReservationInfo,
  buildReservationPromptBlock,
} from '../reservation/reservationService';

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
  /** Gemini Search Grounding sinnvoll */
  wantsLiveSearch: boolean;
  /** Mietwagen-Button (Economy Bookings) anbieten */
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
};

const FOOD_RE =
  /\b(hunger|hungrig|bock\s+auf|lust\s+auf|essen|burger|pizza|döner|doener|sushi|restaurant|café|cafe|kaffee|imbiss|mittag|abendessen|frühstück|fruehstueck|vegetar|vegan|griech|italiener|asia|curry|fisch|schnitzel)\b/iu;

const WEATHER_RE =
  /\b(regen|regnet|wetter|sonne|sonnig|sturm|gewitter|kalt|warm|temperatur|schnee|windig|giessen|gießen|schauer|anziehen|outfit|jacke|pulli|windjacke|kleidung|schirm|regenschirm)\b/iu;

const INFRA_RE =
  /\b(leihfahrrad|stadtrad|fahrrad|bike\s*share|geldautomat|bankomat|atm|haltestelle|bushaltestelle|ladestation|wc|toilette|apotheke)\b/iu;

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

const WALK_M_PER_MIN = 80;
const BIKE_M_PER_MIN = 220;
const MAX_FOOD_DIST_M = 2500;

export function detectConciergeKind(text: string): ConciergeKind | null {
  const t = text.trim();
  if (!t) return null;
  if (RESERVATION_RE.test(t)) return 'reservation';
  if (ACCOMMODATION_RE.test(t)) return 'accommodation';
  if (LUGGAGE_RE.test(t)) return 'luggage';
  if (TOURS_RE.test(t)) return 'tours';
  if (CAR_RENTAL_RE.test(t)) return 'travel';
  if (FLIGHT_RE.test(t)) return 'flight';
  if (TRAVEL_ROUTE_RE.test(t)) return 'travel';
  if (WEATHER_RE.test(t)) return 'weather';
  if (INFRA_RE.test(t)) return 'infra';
  if (FOOD_RE.test(t)) return 'food';
  if (CONCIERGE_ANY.test(t)) return 'general';
  return null;
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

/** Zielstadt aus Frage ziehen, sonst Profil-Stadt. */
export function resolveStay22Destination(text: string): string {
  const t = text.trim();
  const patterns = [
    /\b(?:in|nach|für|fuer)\s+([A-ZÄÖÜ][\wÄÖÜäöüß\-]+(?:\s+[A-ZÄÖÜ][\wÄÖÜäöüß\-]+)?)/u,
    /\b(?:hotel|ferienwohnung|apartment|unterkunft)\s+(?:in\s+)?([A-ZÄÖÜ][\wÄÖÜäöüß\-]+)/iu,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m?.[1]) {
      const city = m[1].trim();
      if (
        !/^(Hotel|Ferienwohnung|Apartment|Unterkunft|Airbnb|Hostel|Pension)$/i.test(
          city,
        )
      ) {
        return city;
      }
    }
  }
  return getCachedUserProfile()?.cityName?.trim() || 'Germany';
}

export function queryWantsStay22(
  text: string,
  kind?: ConciergeKind | null,
): boolean {
  if (kind === 'accommodation') return true;
  return ACCOMMODATION_RE.test(text.trim());
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
    const blob = `${poi.name} ${(poi.category ?? '')} ${(poi.teaser_text ?? '')}`.toLowerCase();
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

    let distanceM: number | null = null;
    let walkMinutes: number | null = null;
    if (coords) {
      distanceM = Math.round(
        haversineMeters(coords.lat, coords.lng, poi.lat, poi.lng),
      );
      walkMinutes = walkMin(distanceM);
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
  return detectConciergeKind(text) != null;
}

function shortName(poi: Poi): string {
  return poi.name
    .replace(/\s*[·•|]\s*Wegweiser\s*$/i, '')
    .replace(/\s+und\s+historisches.*$/i, '')
    .trim();
}

function userCoords(): { lat: number; lng: number } | null {
  const s = useFinnusStore.getState();
  if (s.lastGpsLat == null || s.lastGpsLng == null) return null;
  return { lat: s.lastGpsLat, lng: s.lastGpsLng };
}

function walkMin(distanceM: number): number {
  const mobility = resolvePersonaEngine(getCachedUserProfile()).mobilityMode;
  const mpm = mobility === 'bike' ? BIKE_M_PER_MIN : WALK_M_PER_MIN;
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
  const kind = detectConciergeKind(text);
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

  let wantsLiveSearch =
    kind === 'flight' ||
    kind === 'travel' ||
    kind === 'luggage' ||
    kind === 'accommodation' ||
    kind === 'tours' ||
    kind === 'weather' ||
    kind === 'food';

  if (kind === 'food' || kind === 'reservation' || kind === 'general') {
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
        const offer = { poiId: c.poi.id, name };
        if (i === 0) primaryOffer = offer;
        else alternatives.push(offer);
      });
      parts.push(
        'Antworte wie im Concierge-Beispiel: 1–2 Optionen, Insider-Highlight, Gehzeit, dann „Welchen nehmen wir? Ich schalte dir sofort den Kompass an!“',
      );
    } else {
      parts.push(
        'Keine passenden lokalen Gastro-POIs in Reichweite. Nutze Search-Grounding für echte geöffnete Orte in der Nähe — nur gut bewertet und erreichbar.',
      );
      wantsLiveSearch = true;
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
        primaryOffer = { poiId: food[0].poi.id, name };
      } else {
        alternatives.push({ poiId: food[0].poi.id, name });
      }
    }
    parts.push(
      'Bei Regen: aktive Empfehlung (jetzt los ODER Indoor). Bei Outfit-Fragen: Wetter kurz erklären + begründete Kleidungstipps in visualBullets. Action-Outro nur wenn sinnvoll.',
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
        const offer = { poiId: c.poi.id, name };
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
      'Wenn Weiterfahrt oder Flexibilität sinnvoll: BOOK_CAR_RENTAL („🚗 Mietwagen buchen“) anbieten — Economy Bookings.',
    );
    wantsLiveSearch = true;
  }

  if (kind === 'travel') {
    parts.push(
      'Reise-/Strecken-Kontext: Bei sinnvoller Mietwagen-Empfehlung BOOK_CAR_RENTAL anbieten (Label „🚗 Mietwagen buchen“). App öffnet Economy Bookings Referral.',
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

  if (kind === 'accommodation' || queryWantsStay22(text, kind)) {
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
        primaryOffer = { poiId: h.poi.id, name };
      } else {
        alternatives.push({ poiId: h.poi.id, name });
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
      'visualBullets: 1–3 Stichpunkte (oft 1 reicht); Name + Distanz/Highlight — nicht auffüllen.',
      'START_NAVIGATION zum favorisierten Haus, wenn sinnvoll.',
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
  );

  return {
    kind,
    promptBlock: parts.join('\n'),
    primaryOffer,
    alternatives,
    wantsLiveSearch,
    wantsCarRental: queryWantsCarRental(text, kind),
    wantsBounceLuggage: queryWantsBounceLuggage(text, kind),
    wantsStay22: queryWantsStay22(text, kind),
    stay22Destination,
    accommodationHints,
    wantsTours,
    tourKind,
    tourDestination,
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
