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
  isNegativeCriterion,
  avoidTokensFromNegativeCriterion,
  negativesFromUserText,
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
  /** Ablehnungen aus Call-1 („kein Asiatisch“ / cuisine_not_*) */
  avoidFromCall1: string[];
  /** Welcher Datensatz zuerst */
  dataset: SearchDataset;
  /** Shortlist vor Speak-Pick */
  shortlistSize: number;
  /** Optionen in Speech/UI (Favorit + Alternative) */
  speakTop: number;
};

const SHORTLIST = 5;
const SPEAK_TOP = 2;

/** Atmosphäre / Dorfküche / Terrasse / View — Ranking-Boost, nie Hard-Wipe. */
export function isAtmosphereVibeLabel(label: string): boolean {
  return /authentisch|heimisch|heimelige?|dorf(?:küche|kueche)?|homestyle|home[\s-]?style|gemütlich|gemuetlich|nicht\s+steril|unsteril|häuslich|haeuslich|family[\s-]?style|traditionell|rustikal|cozy|hausgemacht|homemade|ländlich|laendlich|ambiente|flair|atmosph|aussicht|ausblick|panorama|terrasse|terrace|biergarten|outdoor|rooftop|blick|view|ruhig|quiet|ruhe|lautlos/i.test(
    label,
  );
}

