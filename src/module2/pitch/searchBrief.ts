/**
 * Search-Brief — Call-1 Must-Haves + Kriterien-Gewichte → Filter fürs Backend.
 * Dataset + Must-Filter; Ranking in candidateRank (liest weight/criteria).
 */

import type { PitchCall1Criterion, PitchKind, PitchWish } from './types';
import { parseWishesFromText } from './parentBrief';
import {
  looksLikeCattleBreed,
  looksLikePannfisch,
  normalizeFoodStt,
} from './specializedFoodMatch';
import {
  criteriaToMustHaveLabels,
  isStructuralCriterionKey,
  mergeCall1Criteria,
  type Call1Criterion,
} from './call1Criteria';

export type SearchDataset =
  | 'places_live'
  | 'pack_local'
  | 'places_plus_pack'
  | 'stay22'
  | 'cinema_web'
  | 'events_web';

export type PitchSearchBrief = {
  /** Was Call 1 verstanden hat (für Call-2-Speech) */
  authorIntent: string | null;
  /** Hard-Filter-Labels aus Call 1 + Heuristik */
  mustHaves: string[];
  /** Als PitchWish gemerged (dish/cuisine/amenity/…) */
  wishes: PitchWish[];
  /** Call-1 Kriterien inkl. Gewichte */
  criteria: PitchCall1Criterion[];
  /** Welcher Datensatz zuerst */
  dataset: SearchDataset;
  /** Shortlist vor Speak-Pick */
  shortlistSize: number;
  /** Optionen in Speech/UI (Favorit + Alternative) */
  speakTop: number;
};

const SHORTLIST = 5;
const SPEAK_TOP = 2;

/** Atmosphäre / Dorfküche — Ranking-Boost, nie Hard-Wipe. */
export function isAtmosphereVibeLabel(label: string): boolean {
  return /authentisch|heimisch|heimelige?|dorf(?:küche|kueche)?|homestyle|home[\s-]?style|gemütlich|gemuetlich|nicht\s+steril|unsteril|häuslich|haeuslich|family[\s-]?style|traditionell|rustikal|cozy|hausgemacht|homemade|ländlich|laendlich/i.test(
    label,
  );
}

function kindForMustHave(label: string): PitchWish['kind'] {
  const t = label.toLowerCase();
  if (
    /pool|sauna|spa|massage|jacuzzi|whirlpool|all-?inclusive|zugrestaurant|speisewagen|takeaway|barrierefrei|park|wlan|wifi|wi-?fi|steckdose|socket|power_outlet|strom/.test(
      t,
    )
  ) {
    return 'amenity';
  }
  if (
    isAtmosphereVibeLabel(t) ||
    /blick|rooftop|terrasse|biergarten|sonnenuntergang|ruhig|quiet|atmosphere/.test(
      t,
    )
  ) {
    return 'vibe';
  }
  if (
    /vegan|vegetar|italien|pizza|asia|asiatisch|indisch|indian|japanisch|chinesisch|thai|vietnam|koreanisch|mexikanisch|griech|türk|tuerk|steakhouse|frühstück|fruehstueck/.test(
      t,
    )
  ) {
    return 'cuisine';
  }
  return 'dish';
}

function normalizeWishText(raw: string): string {
  let text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!text || text.length < 2) return '';
  text = normalizeFoodStt(text);
  if (/^(wifi|wlan|wi-fi|internet|power_outlet)$/i.test(text)) {
    if (/power_outlet/i.test(text)) text = 'steckdose';
    else text = 'wlan';
  }
  if (/^(steckdose|socket|strom)$/i.test(text)) text = 'steckdose';
  if (/^(quiet|ruhig|ruhe|lautlos|atmosphere)$/i.test(text)) text = 'ruhig';
  if (looksLikePannfisch(text)) text = 'pannfisch';
  if (/^(doener|kebab|kebap)$/i.test(text)) text = 'döner';
  if (looksLikeCattleBreed(text)) {
    try {
      const { canonicalCattleBreed } = require('./specializedFoodMatch') as {
        canonicalCattleBreed: (s: string) => string | null;
      };
      text = canonicalCattleBreed(text) || text;
    } catch {
      /* soft */
    }
  }
  return text;
}

