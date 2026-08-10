/**
 * Abstract Relevance Engine — schema matching, NO hardcoded POI examples.
 * Compares POI metadata dynamically against user profile + context + learned patterns.
 */

import type {
  PoiSchema,
  RelevanceResult,
  UserRelevanceContext,
} from './types';

const CONFLICT_THRESHOLD = 0.55;
const SOFT_PITCH_THRESHOLD = 0.35;

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '_');
}

function poiTokens(poi: PoiSchema): Set<string> {
  const out = new Set<string>();
  if (poi.category) out.add(normalizeKey(poi.category));
  for (const t of poi.tags) out.add(normalizeKey(t));
  for (const [k, v] of Object.entries(poi.attributes)) {
    out.add(normalizeKey(k));
    if (typeof v === 'string' && v) out.add(normalizeKey(v));
  }
  return out;
}

function prefTokens(ctx: UserRelevanceContext): Map<string, string> {
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(ctx.preferences)) {
    if (v == null) continue;
    map.set(normalizeKey(k), String(v).toLowerCase());
  }
  return map;
}

/**
 * Generic conflict: user pref "no"/"avoid" on a dimension that matches POI tokens.
 */
function scorePrefConflicts(
  poi: PoiSchema,
  ctx: UserRelevanceContext,
): { conflict: number; match: number } {
  const tokens = poiTokens(poi);
  const prefs = prefTokens(ctx);
  let conflict = 0;
  let match = 0;

  for (const [prefKey, prefVal] of prefs) {
    const isNegative =
      prefVal === 'no' ||
      prefVal === 'false' ||
      prefVal === 'avoid' ||
      prefVal === 'never';
    const isPositive =
      prefVal === 'yes' ||
      prefVal === 'true' ||
      prefVal === 'love' ||
      prefVal === 'prefer';

    const related = [...tokens].some(
      (t) => t.includes(prefKey) || prefKey.includes(t),
    );
    if (!related) continue;
    if (isNegative) conflict += 1;
    if (isPositive) match += 1;
  }

  // Attribute-level explicit mismatches (open schema)
  for (const [attrKey, attrVal] of Object.entries(poi.attributes)) {
    const key = normalizeKey(attrKey);
    const pref = prefs.get(key);
    if (!pref || attrVal == null) continue;
    const val = String(attrVal).toLowerCase();
    if (pref === 'no' && val === 'true') conflict += 0.8;
    if (pref === 'yes' && val === 'true') match += 0.8;
  }

  return { conflict, match };
}

/** Temporal context — e.g. recent meal slot vs food POI (generic mealType attribute). */
function scoreTemporalConflict(
  poi: PoiSchema,
  ctx: UserRelevanceContext,
): number {
  const mealType = poi.attributes.mealType ?? poi.attributes.meal_type;
  if (!mealType) return 0;
  const lastMeal = ctx.activity.lastMealAtMs;
  if (typeof lastMeal !== 'number') return 0;
  const mins = (Date.now() - lastMeal) / 60_000;
  if (mins < 90 && String(mealType).toLowerCase() !== 'snack') {
    return 0.7;
  }
  return 0;
}

/** Learned skip patterns from repeated dismissals — not hardcoded categories. */
function scoreLearnedSkips(
  poi: PoiSchema,
  ctx: UserRelevanceContext,
): number {
  const tokens = poiTokens(poi);
  let best = 0;
  for (const pattern of ctx.skipPatterns) {
    const overlap = pattern.tagKeys.filter((k) =>
      tokens.has(normalizeKey(k)),
    ).length;
    if (overlap === 0) continue;
    const ratio = overlap / Math.max(1, pattern.tagKeys.length);
    best = Math.max(best, ratio * pattern.confidence);
  }
  return best;
}

/** Session-plan boosts (semantic shopping tags) — high priority while free-roaming. */
function scoreSessionBoosts(
  poi: PoiSchema,
  ctx: UserRelevanceContext,
): number {
  const boosts = ctx.boostTagKeys;
  if (!boosts?.length) return 0;
  const tokens = poiTokens(poi);
  let hits = 0;
  for (const raw of boosts) {
    const key = normalizeKey(raw);
    if (!key) continue;
    if (
      [...tokens].some((t) => t.includes(key) || key.includes(t) || t === key)
    ) {
      hits += 1;
    }
  }
  if (hits === 0) return 0;
  return Math.min(1.5, 0.85 + hits * 0.2);
}

/**
 * Main entry — deterministic, offline-testable, extensible.
 */
export function evaluateRelevance(
  poi: PoiSchema,
  ctx: UserRelevanceContext,
): RelevanceResult {
  const { conflict, match } = scorePrefConflicts(poi, ctx);
  const temporal = scoreTemporalConflict(poi, ctx);
  const learned = scoreLearnedSkips(poi, ctx);
  const boost = scoreSessionBoosts(poi, ctx);

  const conflictScore = conflict * 0.35 + temporal + learned * 0.5;
  const matchScore = match * 0.4 + boost;

  if (boost >= 0.85 && conflictScore < CONFLICT_THRESHOLD) {
    return {
      verdict: 'allow',
      reasonCode: 'session_plan_boost',
      score: matchScore,
    };
  }

  if (conflictScore >= CONFLICT_THRESHOLD && matchScore < 0.2) {
    return {
      verdict: 'skip',
      reasonCode: 'schema_conflict',
      score: conflictScore,
    };
  }

  if (conflictScore >= SOFT_PITCH_THRESHOLD && matchScore >= 0.2) {
    return {
      verdict: 'soft_pitch',
      reasonCode: 'mixed_relevance',
      score: matchScore - conflictScore,
    };
  }

  if (matchScore > 0 || conflictScore < 0.15) {
    return {
      verdict: 'allow',
      reasonCode: 'relevant_or_neutral',
      score: Math.max(matchScore, 0.5 - conflictScore),
    };
  }

  return {
    verdict: 'skip',
    reasonCode: 'low_relevance',
    score: conflictScore,
  };
}