function kindForMustHave(label: string): PitchWish['kind'] {
  const t = label.toLowerCase();
  // AYCE / Buffet = Amenity (nie dish) — sonst Soft-Fill ohne scoreAyceEvidence-Gate
  if (
    /all[_-\s]*you[_-\s]*can[_-\s]*eat|allyoucaneat|\bayce\b|must_ayce|schlemmer[\s_-]*buffet|unbegrenzt\s+essen|unlimited\s+buffet|\bbuffet\b|flatrate\s+(?:essen|buffet|sushi)|rodiz/.test(
      t,
    )
  ) {
    return 'amenity';
  }
  if (
    /pool|sauna|spa|massage|jacuzzi|whirlpool|all-?inclusive|zugrestaurant|speisewagen|takeaway|barrierefrei|park|wlan|wifi|wi-?fi|steckdose|socket|power_outlet|strom/.test(
      t,
    )
  ) {
    return 'amenity';
  }
  if (
    isAtmosphereVibeLabel(t) ||
    /blick|rooftop|terrasse|terrace|biergarten|sonnenuntergang|ruhig|quiet|atmosphere|view/.test(
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
  try {
    const { looksLikeAyceQuery, normalizeAyceStt } = require('./ayceIntent') as {
      looksLikeAyceQuery: (s: string) => boolean;
      normalizeAyceStt: (s: string) => string;
    };
    const norm = normalizeAyceStt(text);
    if (
      looksLikeAyceQuery(text) ||
      looksLikeAyceQuery(norm) ||
      /must_ayce|all_you_can_eat/i.test(text)
    ) {
      return 'all_you_can_eat';
    }
  } catch {
    if (
      /all[\s_-]*you[\s_-]*can[\s_-]*eat|\bayce\b|must_ayce|schlemmer[\s_-]*buffet/i.test(
        text,
      )
    ) {
      return 'all_you_can_eat';
    }
  }
  if (/^(wifi|wlan|wi-fi|internet|power_outlet)$/i.test(text)) {
    if (/power_outlet/i.test(text)) text = 'steckdose';
    else text = 'wlan';
  }
  if (/^(steckdose|socket|strom)$/i.test(text)) text = 'steckdose';
  if (/^(quiet|ruhig|ruhe|lautlos|atmosphere)$/i.test(text)) text = 'ruhig';
  if (/^(terrace|outdoor\s*seating)$/i.test(text)) text = 'terrasse';
  if (/^(view|scenic\s*view)$/i.test(text)) text = 'aussicht';
  // LLM-Labels „besten Terrasse“ / „gute Aussicht“ → kanonisch (nie Hard-Wipe)
  if (/\bterrasse|terrace\b/i.test(text) && !/^terrasse$/i.test(text)) {
    text = 'terrasse';
  } else if (
    /\b(aussicht|ausblick|panorama|view)\b/i.test(text) &&
    !/^(aussicht|ausblick)$/i.test(text) &&
    !/\b(restaurant|hotel|essen)\b/i.test(text)
  ) {
    text = 'aussicht';
  } else if (/\bruhig\b/i.test(text) && !/^ruhig$/i.test(text)) {
    text = 'ruhig';
  }
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
    if (/^fleisch$/i.test(text)) continue;
    if (isStructuralCriterionKey(text)) continue;
    if (looksLikeCityOnlyMustHave(text)) continue;
    const kind = kindForMustHave(text);
    const key = `${kind}:${text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const atmosphere =
      kind === 'vibe' || isAtmosphereVibeLabel(text);
    const forcedKind = atmosphere && kind === 'dish' ? 'vibe' : kind;
    out.push({
      text,
      hardness: atmosphere ? 'nice' : 'must',
      kind: forcedKind,
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
    const atmosphere =
      kind === 'vibe' || isAtmosphereVibeLabel(text) || c.role === 'nice';
    const forcedKind =
      isAtmosphereVibeLabel(text) && kind === 'dish' ? 'vibe' : kind;
    out.push({
      text,
      hardness: atmosphere ? 'nice' : 'must',
      kind: forcedKind,
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
  const rawMust = opts.call1MustHaves ?? [];
  const rawCriteria = opts.call1Criteria ?? [];
  const avoidFromCall1 = [
    ...new Set([
      ...[...rawMust, ...rawCriteria.map((c) => c.key)].flatMap((k) =>
        avoidTokensFromNegativeCriterion(String(k)),
      ),
      ...negativesFromUserText(opts.userText),
    ]),
  ];
  const criteria = mergeCall1Criteria({
    criteria: opts.call1Criteria,
    mustHaves: opts.call1MustHaves,
  }).filter(
    (c) =>
      !isStructuralCriterionKey(c.key) &&
      !isNegativeCriterion(c.key),
  );
  const fromCriteria = wishesFromCriteria(criteria);
  const fromCall1 = wishesFromMustHaves(
    rawMust.filter(
      (m) =>
        !isStructuralCriterionKey(m) && !isNegativeCriterion(m),
    ),
  );
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
  const mustFromCriteria = criteriaToMustHaveLabels(criteria).filter(
    (m) =>
      !isAtmosphereVibeLabel(m) &&
      !isStructuralCriterionKey(m) &&
      !isNegativeCriterion(m),
  );
  const mustHaves = [
    ...new Set([
      ...mustFromCriteria,
      ...rawMust
        .map((m) => String(m).trim())
        .filter(
          (m) =>
            m &&
            !isAtmosphereVibeLabel(m) &&
            !isStructuralCriterionKey(m) &&
            !isNegativeCriterion(m),
        ),
      ...wishes
        .filter((w) => w.hardness === 'must' && w.kind !== 'generic')
        .map((w) => w.text)
        .filter(
          (t) =>
            !isStructuralCriterionKey(t) && !isNegativeCriterion(t),
        ),
    ]),
  ].slice(0, 8);

  return {
    authorIntent: (opts.authorIntent || '').trim().slice(0, 280) || null,
    mustHaves,
    wishes,
    criteria,
    avoidFromCall1,
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
  liveExpandRadiusM?: number;
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

/** Soft-Miss / zu wenig Perfect → Places online ringweise erweitern (nicht nur Pack). */
export const DINING_LIVE_EXPAND_RINGS_M = [25_000, 40_000, 80_000, 100_000] as const;
/** AYCE / Specialty: sofort Metro, dann 80/100 km */
export const AYCE_LIVE_EXPAND_RINGS_M = [55_000, 80_000, 100_000] as const;

export function diningExpandRingsFor(req: {
  wishes?: Array<{ text?: string; kind?: string; hardness?: string }>;
  context?: string;
  title?: string;
  maxRadiusKm?: number;
  forbidSoftFill?: boolean;
  liveExpandRadiusM?: number;
}): readonly number[] {
  const blob = `${req.title ?? ''} ${req.context ?? ''} ${(req.wishes ?? [])
    .map((w) => w.text)
    .join(' ')}`;
  const ayce = (req.wishes ?? []).some(
    (w) =>
      w.hardness === 'must' &&
      w.kind === 'amenity' &&
      /all_you_can_eat|ayce|buffet|schlemmer/i.test(String(w.text || '')),
  );
  const specialty =
    ayce ||
    /\b(döner|doener|kebab|museum|hop[\s-]?on|rodiz|steak|wagyu|angus)\b/iu.test(
      blob,
    );
  const base =
    specialty || ayce || req.forbidSoftFill
      ? AYCE_LIVE_EXPAND_RINGS_M
      : DINING_LIVE_EXPAND_RINGS_M;
  const capM =
    typeof req.maxRadiusKm === 'number' && Number.isFinite(req.maxRadiusKm)
      ? Math.round(Math.min(120, Math.max(5, req.maxRadiusKm)) * 1000)
      : typeof req.liveExpandRadiusM === 'number' &&
          Number.isFinite(req.liveExpandRadiusM)
        ? Math.floor(req.liveExpandRadiusM)
        : null;
  if (capM == null) return base;
  const capped = base.filter((r) => r <= capM);
  if (!capped.length || capped[capped.length - 1]! < capM) {
    return [...capped, capM];
  }
  return capped;
}

export function withLiveExpandRadius<T extends { liveExpandRadiusM?: number; searchMode?: string }>(
  req: T,
  radiusM: number,
): T {
  return {
    ...req,
    liveExpandRadiusM: radiusM,
    searchMode: 'city_best',
  };
}
