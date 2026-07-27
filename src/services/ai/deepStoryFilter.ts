/**
 * Deep-Story-Filter: POI-Fakten für Narration bereinigen.
 * User-zentriert (Alter, Transport, Interessen, Jahreszahlen) +
 * harte Sperre für ÖPNV-/Taxi-/Tarif-Müll und Fake-Höchstmarken.
 */

import type { PoiWithFacts } from '../../db/types';
import type { UserProfile } from '../../types/userProfile';
import { getCachedUserProfile } from '../userProfileService';
import {
  buildLiveContext,
  resolveTransportMode,
  resolveUserInterestIds,
  resolveYearsPreference,
  yearToHumanEra,
  type TransportMode,
  type YearsPreference,
} from './promptBuilder';
import type { SessionMemory } from './sessionMemory';
import {
  parseTagsJson,
  themeTagToInterestIds,
} from '../geo/triggerPolicy';

const YEAR_RE = /\b(1[0-9]{3}|20[0-9]{2})\b/g;
const CONTACT_RE =
  /(@[\w.-]+\.\w+)|(\+?\d[\d\s/()-]{6,}\d)|(https?:\/\/\S+)|(\b(e-?mail|telefon|tel\.|fax|www\.)\b)/gi;

/** Absolut verbotener Infrastruktur-/Admin-Müll (Storytelling-Tour). */
export const TRANSIT_TRASH_FACT_RE =
  /(taxi|taxistand|taxitarif|kilometerpreis|app[- ]?bestellung|schleswig[- ]?holsteinische[rn]?\s+taxitarif|hvv|tarifzone|deutschlandticket|ring\s*[a-d]\b|ds100|stationsnummer|ausfallstatistik|pünktlichkeits|puenktlichkeits|verspätungsquote|verspaetungsquote|\brb\s*[-/]?\s*\d{1,3}\b|\bre\s*[-/]?\s*\d{1,3}\b|\bs\s*[-/]?\s*\d{1,3}\b|\bu\s*[-/]?\s*\d{1,3}\b|liniennummer|busnetz|fahrplanausfall)/i;

/** Fahrrad-Infrastruktur — nur bei transportMode bike/mixed. */
export const BIKE_INFRA_FACT_RE =
  /(fahrrad|radweg|radfahrer|radständer|radstaender|bike\s?share|fahrradverleih|lastenrad|e[- ]?bike|stellplatz.*rad|rad.*stellplatz)/i;

export function isBikeInfraFact(text: string): boolean {
  return BIKE_INFRA_FACT_RE.test(text);
}

/**
 * Verdächtige Fake-Höchstmarken / erfundene Superlative ohne Ortsbezug.
 * Fängt auch Prompt-Leakage (123m/132m/147m-Turm-Few-Shots) ab.
 */
export const FABRICATED_SUPERLATIVE_RE =
  /(höchste[rn]?\s+turm\s+(der\s+welt|europas|deutschlands)|(?:\d{2,3}|einhundert(?:dreiundzwanzig|zweiunddrei(?:ß|ss)ig|siebenundvierzig))\s*m(?:eter)?\s+hoch|einhundert(?:dreiundzwanzig|zweiunddrei(?:ß|ss)ig|siebenundvierzig)\s+meter|weltrekord.*turm|größter\s+turm\s+der\s+welt|(?:zur\s+)?spitze.*(?:meter|hoch)|turm(?:höhe|spitze).*(?:meter|hoch))/i;

/** Gebäudehöhe / Turmspitze — oft Halluzination bei Bahnhöfen. */
export const INVENTED_HEIGHT_OR_SPIRE_RE =
  /((?:\d{2,3}|einhundert\w*|hundert\w*)\s*meter\s+hoch|(?:zur\s+)?spitze\b|turm(?:spitze|höhe)?\b|ragt\s+\w+\s+meter|meter\s+in\s+den\s+himmel)/i;

export type DeepStoryFact = {
  id: number;
  text: string;
  hasYear: boolean;
  isHours: boolean;
};

export type DeepStoryBundle = {
  poiId: number;
  poiName: string;
  yearsPreference: YearsPreference;
  transportMode: TransportMode;
  alreadyVisited: boolean;
  hoursHint: string | null;
  facts: DeepStoryFact[];
  promptFactsBlock: string;
};

