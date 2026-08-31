/**
 * Ob ein POI-Trigger für diesen User/Zeitpunkt sprechen darf.
 */

import type { Poi } from '../../db/types';
import type {
  MealSlot,
  TriggerPolicyDecision,
} from '../../types/poiGeo';
import type { UserProfile } from '../../types/userProfile';
import type { TideState } from './tideService';
import { resolvePersonaEngine } from '../personaEngine';
import { INTEREST_DIMENSIONS } from '../../interests/interestTaxonomy';

const FOOD_TAGS = new Set([
  'fischrestaurant',
  'restaurant',
  'cafe',
  'café',
  'streetfood',
  'fruehstueck',
  'frühstück',
  'mittag',
  'abendessen',
  'food',
  'gastronomie',
  'fisch',
]);

const FISH_TAGS = new Set(['fischrestaurant', 'fisch', 'seafood', 'fischimbiss']);

const CHURCH_TAGS = new Set([
  'kirche',
  'kirchen',
  'sakral',
  'kapelle',
  'dom',
  'cathedral',
]);

const CELEB_TAGS = new Set([
  'promi',
  'celebs_and_stories',
  'personen',
  'famous',
  'berühmte_person',
]);

const CATEGORY_TO_PREF: Record<string, string> = {
  kirche: 'kirchen',
  kirchen: 'kirchen',
  church: 'kirchen',
  museum: 'museen',
  museen: 'museen',
  denkmal: 'denkmaeler',
  denkmaeler: 'denkmaeler',
  architektur: 'architektur',
  restaurant: 'abendessen',
  cafe: 'cafes',
  café: 'cafes',
  streetfood: 'streetfood',
  fruehstueck: 'fruehstueck',
  frühstück: 'fruehstueck',
  bahnhof: 'oepnv',
  transport: 'oepnv',
  theater: 'theater',
  konzert: 'konzert_musical',
  musical: 'konzert_musical',
  kino: 'kino',
  sport: 'sport',
  freizeit: 'aktivitaeten',
  freizeitpark: 'aktivitaeten',
  wanderung: 'wandern',
  radweg: 'fahrrad',
  fahrradweg: 'fahrrad',
};

export function parseTagsJson(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(String).map((t) => t.trim().toLowerCase()).filter(Boolean);
  } catch {
    return String(raw)
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
  }
}

export function resolveMealSlot(now: Date = new Date()): MealSlot {
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes >= 7 * 60 && minutes < 10 * 60 + 30) return 'fruehstueck';
  if (minutes >= 11 * 60 + 30 && minutes < 14 * 60 + 30) return 'mittag';
  if (minutes >= 14 * 60 + 30 && minutes < 17 * 60 + 30) return 'kaffee';
  if (minutes >= 17 * 60 + 30 && minutes < 21 * 60 + 30) return 'abendessen';
  return 'none';
}

function prefOf(
  profile: UserProfile | null | undefined,
  key: string,
): 'no' | 'neutral' | 'yes' | undefined {
  return profile?.experiencePrefs?.[key] as
    | 'no'
    | 'neutral'
    | 'yes'
    | undefined;
}

function hasAnyTag(tags: string[], set: Set<string>): boolean {
  return tags.some((t) => set.has(t));
}

function categoryPrefKey(category: string | null | undefined): string | null {
  if (!category) return null;
  const key = category.trim().toLowerCase();
  return CATEGORY_TO_PREF[key] ?? key;
}

function isFoodPoi(category: string | null | undefined, tags: string[]): boolean {
  const cat = (category ?? '').toLowerCase();
  if (FOOD_TAGS.has(cat)) return true;
  return hasAnyTag(tags, FOOD_TAGS);
}

function softPitchHook(poi: Poi, tags: string[]): string | null {
  const famous =
    tags.find((t) => t.startsWith('famous:') || t.startsWith('promi:')) ??
    null;
  const personName = famous
    ? famous.split(':').slice(1).join(':').trim()
    : null;
  if (personName) {
    return `Ich weiß, ${poi.category === 'kirche' || hasAnyTag(tags, CHURCH_TAGS) ? 'Kirchen ist nicht unbedingt dein Ding' : 'das ist vielleicht nicht dein Kernthema'}, aber hier hat ${personName} Spuren hinterlassen — willst du mehr darüber erfahren?`;
  }
  if (hasAnyTag(tags, CELEB_TAGS)) {
    return `Ich weiß, das ist vielleicht nicht dein Lieblingsthema — aber hier steckt eine echte Personen-Geschichte drin. Kurz reinhören?`;
  }
  return null;
}