/** Call-1 / Frame Must-Haves → PitchWish (must). Zeit/Struktur/Stadt raus; Atmosphäre = nice. */
export function wishesFromMustHaves(mustHaves: string[]): PitchWish[] {
  const out: PitchWish[] = [];
  const seen = new Set<string>();
  for (const raw of mustHaves) {
    const text = normalizeWishText(raw);
    if (!text) continue;
    if (isStructuralCriterionKey(text)) continue;
    if (looksLikeCityOnlyMustHave(text)) continue;
    const kind = kindForMustHave(text);
    const key = `${kind}:${text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const atmosphere = kind === 'vibe' && isAtmosphereVibeLabel(text);
    out.push({
      text,
      hardness: atmosphere ? 'nice' : 'must',
      kind,
      weight: atmosphere ? 12 : 20,
    });
  }
  return out;
}

/** Reine Stadt als Must-Have → destCity, kein Dish-Wipe. */
function looksLikeCityOnlyMustHave(label: string): boolean {
  const t = String(label || '').replace(/\s+/g, ' ').trim();
  if (t.length < 3 || t.length > 40) return false;
  if (
    /\b(restaurant|essen|küche|kueche|vegan|indisch|steak|pizza|hotel|pool|terrasse|authent|heimisch|dorf|gemütlich|angus|wagyu)\b/i.test(
      t,
    )
  ) {
    return false;
  }
  try {
    const { extractCityFromText } = require('../context/shortTermContext') as {
      extractCityFromText: (s: string) => string | null;
    };
    const city = extractCityFromText(t);
    return Boolean(city && city.toLowerCase() === t.toLowerCase());
  } catch {
    return false;
  }
}

/** Call-1 criteria → PitchWish (mit weight). Structural Keys überspringen. */
export function wishesFromCriteria(criteria: Call1Criterion[]): PitchWish[] {
  const out: PitchWish[] = [];
  const seen = new Set<string>();
  for (const c of criteria) {
    if (isStructuralCriterionKey(c.key)) continue;
    if (c.role === 'soft') continue;
    const text = normalizeWishText(c.key);
    if (!text) continue;
    const kind = kindForMustHave(text);
    const key = `${kind}:${text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const atmosphere = kind === 'vibe' && isAtmosphereVibeLabel(text);
    out.push({
      text,
      hardness:
        atmosphere || c.role === 'nice' ? 'nice' : 'must',
      kind,
      weight: atmosphere ? Math.min(c.weight, 12) : c.weight,
    });
  }
  return out;
}

export function mergeWishLists(
  primary: PitchWish[],
  extra: PitchWish[],
): PitchWish[] {
  const out = [...primary];
  for (const w of extra) {
    if (
      out.some(
        (x) =>
          x.kind === w.kind &&
          x.text.toLowerCase() === w.text.toLowerCase(),
      )
    ) {
      continue;
    }
    out.push(w);
  }
  return out;
}

export function datasetForKind(kind: PitchKind): SearchDataset {
  if (kind === 'hotel') return 'stay22';
  if (kind === 'cinema') return 'cinema_web';
  if (kind === 'food' || kind === 'bar') return 'places_plus_pack';
  if (kind === 'sight' || kind === 'tour') return 'places_plus_pack';
  return 'places_live';
}

/**
 * Baut den Search-Brief: Text + Call-1 Must-Haves/Criteria + authorIntent.
 */
export function buildPitchSearchBrief(opts: {
  userText: string;
  kind: PitchKind;
  baseWishes: PitchWish[];
  call1MustHaves?: string[] | null;
  call1Criteria?: Call1Criterion[] | null;
  authorIntent?: string | null;
}): PitchSearchBrief {
  const criteria = mergeCall1Criteria({
    criteria: opts.call1Criteria,
    mustHaves: opts.call1MustHaves,
  });
  const fromCriteria = wishesFromCriteria(criteria);
  const fromCall1 = wishesFromMustHaves(opts.call1MustHaves ?? []);
  const fromText = parseWishesFromText(opts.userText);
  let wishes = mergeWishLists(
    mergeWishLists(opts.baseWishes, fromText),
    mergeWishLists(fromCall1, fromCriteria),
  );
  // Call-1-Gewichte auf bestehende Wishes spiegeln
  if (criteria.length) {
    wishes = wishes.map((w) => {
      const hit = criteria.find(
        (c) =>
          !isStructuralCriterionKey(c.key) &&
          w.text.toLowerCase().includes(c.key.toLowerCase()),
      );
      if (!hit || w.weight != null) return w;
      return {
        ...w,
        weight: hit.weight,
        hardness: hit.role === 'nice' ? 'nice' : w.hardness,
      };
    });
  }
  const mustFromCriteria = criteriaToMustHaveLabels(criteria);
  const mustHaves = [
    ...new Set([
      ...mustFromCriteria,
      ...(opts.call1MustHaves ?? []).map((m) => String(m).trim()).filter(Boolean),
      ...wishes
        .filter((w) => w.hardness === 'must' && w.kind !== 'generic')
        .map((w) => w.text),
    ]),
  ].slice(0, 8);

  return {
    authorIntent: (opts.authorIntent || '').trim().slice(0, 280) || null,
    mustHaves,
    wishes,
    criteria,
    dataset: datasetForKind(opts.kind),
    shortlistSize: SHORTLIST,
    speakTop: SPEAK_TOP,
  };
}

/**
 * Empty→Retry: Atmosphäre/Zeit-Müll raus, Cuisine behalten, Stadt-Suche breiter.
 * Analog named-schedule Retry — lieber zweite Suche als sofort „kein Treffer“.
 */
export function broadenDiningPitchRequest<T extends {
  wishes: PitchWish[];
  searchMode?: string;
  shortlistSize?: number;
  cityHint?: string | null;
}>(req: T): T {
  const wishes = req.wishes
    .filter((w) => {
      if (isStructuralCriterionKey(w.text)) return false;
      if (w.kind === 'dish' && isAtmosphereVibeLabel(w.text)) return false;
      if (w.kind === 'generic' && isAtmosphereVibeLabel(w.text)) return false;
      return true;
    })
    .map((w) => {
      if (w.kind === 'vibe' && isAtmosphereVibeLabel(w.text)) {
        return { ...w, hardness: 'nice' as const, weight: Math.min(w.weight ?? 12, 12) };
      }
      if (w.kind === 'vibe' && w.hardness === 'must') {
        return { ...w, hardness: 'nice' as const };
      }
      return w;
    });
  return {
    ...req,
    wishes,
    searchMode: 'city_best',
    shortlistSize: Math.max(req.shortlistSize ?? SHORTLIST, SHORTLIST),
  };
}