function stripPrefix(text: string): string {
  return text
    .replace(
      /^\[(Kurzfakt|Erzählung|Detail|Thema:[^\]]+|Hook|Narration|Topic:[^\]]+)\]\s*/u,
      '',
    )
    .trim();
}

function isHoursRelated(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /\[thema:(öffnungs|oeffnungs|opening|zeiten|hours)/i.test(text) ||
    /öffnung|oeffnung|geöffnet|geoeffnet|geschlossen|opening|hours/i.test(
      lower,
    )
  );
}

function isContactDump(text: string): boolean {
  CONTACT_RE.lastIndex = 0;
  return CONTACT_RE.test(text);
}

function scrubContact(text: string): string {
  return text
    .replace(CONTACT_RE, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function isTransitTrashFact(text: string): boolean {
  return TRANSIT_TRASH_FACT_RE.test(text);
}

export function isFabricatedSuperlativeFact(text: string): boolean {
  return FABRICATED_SUPERLATIVE_RE.test(text);
}

export function isInventedHeightOrSpireClaim(text: string): boolean {
  return INVENTED_HEIGHT_OR_SPIRE_RE.test(text);
}

/**
 * true, wenn der Text Höhen/Spitzen behauptet, die in den Quellfakten
 * nicht vorkommen (typisch: Bahnhof bekommt Kirchturm-Few-Shot).
 */
export function hasUngroundedHeightClaim(
  text: string,
  sourceFacts: string[],
): boolean {
  if (!isInventedHeightOrSpireClaim(text)) return false;
  const blob = sourceFacts.join(' ').toLowerCase();
  const sourceHasHeight =
    /(meter\s+hoch|turmhöhe|turm\s+\d|spitze|höhe\s*:?\s*\d)/i.test(blob);
  // Bahnsteig-Längen zählen nicht als Gebäudehöhe
  const onlyPlatformLength =
    sourceHasHeight &&
    /(bahnsteig|gleis).{0,40}meter/i.test(blob) &&
    !/(turm|hoch|spitze|höhe)/i.test(blob.replace(/bahnsteig|gleis/gi, ''));
  if (!sourceHasHeight || onlyPlatformLength) return true;
  return false;
}

/** Absolute Adress-/Standort-Angaben — User steht schon vor Ort. */
export const ADDRESS_DUMP_FACT_RE =
  /(^\s*adresse\b|\bstraße\s+\d|\bstrasse\s+\d|\bplz\b|\b\d{5}\s+[A-ZÄÖÜa-zäöü]|\bhausnummer\b|\banschrift\b|\bzu finden unter\b|\bgelegen in der\s+\w+straße\b|\bgelegen in der\s+\w+strasse\b)/i;

export function isAddressDumpFact(text: string): boolean {
  return ADDRESS_DUMP_FACT_RE.test(text);
}

/** Bei "wenig": Jahreszahlen → relative Epochen (max. 1 behalten, Rest streichen). */
function rewriteYearsForPreference(
  text: string,
  pref: YearsPreference,
  keepYear: boolean,
): string {
  if (pref === 'viele') return text;
  if (pref === 'wenig' && !keepYear) {
    return text
      .replace(YEAR_RE, () => '')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+,/g, ',')
      .trim();
  }
  if (pref === 'wenig' || pref === 'neutral') {
    return text
      .replace(YEAR_RE, (raw) => {
        const y = Number(raw);
        return Number.isFinite(y) ? yearToHumanEra(y) : raw;
      })
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  return text;
}

export function filterDeepStoryFacts(
  poi: PoiWithFacts,
  options?: {
    profile?: UserProfile | null;
    sessionMemory?: SessionMemory | null;
    visitedPoiIds?: Iterable<number> | null;
    lastVisitedPoiId?: number | null;
    /** true = Navigations-Modus: ÖPNV/Taxi-Daten dürfen durch */
    navigationMode?: boolean;
  },
): DeepStoryBundle {
  const profile = options?.profile ?? getCachedUserProfile();
  const yearsPreference = resolveYearsPreference(profile);
  const transportMode = resolveTransportMode(profile);
  const interestIds = resolveUserInterestIds(profile);
  const live = buildLiveContext(poi);
  const allowTransitTrash = options?.navigationMode === true;

  const visited = new Set(options?.visitedPoiIds ?? []);
  if (options?.lastVisitedPoiId != null) visited.add(options.lastVisitedPoiId);
  for (const e of options?.sessionMemory?.entries ?? []) {
    visited.add(e.poiId);
  }

  const alreadyVisited = visited.has(poi.id);
  const facts: DeepStoryFact[] = [];
  let yearSlotsUsed = 0;
  // wenig = nur relative Epochen (max. 1), nie Absolute-Jahre
  const maxYears =
    yearsPreference === 'wenig' ? 1 : yearsPreference === 'neutral' ? 2 : 99;

  for (const f of poi.facts) {
    const raw = f.fact_text.trim();
    if (!raw) continue;
    if (isContactDump(raw)) continue;
    if (isAddressDumpFact(raw)) continue;

    // Bohrharte Müll-Sperre (außer Navigations-Modus)
    if (!allowTransitTrash && isTransitTrashFact(raw)) continue;
    if (isFabricatedSuperlativeFact(raw)) continue;

    // Fahrrad-Infra nur bei bike/mixed
    if (
      isBikeInfraFact(raw) &&
      transportMode !== 'bike' &&
      transportMode !== 'mixed'
    ) {
      continue;
    }

    const hours = isHoursRelated(raw);
    if (hours && live.hoursStatus === 'open' && !live.hoursHint) continue;

    let text = scrubContact(stripPrefix(raw));
    if (!text) continue;

    const hasYear = YEAR_RE.test(text);
    YEAR_RE.lastIndex = 0;

    if (hasYear) {
      const keep = yearSlotsUsed < maxYears;
      if (keep) yearSlotsUsed += 1;
      text = rewriteYearsForPreference(text, yearsPreference, keep);
      if (!text.replace(/[^\wäöüÄÖÜß]/gi, '').trim()) continue;
    }

    facts.push({
      id: f.id,
      text,
      hasYear,
      isHours: hours,
    });
  }

  // Harter Relevanz-Filter: nur die spannendsten ~20% (min 2, max 4), ohne Duplikate
  const poiTags = parseTagsJson(poi.tags_json);
  const ranked = [...facts]
    .map((f) => {
      const themeFromPrefix =
        f.text.match(/^\[Thema:([^\]]+)\]/i)?.[1]?.toLowerCase() ?? null;
      // stripPrefix already removed prefix from f.text — recover from raw facts
      const raw = poi.facts.find((x) => x.id === f.id)?.fact_text ?? '';
      const theme =
        raw.match(/^\[Thema:([^\]]+)\]/i)?.[1]?.toLowerCase() ??
        themeFromPrefix;
      return {
        f,
        score: scoreDeepFact(f, {
          transportMode,
          interestIds,
          themeTags: [...poiTags, ...(theme ? [theme] : [])],
        }),
      };
    })
    .sort((a, b) => b.score - a.score);

  const deduped: DeepStoryFact[] = [];
  for (const { f } of ranked) {
    if (deduped.some((kept) => factsAreNearDuplicates(kept.text, f.text))) {
      continue;
    }
    deduped.push(f);
  }
  const keepN = Math.max(2, Math.min(4, Math.ceil(deduped.length * 0.2) || 1));
  const topFacts = deduped.slice(0, keepN);

  const humanHoursHint =
    live.hoursHint && live.hoursStatus !== 'open'
      ? humanizeHoursHint(live.hoursHint, live.hoursStatus)
      : null;

  const promptFactsBlock =
    topFacts.length === 0
      ? '(keine sprechbaren Fakten nach Filter)'
      : topFacts.map((f) => `- ${f.text}`).join('\n');

  return {
    poiId: poi.id,
    poiName: poi.name,
    yearsPreference,
    transportMode,
    alreadyVisited,
    hoursHint: humanHoursHint,
    facts: topFacts,
    promptFactsBlock,
  };
}

