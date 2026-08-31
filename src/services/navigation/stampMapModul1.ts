/**
 * Fog-/Stempelkarte: Erkunden-/Modul-1-Orte.
 * Homescreen: Story + Auto-Trigger. Directory/Ärzte/Apotheken ohne Story raus.
 * Farben: grün gesehen · violett Modul 1 · rot Story ohne Trigger · blau nur geplant.
 */

import type { Poi } from '../../db/types';
import type { UserProfile } from '../../types/userProfile';
import {
  evaluateTriggerPolicy,
  parseTagsJson,
} from '../geo/triggerPolicy';
import { evaluatePoiForProfile } from '../poiFilterService';
import { evaluatePoiRelevance, poiToSchema } from '../../interests/relevanceBridge';
import { matchingDimensions } from '../../interests/interestTaxonomy';
import {
  hotelProactiveOk,
  amenitySkipBlocksProactive,
  isInterestVisitVenue,
  isMustHavePoi,
  isNonStoryTouristNoisePoi,
  resolvePlaceTiers,
  userWantsTouristic,
} from '../../interests/placeTiers';

/** Meta-Kategorie in der Stempel-Legende (kein Pack-Taxonomie-Wert). */
export const MODUL1_MAP_CATEGORY = 'modul1' as const;

export type Modul1MapTone =
  | 'liked'
  | 'neutral'
  | 'visited'
  | 'planned'
  | 'unwanted';

export const MODUL1_MAP_COLORS: Record<Modul1MapTone, string> = {
  /** Modul 1 würde auslösen */
  liked: '#7A4FBF',
  /** Story / Erkunden, kein Auto-Trigger */
  neutral: '#C45B5B',
  /** Schon gesehen / gehört (>=10 Min oder Modul-1) */
  visited: '#5FA88A',
  /** Im Tagesplan, noch nicht besucht */
  planned: '#3B7DD8',
  /** Pref-no / Dislike — User will den Ort nicht */
  unwanted: '#8B3A3A',
};

/** Nur echte Zeit-/Cooldown-Gates — Pref-no bleibt hart. */
const TEMPORAL_POLICY_RE = /^(meal_cooldown_1h|outside_meal_window)$/;

const TEMPORAL_RELEVANCE = new Set([
  'place_tier_bakery_off_hours',
  'place_tier_night_supply_off',
]);

/**
 * Relevance-Gates, die nur Auto-Trigger drosseln — auf der Stempelkarte
 * trotzdem zeigen (manuell / Pref-neutral sichtbar).
 */
const MAP_VISIBLE_DESPITE_RELEVANCE = new Set([
  ...TEMPORAL_RELEVANCE,
  'specialized_no_interest_match',
  'proactive_cafe_skip',
  'proactive_salon_skip',
  'proactive_florist_skip',
  'proactive_shop_skip',
]);

/** Mittags-Anker: Food-POIs nicht wegen „außerhalb Mahlzeit“ von der Karte werfen. */
function mapPolicyNow(): Date {
  return new Date(2020, 5, 15, 12, 30, 0);
}

function isAreaLike(poi: Poi): boolean {
  const k = poi.kind ?? 'legacy';
  return k === 'area' || k === 'legacy' || !k;
}

type Modul1MapMode = 'auto' | 'visible';

/** Pack-Story ohne Directory — auf der Homescreen-Karte halten. */
export function isPackStoryMapPoi(poi: Poi): boolean {
  const tags = parseTagsJson(poi.tags_json);
  if (
    tags.includes('directory') ||
    tags.includes('amenity_skip') ||
    tags.includes('tier4')
  ) {
    return false;
  }
  return tags.includes('story') || tags.includes('story_enriched');
}

export { isNonStoryTouristNoisePoi };

/**
 * Stadt-Orte für „X von Y erkundet“ —
 * nur Story-Orte (nicht Café/Salon/Directory), unabhängig von Prefs.
 */
export function isCityExploreMapPoi(poi: Poi): boolean {
  if (!isAreaLike(poi)) return false;
  if (!Number.isFinite(poi.lat) || !Number.isFinite(poi.lng)) return false;
  if (isNonStoryTouristNoisePoi(poi)) return false;
  return isPackStoryMapPoi(poi);
}

const UNWANTED_PERSONA = new Set([
  'church_dislike',
  'dietary_fish',
  'dietary_meat',
  'dislike_match',
]);

/** Pref-no / Dislike — User will den Ort nicht sehen. */
export function isUserUnwantedMapPoi(
  poi: Poi,
  profile?: UserProfile | null,
): boolean {
  if (!profile) return false;
  const prefs = profile.experiencePrefs ?? {};
  const schema = poiToSchema(poi);
  const dims = matchingDimensions(schema.tags, schema.category);
  for (const dim of dims) {
    if (prefs[dim.prefKey] === 'no') return true;
  }
  const persona = evaluatePoiForProfile(poi, profile);
  if (!persona.allowed && UNWANTED_PERSONA.has(persona.reason)) return true;
  return false;
}

/**
 * Shared durable gates for Erkunden-Karte.
 * mode=auto: gleiche Filter wie früher (proaktive Auto-Trigger-Kandidaten)
 * mode=visible: Pref-neutrale / spezialisierte Orte bleiben sichtbar
 */
