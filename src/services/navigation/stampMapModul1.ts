/**
 * Fog-/Stempelkarte: Orte, an denen Modul 1 proaktiv triggern würde.
 * Zeitfenster (Mahlzeit, Bäcker) werden für die Karte ignoriert —
 * Pref-„no“ (z. B. keine Kirchen) blendet aus.
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
  isAmenitySkipPoi,
  isMustHavePoi,
  resolvePlaceTiers,
  userWantsTouristic,
} from '../../interests/placeTiers';

/** Meta-Kategorie in der Stempel-Legende (kein Pack-Taxonomie-Wert). */
export const MODUL1_MAP_CATEGORY = 'modul1' as const;

export type Modul1MapTone = 'liked' | 'neutral' | 'visited';

export const MODUL1_MAP_COLORS: Record<Modul1MapTone, string> = {
  /** Gerne / Pref yes — noch nicht gesehen */
  liked: '#5B8DEF',
  /** Neutral — noch nicht gesehen */
  neutral: '#E6C35C',
  /** Schon besucht / gehört */
  visited: '#3DCF7A',
};

/** Nur echte Zeit-/Cooldown-Gates — Pref-no bleibt hart. */
const TEMPORAL_POLICY_RE = /^(meal_cooldown_1h|outside_meal_window)$/;

const TEMPORAL_RELEVANCE = new Set([
  'place_tier_bakery_off_hours',
  'place_tier_night_supply_off',
]);

/** Mittags-Anker: Food-POIs nicht wegen „außerhalb Mahlzeit“ von der Karte werfen. */
function mapPolicyNow(): Date {
  return new Date(2020, 5, 15, 12, 30, 0);
}

function isAreaLike(poi: Poi): boolean {
  const k = poi.kind ?? 'legacy';
  return k === 'area' || k === 'legacy' || !k;
}

/**
 * Dauerhafte Modul-1-Kandidaten für die Karte (ohne Session-/Zeit-Gates).
 */
export function isModul1AutoTriggerMapPoi(
  poi: Poi,
  profile?: UserProfile | null,
): boolean {
  if (!isAreaLike(poi)) return false;
  if (!Number.isFinite(poi.lat) || !Number.isFinite(poi.lng)) return false;

  const mustHave = isMustHavePoi(poi);
  if (!mustHave && isAmenitySkipPoi(poi)) return false;
  if (!mustHave && !hotelProactiveOk(poi, profile)) return false;

  const tiers = resolvePlaceTiers(poi);
  if (!mustHave && tiers.includes('touristic') && !userWantsTouristic(profile)) {
    return false;
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
    // Soft-Pitch = eigentlich Pref-no mit Personen-Hook — auf der Karte ausblenden
    return false;
  }
  if (policy.action === 'skip') {
    const reason = policy.reason ?? '';
    if (!TEMPORAL_POLICY_RE.test(reason)) return false;
  }

  const relevance = evaluatePoiRelevance(poi, profile, {
    lastMealAtMs: null,
  });
  if (relevance.verdict === 'skip' && !mustHave) {
    if (!TEMPORAL_RELEVANCE.has(relevance.reasonCode ?? '')) return false;
  }

  return true;
}

/** Pref-yes / Interest → liked, sonst neutral (bei Map-Kandidaten). */
export function resolveModul1MapTone(
  poi: Poi,
  profile: UserProfile | null | undefined,
  visited: boolean,
): Modul1MapTone {
  if (visited) return 'visited';

  const schema = poiToSchema(poi);
  const dims = matchingDimensions(schema.tags, schema.category);
  const prefs = profile?.experiencePrefs ?? {};

  for (const dim of dims) {
    if (prefs[dim.prefKey] === 'yes') return 'liked';
  }

  // Stamp-Map-Kategorie → gängige Pref-Keys
  const blob = `${poi.category ?? ''} ${poi.name} ${parseTagsJson(poi.tags_json).join(' ')}`.toLowerCase();
  const yesish = (k: string) => prefs[k] === 'yes';
  if (
    (/(museum|denkmal|galerie|kultur)/i.test(blob) &&
      (yesish('museen') || yesish('denkmaeler') || yesish('architektur'))) ||
    (/(kirche|kapelle)/i.test(blob) && yesish('kirchen')) ||
    (/(strand|natur|park|aussicht)/i.test(blob) &&
      (yesish('natur') || yesish('wandern') || yesish('aussicht'))) ||
    (/(restaurant|gastro|essen|fisch)/i.test(blob) &&
      (yesish('abendessen') || yesish('streetfood') || yesish('fisch'))) ||
    (/(café|cafe|kaffee)/i.test(blob) && yesish('kaffee'))
  ) {
    return 'liked';
  }

  const want = (profile?.wantToExperience ?? '').toLowerCase();
  if (want.length >= 4) {
    const tokens = want.split(/[\s,/]+/).filter((t) => t.length >= 4);
    if (tokens.some((t) => blob.includes(t))) return 'liked';
  }

  return 'neutral';
}

export function colorForModul1MapTone(tone: Modul1MapTone): string {
  return MODUL1_MAP_COLORS[tone];
}