function scoreDeepFact(
  f: DeepStoryFact,
  ctx: {
    transportMode: TransportMode;
    interestIds: string[];
    themeTags?: string[];
  },
): number {
  if (f.isHours) return -5;
  if (isAddressDumpFact(f.text)) return -100;
  let score = 1;
  const lower = f.text.toLowerCase();

  if (isTransitTrashFact(f.text)) return -100;
  if (isFabricatedSuperlativeFact(f.text)) return -100;

  if (
    /(legende|sage|skandal|geheim|überrasch|erstmals|höchste|älteste|einzige|drama|liebe|brand|krieg|mahnmal|kurios|baumeister|architekt|fassade|skulptur|relief)/i.test(
      lower,
    )
  ) {
    score += 8;
  }
  if (/(meter|turm|tonne|aussicht|fahrstuhl|stufen|schüler|jahrgang|fußballfeld|grundstück)/i.test(lower)) score += 4;
  if (f.text.length > 80) score += 2;
  if (/^(erbaut|gebaut|baujahr|fläche|räume|adresse)/i.test(lower)) score -= 4;
  if (/(adresse|straße\s+\d|plz|anschrift)/i.test(lower)) score -= 20;
  if (/(gehört zum alltag|zum dorfleben|teil des alltags)/i.test(lower)) score -= 15;
  if (f.hasYear && f.text.length < 40) score -= 2;

  // Interessen-Boost
  if (
    (ctx.interestIds.includes('architektur') ||
      ctx.interestIds.includes('museen')) &&
    /(fassade|architektur|stil|backstein|gotik|barock|jugendstil|skulptur|relief|portal|giebel)/i.test(
      lower,
    )
  ) {
    score += 6;
  }
  if (
    ctx.interestIds.includes('legenden') &&
    /(legende|sage|geheim|geister|myth)/i.test(lower)
  ) {
    score += 5;
  }
  if (
    ctx.interestIds.includes('personen') &&
    /(person|heirat|geboren|gestorben|berühm|promi|künstler|autor|schriftsteller)/i.test(
      lower,
    )
  ) {
    score += 6;
  }
  if (
    ctx.interestIds.includes('kirchen') &&
    /(kirche|kapelle|dom|altar|orgel|sakral)/i.test(lower)
  ) {
    score += 5;
  }
  if (
    (ctx.interestIds.includes('abendessen') ||
      ctx.interestIds.includes('streetfood') ||
      ctx.interestIds.includes('kaffee') ||
      ctx.interestIds.includes('fruehstueck')) &&
    /(restaurant|café|cafe|speise|küche|gericht|fisch|mittag|frühstück)/i.test(
      lower,
    )
  ) {
    score += 4;
  }

  // Thema-Tags aus Fact-Prefix / POI
  for (const tag of ctx.themeTags ?? []) {
    const interests = themeTagToInterestIds(tag);
    if (interests.some((id) => ctx.interestIds.includes(id))) {
      score += 5;
      break;
    }
  }

  // Transport: Bike-Infra nur pushen wenn relevant
  if (isBikeInfraFact(f.text)) {
    if (ctx.transportMode === 'bike' || ctx.transportMode === 'mixed') {
      score += 5;
    } else {
      score -= 20;
    }
  }

  return score;
}

/** Grobe Duplikat-Erkennung: gleicher Kerninhalt, nur umformuliert. */
function factsAreNearDuplicates(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFKC')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) {
    const shorter = Math.min(na.length, nb.length);
    const longer = Math.max(na.length, nb.length);
    return shorter >= 24 && shorter / longer >= 0.55;
  }
  const ta = new Set(na.split(' ').filter((w) => w.length > 3));
  const tb = new Set(nb.split(' ').filter((w) => w.length > 3));
  if (ta.size < 3 || tb.size < 3) return false;
  let overlap = 0;
  for (const w of ta) if (tb.has(w)) overlap += 1;
  const ratio = overlap / Math.min(ta.size, tb.size);
  return ratio >= 0.7;
}

function humanizeHoursHint(hint: string, status: string): string {
  if (/auf/i.test(hint) && /uhr/i.test(hint)) {
    return hint
      .replace(/^Macht/, 'Hat leider erst')
      .replace(/ auf\.$/, ' offen.');
  }
  if (status === 'closed') {
    return hint.startsWith('Hat') ? hint : `Hat leider gerade zu. ${hint}`;
  }
  return hint;
}