function passesModul1MapGates(
  poi: Poi,
  profile: UserProfile | null | undefined,
  mode: Modul1MapMode,
): boolean {
  if (!isAreaLike(poi)) return false;
  if (!Number.isFinite(poi.lat) || !Number.isFinite(poi.lng)) return false;

  const mustHave = isMustHavePoi(poi);
  if (!mustHave && amenitySkipBlocksProactive(poi, profile)) return false;
  if (!mustHave && !hotelProactiveOk(poi, profile)) return false;

  const tags = parseTagsJson(poi.tags_json);
  const packStory =
    (tags.includes('story') || tags.includes('story_enriched')) &&
    !tags.includes('directory') &&
    !tags.includes('amenity_skip') &&
    !tags.includes('tier4');

  const tiers = resolvePlaceTiers(poi);
  if (!mustHave && tiers.includes('touristic') && !userWantsTouristic(profile)) {
    if (!packStory) return false;
  }

  // Distanz/Zeit nicht — nur dauerhafte Persona-/Dislike-Gates
  const persona = evaluatePoiForProfile(poi, profile);
  if (!persona.allowed && !mustHave) return false;

  const policy = evaluateTriggerPolicy(poi, {
    profile: profile ?? null,
    now: mapPolicyNow(),
    lastMealHintAtMs: null,
  });
  if (policy.action === 'soft_pitch') {
    // Soft-Pitch: Automation nicht, Karte ja — User entscheidet manuell
    if (mode === 'auto') return false;
  }
  if (policy.action === 'skip') {
    const reason = policy.reason ?? '';
    if (!TEMPORAL_POLICY_RE.test(reason)) return false;
  }

  const relevance = evaluatePoiRelevance(poi, profile, {
    lastMealAtMs: null,
  });
  if (relevance.verdict === 'skip' && !mustHave) {
    const code = relevance.reasonCode ?? '';
    const waived =
      mode === 'visible'
        ? MAP_VISIBLE_DESPITE_RELEVANCE.has(code)
        : TEMPORAL_RELEVANCE.has(code);
    if (!waived) return false;
  }

  return true;
}

/**
 * Dauerhafte Auto-Trigger-Kandidaten (ohne Session-/Zeit-Gates).
 * Spezialisierungs-Gate bleibt aktiv — Pref-neutrale Spezial-POIs fallen raus.
 */
export function isModul1AutoTriggerMapPoi(
  poi: Poi,
  profile?: UserProfile | null,
): boolean {
  return passesModul1MapGates(poi, profile, 'auto');
}

/**
 * Homescreen-Pins: Story, Modul-1-Trigger, Pref-no bei Interesse-Venues.
 * Noise ohne Story bleibt draußen.
 */
export function isHomescreenExploreMapPoi(
  poi: Poi,
  profile?: UserProfile | null,
): boolean {
  if (!isAreaLike(poi)) return false;
  if (!Number.isFinite(poi.lat) || !Number.isFinite(poi.lng)) return false;
  if (isNonStoryTouristNoisePoi(poi)) return false;
  if (isPackStoryMapPoi(poi)) return true;
  if (isModul1AutoTriggerMapPoi(poi, profile)) return true;
  if (isUserUnwantedMapPoi(poi, profile) && isInterestVisitVenue(poi)) {
    return true;
  }
  return false;
}

/**
 * Stempelkarte / Erkunden-Filter: must_have + gerne + Pref-neutral + Soft-Pitch sichtbar.
 * Amenity-Skip und hartes Pref-no bleiben ausgeblendet.
 * Auto-Trigger-Policy (TourDirector) unverändert — Soft-Pitch nur manuell auf der Karte.
 */
export function isModul1MapVisiblePoi(
  poi: Poi,
  profile?: UserProfile | null,
): boolean {
  return passesModul1MapGates(poi, profile, 'visible');
}

/** Gesehen → grün · geplant → blau · Pref-no → rot · Modul 1 → violett. */
export function resolveModul1MapTone(
  poi: Poi,
  profile: UserProfile | null | undefined,
  visited: boolean,
  opts?: { planned?: boolean },
): Modul1MapTone {
  if (visited) return 'visited';
  if (opts?.planned) return 'planned';
  if (isUserUnwantedMapPoi(poi, profile)) return 'unwanted';
  if (isModul1AutoTriggerMapPoi(poi, profile)) return 'liked';
  return 'neutral';
}

export function colorForModul1MapTone(tone: Modul1MapTone): string {
  return MODUL1_MAP_COLORS[tone];
}

/** Grün auf der Karte: ≥10 Min, oder Modul-1-Story, oder M1-Ort mit ≥2 Min. */
export const MAP_VISIT_DWELL_MIN = 10;
export const MAP_VISIT_MODUL1_DWELL_MIN = 2;

export function dwellMinutesFromVisitFacts(
  keyFacts: readonly string[] | null | undefined,
): number | null {
  if (!keyFacts?.length) return null;
  let best: number | null = null;
  for (const f of keyFacts) {
    const m = f.match(/verweilt\s+(\d+)/i);
    if (!m) continue;
    const n = Number(m[1]);
    if (!Number.isFinite(n)) continue;
    best = best == null ? n : Math.max(best, n);
  }
  return best;
}

export function isModul1StampVisitFacts(
  keyFacts: readonly string[] | null | undefined,
): boolean {
  return (keyFacts ?? []).some((f) => /modul[\s-]?1/i.test(f));
}

export function countsAsMapVisitedGreen(opts: {
  keyFacts?: readonly string[] | null;
  poi?: Poi | null;
  profile?: UserProfile | null;
}): boolean {
  if (isModul1StampVisitFacts(opts.keyFacts)) return true;
  const dwell = dwellMinutesFromVisitFacts(opts.keyFacts) ?? 0;
  if (dwell >= MAP_VISIT_DWELL_MIN) return true;
  if (
    opts.poi &&
    isModul1AutoTriggerMapPoi(opts.poi, opts.profile) &&
    dwell >= MAP_VISIT_MODUL1_DWELL_MIN
  ) {
    return true;
  }
  return false;
}