export type TriggerPolicyContext = {
  profile: UserProfile | null;
  now?: Date;
  /** Session: wann zuletzt ein Food-Hinweis kam. */
  lastMealHintAtMs?: number | null;
  /** Bereits soft-gepitchte Parent-/Spot-Keys diese Session. */
  softPitchedSpotKeys?: Set<string>;
  firstName?: string;
  /** PEGELONLINE / tideService — für condition_rule tide_low. */
  tide?: TideState;
};

/**
 * Entscheidet skip / soft_pitch / full für Area, Approach und Sub.
 */
export function evaluateTriggerPolicy(
  poi: Poi,
  ctx: TriggerPolicyContext,
): TriggerPolicyDecision {
  const tags = parseTagsJson(poi.tags_json);
  const profile = ctx.profile;
  const condition = poi.condition_rule ?? 'always';

  if (condition === 'always' && poi.kind === 'approach') {
    // Approach darf trotzdem Food-/Pref-Gates durchlaufen
  }

  // Fisch / vegetarisch (Prefs + gelernte Persona-Engine)
  const engine = resolvePersonaEngine(profile);
  const dietary = engine.preferences.dietaryRestrictions.map((d) =>
    d.toLowerCase(),
  );
  const noFish =
    prefOf(profile, 'fisch') === 'no' ||
    (profile?.allergyTags ?? []).includes('fisch') ||
    dietary.some((d) => /kein\s*fisch|vegetar|vegan/.test(d));
  const vegetarian =
    prefOf(profile, 'vegetarisch') === 'yes' ||
    dietary.some((d) => /vegetar|vegan/.test(d));

  if (hasAnyTag(tags, FISH_TAGS) || (poi.category ?? '').toLowerCase() === 'fischrestaurant') {
    if (noFish) {
      return { action: 'skip', reason: 'user_dislikes_fish' };
    }
  }
  if (
    vegetarian &&
    hasAnyTag(tags, FISH_TAGS) &&
    !tags.includes('vegetarisch') &&
    !tags.includes('vegan')
  ) {
    return { action: 'skip', reason: 'vegetarian_skip_fish' };
  }

  // Kategorie-Pref (z. B. kirchen)
  const prefKey = categoryPrefKey(poi.category);
  const catPref = prefKey ? prefOf(profile, prefKey) : undefined;
  const churchNo =
    (prefOf(profile, 'kirchen') === 'no' ||
      !engine.preferences.likesChurches ||
      engine.preferences.dislikes.some((d) => /kirche/i.test(d))) &&
    (hasAnyTag(tags, CHURCH_TAGS) || prefKey === 'kirchen');

  if (catPref === 'no' || churchNo) {
    const canSoft =
      prefOf(profile, 'personen') === 'yes' &&
      (hasAnyTag(tags, CELEB_TAGS) ||
        tags.some((t) => t.startsWith('famous:') || t.startsWith('promi:')));
    const spotKey = poi.spot_key ?? String(poi.id);
    if (
      canSoft &&
      !(ctx.softPitchedSpotKeys?.has(spotKey)) &&
      (poi.kind === 'area' || poi.kind === 'approach')
    ) {
      const pitch =
        softPitchHook(poi, tags) ??
        `Hier wäre eigentlich nicht dein Thema — aber es gibt einen Personen-Hook. Kurz rein?`;
      const name = (ctx.firstName || profile?.firstName || '').trim();
      const pitched = name
        ? pitch.replace(/^Ich weiß/, `Äh ${name}, ich weiß`)
        : pitch;
      return {
        action: 'soft_pitch',
        reason: 'preference_soft_pitch_celeb',
        pitchText: pitched,
      };
    }
    return { action: 'skip', reason: `pref_no:${prefKey ?? 'category'}` };
  }

  // Landmark-Bäcker/Cafés mit Story immer erzählen (nicht nur im Essensfenster)
  const isLandmarkFood =
    isFoodPoi(poi.category, tags) &&
    (tags.includes('story_enriched') ||
      tags.includes('historical_core') ||
      tags.includes('geschichte') ||
      /bäck|baeck|schlüter|schlueter|allwörden|allwoerden/i.test(poi.name));

  // Mahlzeit-Fenster nur für „normale“ Food-POIs — Landmarke immer full
  if (isFoodPoi(poi.category, tags) && !isLandmarkFood) {
    const slot = resolveMealSlot(ctx.now ?? new Date());
    const lastMeal = ctx.lastMealHintAtMs ?? null;
    if (lastMeal != null && Date.now() - lastMeal < 60 * 60 * 1000) {
      return { action: 'skip', reason: 'meal_cooldown_1h' };
    }

    if (slot === 'none') {
      return { action: 'skip', reason: 'outside_meal_window' };
    }

    // Pref-Gates pro Slot
    if (slot === 'fruehstueck' && prefOf(profile, 'fruehstueck') === 'no') {
      return { action: 'skip', reason: 'no_breakfast_pref' };
    }
    if (slot === 'kaffee' && prefOf(profile, 'kaffee') === 'no') {
      return { action: 'skip', reason: 'no_coffee_pref' };
    }
    if (slot === 'abendessen' && prefOf(profile, 'abendessen') === 'no') {
      return { action: 'skip', reason: 'no_dinner_pref' };
    }
    if (
      slot === 'mittag' &&
      prefOf(profile, 'abendessen') === 'no' &&
      prefOf(profile, 'streetfood') === 'no'
    ) {
      return { action: 'skip', reason: 'no_lunchish_pref' };
    }

    // Tag muss zum Slot passen, wenn spezifische Meal-Tags gesetzt sind
    const mealSpecific = tags.filter((t) =>
      ['fruehstueck', 'frühstück', 'mittag', 'kaffee', 'abendessen', 'streetfood'].includes(
        t,
      ),
    );
    if (mealSpecific.length > 0) {
      const ok =
        (slot === 'fruehstueck' &&
          mealSpecific.some((t) => t === 'fruehstueck' || t === 'frühstück')) ||
        (slot === 'mittag' &&
          mealSpecific.some((t) => t === 'mittag' || t === 'streetfood')) ||
        (slot === 'kaffee' && mealSpecific.includes('kaffee')) ||
        (slot === 'abendessen' &&
          mealSpecific.some((t) => t === 'abendessen' || t === 'streetfood'));
      if (!ok) {
        return { action: 'skip', reason: `meal_tag_mismatch:${slot}` };
      }
    }
  }

  if (condition === 'user_preference_match') {
    const liked = Object.entries(profile?.experiencePrefs ?? {}).some(
      ([k, v]) =>
        v === 'yes' &&
        (tags.includes(k) || (poi.category ?? '').toLowerCase() === k),
    );
    if (!liked) {
      return { action: 'skip', reason: 'condition_pref_match_failed' };
    }
  }

  if (condition === 'tide_low') {
    if (!ctx.tide || ctx.tide.status === 'unknown') {
      return {
        action: 'soft_pitch',
        reason: 'tide_unknown',
        pitchText:
          'Die Fundamente siehst du nur bei Ebbe. Gerade fehlen mir frische Tide-Daten — schau aufs Wasser und komm bei Niedrigwasser nochmal vorbei.',
      };
    }
    if (ctx.tide.status !== 'low') {
      return { action: 'skip', reason: 'tide_not_low' };
    }
  }

  return { action: 'full', reason: 'ok' };
}

/** Mappt Fact-Thema-Tags auf Experience-Keys für Ranking. */
export function themeTagToInterestIds(themeTag: string): string[] {
  const t = themeTag.toLowerCase();
  const out: string[] = [];
  for (const dim of INTEREST_DIMENSIONS) {
    const tagHit = dim.tagMatchers.some((m) => t.includes(m) || m.includes(t));
    const catHit = dim.categoryMatchers.some((m) => t === m || t.includes(m));
    if (tagHit || catHit) out.push(dim.prefKey);
  }
  if (FOOD_TAGS.has(t) || t.includes('food') || t.includes('preis')) {
    out.push('abendessen', 'streetfood', 'kaffee');
  }
  if (t.includes('legende') || t.includes('sage')) out.push('legenden');
  return [...new Set(out)];
}
