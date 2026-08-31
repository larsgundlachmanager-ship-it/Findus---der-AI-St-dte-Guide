/**
 * POI → schema + User context → RelevanceEngine bridge.
 */

import type { Poi } from '../db/types';
import type { UserProfile } from '../types/userProfile';
import { parseTagsJson } from '../services/geo/triggerPolicy';
import { resolvePersonaEngine } from '../services/personaEngine';
import { evaluateRelevance } from '../runtime/relevanceEngine';
import type {
  PoiSchema,
  RelevanceResult,
  UserRelevanceContext,
} from '../runtime/types';
import { useSessionPlanStore } from '../store/useSessionPlanStore';
import {
  INTEREST_DIMENSIONS,
  matchingDimensions,
  SEMANTIC_CONFLICT_RULES,
  type InterestDimension,
} from './interestTaxonomy';
import {
  bakeryTimeAllows,
  hotelProactiveOk,
  isAmenitySkipPoi,
  isMustHavePoi,
  nightSupplyAllows,
} from './placeTiers';

const MEAL_TAGS: Record<string, string> = {
  fruehstueck: 'breakfast',
  frühstück: 'breakfast',
  mittag: 'lunch',
  abendessen: 'dinner',
  kaffee: 'snack',
  cafe: 'snack',
  café: 'snack',
  streetfood: 'snack',
};

function normalizeToken(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '_');
}

function inferMealType(tags: string[], category: string): string | null {
  const cat = category.toLowerCase();
  for (const [k, v] of Object.entries(MEAL_TAGS)) {
    if (cat.includes(k) || tags.some((t) => t.includes(k))) return v;
  }
  if (tags.some((t) => /restaurant|gastro|food|essen/.test(t))) return 'meal';
  return null;
}

function inferFoodAttributes(tags: string[], category: string): Record<string, boolean> {
  const blob = `${category} ${tags.join(' ')}`.toLowerCase();
  return {
    servesMeat: /steak|grill|burger|metzg|fleisch|brauhaus|steakhouse|bbq/.test(
      blob,
    ),
    servesFish: /fisch|seafood|fischrestaurant|fischimbiss/.test(blob),
    isSacral: /kirche|kapelle|dom|sakral|church/.test(blob),
    isFood: /restaurant|cafe|café|gastro|food|essen|imbiss|bäck|baeck/.test(
      blob,
    ),
  };
}

/** Map DB POI → extensible schema bag for matching engines. */
export function poiToSchema(poi: Poi): PoiSchema {
  const tags = parseTagsJson(poi.tags_json);
  const category = (poi.category ?? '').trim().toLowerCase();
  const food = inferFoodAttributes(tags, category);
  const mealType = inferMealType(tags, category);

  const attributes: Record<string, string | number | boolean | null> = {
    ...food,
    mealType: mealType ?? null,
  };

  for (const dim of matchingDimensions(tags, category)) {
    attributes[`dim_${dim.prefKey}`] = true;
  }

  return {
    id: poi.id,
    tags,
    category,
    attributes,
  };
}

function inferSkipPatterns(profile: UserProfile | null | undefined): UserRelevanceContext['skipPatterns'] {
  const patterns: UserRelevanceContext['skipPatterns'] = [];
  if (!profile) return patterns;

  const prefs = profile.experiencePrefs ?? {};
  for (const dim of INTEREST_DIMENSIONS) {
    if (prefs[dim.prefKey] === 'no') {
      patterns.push({
        tagKeys: [...dim.tagMatchers, ...dim.categoryMatchers],
        confidence: 0.85,
      });
    }
  }

  const engine = resolvePersonaEngine(profile);
  for (const dislike of engine.preferences.dislikes) {
    const tokens = dislike
      .toLowerCase()
      .split(/[\s,;/]+/)
      .map(normalizeToken)
      .filter((t) => t.length >= 4);
    if (tokens.length) {
      patterns.push({ tagKeys: tokens, confidence: 0.7 });
    }
  }

  for (const fact of profile.learnedFacts ?? []) {
    const m = fact.match(/^skip-pattern:([^=]+)=(.+)$/i);
    if (m) {
      patterns.push({
        tagKeys: m[2].split(',').map(normalizeToken).filter(Boolean),
        confidence: Math.min(1, parseFloat(m[1]) || 0.75),
      });
    }
  }

  return patterns;
}

/** Build open preferences map from profile (no hardcoded category names in logic). */
export function buildUserRelevanceContext(
  profile: UserProfile | null | undefined,
  opts?: { lastMealAtMs?: number | null; partySize?: number | null },
): UserRelevanceContext {
  const prefs: Record<string, string | boolean | number | null> = {};

  for (const [k, v] of Object.entries(profile?.experiencePrefs ?? {})) {
    prefs[k] = v;
  }

  const engine = resolvePersonaEngine(profile ?? undefined);
  for (const d of engine.preferences.dietaryRestrictions) {
    const key = normalizeToken(d.slice(0, 24));
    if (key) prefs[key] = true;
  }
  if (engine.preferences.likesChurches === false) prefs.kirchen = 'no';
  if (!engine.preferences.likesChurches && prefs.kirchen == null) {
    prefs.kirchen = 'no';
  }

  const boostTagKeys = useSessionPlanStore.getState().getBoostPlaceTypes();

  return {
    preferences: prefs,
    skipPatterns: inferSkipPatterns(profile),
    boostTagKeys: boostTagKeys.length ? boostTagKeys : undefined,
    activity: {
      lastMealAtMs: opts?.lastMealAtMs ?? null,
    },
    partySize: opts?.partySize ?? null,
  };
}

