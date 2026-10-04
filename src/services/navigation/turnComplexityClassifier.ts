/**
 * Turn complexity classifier — decides POI-only vs. Street-View vision guidance.
 * Unlimited vision budget, but only for turns scored as complex.
 */

import { bearingDegrees, distanceMeters, shortestAngleDelta } from './bearing';
import type { NavWaypoint } from './navigationTypes';
import { isTurnManeuver } from './navPredictiveCue';

export type TurnComplexity = 'simple' | 'complex' | 'unknown';

export type ClassifiedTurn = {
  waypointIndex: number;
  lat: number;
  lng: number;
  maneuver: string | null;
  complexity: TurnComplexity;
  score: number;
  reasons: string[];
  headingDeg: number;
  landmark: string | null;
  roadName: string | null;
};

export type ClassifyTurnContext = {
  wp: NavWaypoint;
  prev: { lat: number; lng: number } | null;
  next: { lat: number; lng: number } | null;
  landmark: string | null;
  roadName: string | null;
  /** Distinct road names within ~30 m (from nearby steps). */
  nearbyRoadCount?: number;
  /** Abstand zur nächsten Speak-Abbiegung (m) — eng = Doppel-Abbiegung. */
  chainGapM?: number | null;
  /** True when reverse-geocode indicates urban area. */
  isUrban?: boolean;
  streetViewAvailable?: boolean;
};

/** Live: Tip nur bei echt eng/viele Abzweige — nicht jeder Gabel. */
const COMPLEX_THRESHOLD = 48;

function turnAngleDeg(
  prev: { lat: number; lng: number } | null,
  cur: NavWaypoint,
  next: { lat: number; lng: number } | null,
): number {
  if (!prev || !next) return 0;
  const b1 = bearingDegrees(prev.lat, prev.lng, cur.lat, cur.lng);
  const b2 = bearingDegrees(cur.lat, cur.lng, next.lat, next.lng);
  return Math.abs(shortestAngleDelta(b1, b2));
}

function straightRunBeforeM(
  prev: { lat: number; lng: number } | null,
  cur: NavWaypoint,
): number {
  if (!prev) return 0;
  return distanceMeters(prev.lat, prev.lng, cur.lat, cur.lng);
}

/**
 * Score a turn maneuver 0–100. Higher = more complex → needs vision.
 */
export function scoreTurnComplexity(ctx: ClassifyTurnContext): {
  score: number;
  complexity: TurnComplexity;
  reasons: string[];
} {
  const reasons: string[] = [];
  let score = 0;

  const turn = ctx.wp.maneuver ?? '';
  if (!isTurnManeuver(turn)) {
    return { score: 0, complexity: 'unknown', reasons: ['not_a_turn'] };
  }

  if (ctx.landmark) {
    score -= 30;
    reasons.push('poi_anchor');
  }

  if (ctx.roadName && ctx.roadName.length > 3) {
    score -= 20;
    reasons.push('named_road');
  }

  const angle = turnAngleDeg(ctx.prev, ctx.wp, ctx.next);
  if (angle > 90) {
    score += 25;
    reasons.push('sharp_turn');
  } else if (angle > 60) {
    score += 15;
    reasons.push('moderate_turn');
  }

  const straightM = straightRunBeforeM(ctx.prev, ctx.wp);
  if (straightM > 80) {
    score -= 10;
    reasons.push('long_straight_approach');
  }

  const roadCount = ctx.nearbyRoadCount ?? 1;
  // Kompliziert nur, wenn zwei Straßen wirklich direkt nebeneinander liegen (≤20 m)
  // oder drei und mehr. Eine benannte Straße (Bahnhofstraße) bleibt einfach.
  const tightFork =
    typeof ctx.chainGapM === 'number' &&
    Number.isFinite(ctx.chainGapM) &&
    ctx.chainGapM > 0 &&
    ctx.chainGapM <= 20;
  if (roadCount >= 3 && tightFork) {
    score += 36;
    reasons.push('multi_road_intersection');
  } else if (roadCount >= 2 && tightFork) {
    score += 32;
    reasons.push('nearby_fork_roads');
  }

  // Enge Folgekurbel (Doppel-Abbiegung) — Extra-Hinweis lohnt.
  const chainGap =
    typeof ctx.chainGapM === 'number' && Number.isFinite(ctx.chainGapM)
      ? ctx.chainGapM
      : null;
  if (chainGap != null && chainGap > 0 && chainGap <= 20) {
    score += 28;
    reasons.push('tight_chained_turns');
  }

  if (ctx.isUrban && tightFork) {
    score += 8;
    reasons.push('urban_density');
  }

  if (ctx.streetViewAvailable === false) {
    score += 10;
    reasons.push('no_street_view');
  }

  // Ohne Anker allein keine komplizierte Kreuzung.
  if (!ctx.landmark && !ctx.roadName && tightFork) {
    score += 8;
    reasons.push('no_anchor');
  }

  score = Math.max(0, Math.min(100, score));

  let complexity: TurnComplexity;
  if (score <= COMPLEX_THRESHOLD) {
    complexity = 'simple';
  } else if (!ctx.landmark && score >= COMPLEX_THRESHOLD - 5) {
    complexity = 'complex';
  } else {
    complexity = score > COMPLEX_THRESHOLD ? 'complex' : 'simple';
  }

  return { score, complexity, reasons };
}

export function classifyTurnWaypoint(
  index: number,
  ctx: ClassifyTurnContext,
): ClassifiedTurn {
  const heading = ctx.prev
    ? bearingDegrees(ctx.prev.lat, ctx.prev.lng, ctx.wp.lat, ctx.wp.lng)
    : 0;
  const { score, complexity, reasons } = scoreTurnComplexity(ctx);
  return {
    waypointIndex: index,
    lat: ctx.wp.lat,
    lng: ctx.wp.lng,
    maneuver: ctx.wp.maneuver ?? null,
    complexity,
    score,
    reasons,
    headingDeg: heading,
    landmark: ctx.landmark,
    roadName: ctx.roadName,
  };
}

/** Count distinct road names in a window of waypoints. */
export function countNearbyRoads(
  waypoints: NavWaypoint[],
  centerIndex: number,
  radius = 2,
): number {
  const roads = new Set<string>();
  const lo = Math.max(0, centerIndex - radius);
  const hi = Math.min(waypoints.length - 1, centerIndex + radius);
  for (let i = lo; i <= hi; i++) {
    const r = waypoints[i]?.roadName?.trim();
    if (r && r.length > 2) roads.add(r.toLowerCase());
  }
  return roads.size;
}

/**
 * Distinct road names within ~20 m of the junction (meter window).
 * Zwei Straßen direkt nebeneinander → komplex.
 */
export function countNearbyRoadsWithinM(
  waypoints: NavWaypoint[],
  centerIndex: number,
  radiusM = 20,
): number {
  const center = waypoints[centerIndex];
  if (!center) return 0;
  const roads = new Set<string>();
  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    if (!wp) continue;
    const r = wp.roadName?.trim();
    if (!r || r.length < 3) continue;
    const d = distanceMeters(center.lat, center.lng, wp.lat, wp.lng);
    if (d <= radiusM) roads.add(r.toLowerCase());
  }
  return roads.size;
}