function evaluateSemanticConflicts(
  poi: PoiSchema,
  ctx: UserRelevanceContext,
): number {
  let conflicts = 0;
  for (const rule of SEMANTIC_CONFLICT_RULES) {
    const pref = ctx.preferences[rule.userPrefKey];
    if (pref !== rule.whenUserPref) continue;
    const attr = poi.attributes[rule.poiAttributeKey];
    if (attr === rule.poiAttributeValue) conflicts += 1;
  }
  return conflicts;
}

/**
 * When user set ≥2 explicit likes, specialized POIs need a matching like.
 */
function evaluateSpecializationGate(
  poi: PoiSchema,
  ctx: UserRelevanceContext,
): 'allow' | 'skip' {
  // Must-have landmarks always fire (große Denkmäler / Kernorte)
  if (
    poi.tags.some((t) =>
      /^(must_have|must-see|must_see|landmark)$/i.test(String(t)),
    )
  ) {
    return 'allow';
  }
  const yesKeys = new Set(
    Object.entries(ctx.preferences)
      .filter(([, v]) => v === 'yes' || v === true)
      .map(([k]) => k),
  );
  if (yesKeys.size < 2) return 'allow';

  const dims = matchingDimensions(poi.tags, poi.category).filter(
    (d) => d.specialized,
  );
  if (dims.length === 0) return 'allow';

  const anyMatch = dims.some((d) => yesKeys.has(d.prefKey));
  if (!anyMatch) return 'skip';
  return 'allow';
}

function hasStoryOrMustHaveTags(schema: PoiSchema): boolean {
  // Nur echte Landmark / Must-Have umgehen Amenity-Spam-Gate.
  // Bloßes `story`/`story_enriched` reicht nicht (dünne Directory-Stories).
  return schema.tags.some((t) =>
    /^(must_have|must-see|must_see|landmark)$/i.test(String(t).trim()),
  );
}

/**
 * Arztpraxis / Café / Parkplatz / Salon / Florist / Shop:
 * nur proaktiv triggern wenn Pref/Story/must_have passt.
 * (Datenbank bleibt; On-Demand-Fragen finden sie trotzdem.)
 */
function evaluateProactiveAmenitySkip(
  schema: PoiSchema,
  ctx: UserRelevanceContext,
  profile: UserProfile | null | undefined,
  nameHint?: string | null,
): string | null {
  // Story / Landmark / must_have = echte Entdeckung → kein Amenity-Spam-Gate
  if (hasStoryOrMustHaveTags(schema)) return null;

  const blob =
    `${nameHint ?? ''} ${schema.category} ${schema.tags.join(' ')}`.toLowerCase();
  const prefs = ctx.preferences;
  const yesish = (k: string) => {
    const v = prefs[k];
    return v === 'yes' || v === true || v === 'love' || v === 'prefer';
  };
  const wantText = `${profile?.wantToExperience ?? ''} ${(profile?.learnedFacts ?? []).join(' ')}`.toLowerCase();

  const medical =
    /zahnarzt|zahnmedizin|arztpraxis|hausarzt|\bpraxis\b|klinik|hospital|doctors|dentist|orthopäd|radiolog/.test(
      blob,
    );
  if (medical) {
    const need =
      yesish('gesundheit') ||
      yesish('apotheke') ||
      /zahn|arzt|schmerz|gesundheit|medizin/i.test(wantText);
    if (!need) return 'proactive_medical_skip';
  }

  const cafeOnly =
    /\b(café|cafe|kaffee|coffee|rösterei)\b/.test(blob) &&
    !/restaurant|museum|theater|denkmal|brücke|speicher|elphi|wunderland|dungeon/.test(
      blob,
    );
  if (cafeOnly) {
    const wantCoffee =
      yesish('cafe') ||
      yesish('café') ||
      yesish('cafes') ||
      yesish('kaffee') ||
      yesish('gastronomie') ||
      /kaffee|café|cafe/i.test(wantText);
    if (!wantCoffee) return 'proactive_cafe_skip';
  }

  const parking =
    /\b(parkplatz|parking|parkhaus|tiefgarage)\b/.test(blob) &&
    !/museum|theater|denkmal|brücke|speicher/.test(blob);
  if (parking) {
    const wantPark =
      yesish('parken') || /parkplatz|auto|parken/i.test(wantText);
    if (!wantPark) return 'proactive_parking_skip';
  }

  const salon =
    /\b(fris[oö]r|friseur|coiffeur|haarstudio|barber|haarschnitt|nagelsalon|nagelstudio|nagel\s*design|beauty\s*salon|hair\s*salon|barbershop|salon)\b/.test(
      blob,
    );
  if (salon) {
    const wantBeauty =
      yesish('friseur') ||
      yesish('haar') ||
      yesish('beauty') ||
      yesish('wellness') ||
      yesish('nagel') ||
      /frisur|friseur|haar\s*schnitt|nagel|beauty|coiffeur|barber/i.test(
        wantText,
      );
    if (!wantBeauty) return 'proactive_salon_skip';
  }

  const florist =
    /\b(blume|blumen|florist|floristik|blumenladen|strau[sß]|flower\s*shop)\b/.test(
      blob,
    );
  if (florist) {
    const wantFlowers =
      yesish('blumen') ||
      yesish('florist') ||
      yesish('geschenk') ||
      /blume|florist|strau[sß]|geschenk|geburtstag|hochzeit/i.test(wantText);
    if (!wantFlowers) return 'proactive_florist_skip';
  }

  // Generische Läden — kein Abstecher-Spam; Shopping-Pref / Major Retail ok
  const genericShop =
    /\b(laden|shop|boutique|gesch[äa]ft|einzelhandel|kiosk|modehaus|juwelier|optiker|buchhandlung|schreibwaren|drogerie|supermarkt|einkauf(?:szentrum|center)?|shopping)\b/.test(
      blob,
    ) &&
    !/\b(museum|theater|galerie|kirche|schloss|denkmal|park|strand|hafen|bahnhof|restaurant|café|cafe|bäck|baeck|marktplatz|wochenmarkt)\b/.test(
      blob,
    );
  if (genericShop) {
    const wantShop =
      yesish('shopping') ||
      yesish('einkaufen') ||
      yesish('shoppingmall') ||
      yesish('souvenir') ||
      yesish('souvenirs') ||
      /einkauf|shopping|souvenir|laden|boutique|geschenk/i.test(wantText);
    if (!wantShop) return 'proactive_shop_skip';
  }

  return null;
}

export type PoiRelevanceEvaluation = RelevanceResult & {
  matchedDimensions: InterestDimension[];
};

/**
 * Single entry for Tour Director — combines runtime engine + taxonomy gates.
 */
export function evaluatePoiRelevance(
  poi: Poi,
  profile?: UserProfile | null,
  opts?: { lastMealAtMs?: number | null },
): PoiRelevanceEvaluation {
  const schema = poiToSchema(poi);
  const ctx = buildUserRelevanceContext(profile, opts);
  const base = evaluateRelevance(schema, ctx);
  const matchedDimensions = matchingDimensions(schema.tags, schema.category);

  const semanticConflicts = evaluateSemanticConflicts(schema, ctx);
  if (semanticConflicts > 0 && base.verdict !== 'skip') {
    return {
      verdict: 'skip',
      reasonCode: 'semantic_conflict',
      score: base.score - semanticConflicts,
      matchedDimensions,
    };
  }

  const spec = evaluateSpecializationGate(schema, ctx);
  if (spec === 'skip') {
    return {
      verdict: 'skip',
      reasonCode: 'specialized_no_interest_match',
      score: 0,
      matchedDimensions,
    };
  }

  // Utility / Praxis / Café / Salon / Shop nur bei klarem User-Bedarf — sonst kein Wegweiser-Spam
  const proactiveSkip = evaluateProactiveAmenitySkip(
    schema,
    ctx,
    profile,
    poi.name,
  );
  if (proactiveSkip) {
    return {
      verdict: 'skip',
      reasonCode: proactiveSkip,
      score: 0,
      matchedDimensions,
    };
  }

  if (!isMustHavePoi(poi)) {
    if (isAmenitySkipPoi(poi)) {
      return {
        verdict: 'skip',
        reasonCode: 'place_tier_amenity_skip',
        score: 0,
        matchedDimensions,
      };
    }
    if (!bakeryTimeAllows(poi)) {
      return {
        verdict: 'skip',
        reasonCode: 'place_tier_bakery_off_hours',
        score: 0,
        matchedDimensions,
      };
    }
    if (!hotelProactiveOk(poi, profile)) {
      return {
        verdict: 'skip',
        reasonCode: 'place_tier_hotel_generic',
        score: 0,
        matchedDimensions,
      };
    }
    if (!nightSupplyAllows(poi, profile)) {
      return {
        verdict: 'skip',
        reasonCode: 'place_tier_night_supply_off',
        score: 0,
        matchedDimensions,
      };
    }
  }

  return { ...base, matchedDimensions };
}

/** Record learned skip when user repeatedly ignores a POI type. */
export function skipPatternFactForPoi(poi: Poi): string | null {
  const schema = poiToSchema(poi);
  const dims = matchingDimensions(schema.tags, schema.category);
  if (!dims.length) return null;
  const keys = [
    ...new Set(dims.flatMap((d) => [...d.tagMatchers, ...d.categoryMatchers])),
  ]
    .slice(0, 8)
    .join(',');
  return `skip-pattern:0.75=${keys}`;
}
