/**
 * Default dwell (how long to stay) + early-arrival buffers when not specified.
 * Used by leave-by math and planning prompts.
 */

import type { LogisticsMode } from '../logistics/logisticsTriggerMath';
import { computeArrivalBufferMin } from '../logistics/logisticsTriggerMath';

export type PlaceDwellKind =
  | 'museum'
  | 'restaurant'
  | 'cafe'
  | 'viewpoint'
  | 'shopping'
  | 'beach'
  | 'hotel'
  | 'cinema'
  | 'theater'
  | 'sport'
  | 'generic';

/** Typical stay minutes when user/Gemini did not set a duration. */
export const DEFAULT_DWELL_MIN: Record<PlaceDwellKind, number> = {
  museum: 90,
  restaurant: 75,
  cafe: 40,
  viewpoint: 25,
  shopping: 30,
  beach: 60,
  hotel: 20,
  cinema: 130,
  theater: 150,
  sport: 90,
  generic: 45,
};

export function inferDwellKind(label: string): PlaceDwellKind {
  const t = label.toLowerCase();
  if (/kino|cinema|film|vorstellung/.test(t)) return 'cinema';
  if (/theater|musical|oper|konzert/.test(t)) return 'theater';
  if (/tennis|sport|fitness|gym|training|fußball|fussball/.test(t)) return 'sport';
  if (/museum|galerie|ausstellung/.test(t)) return 'museum';
  if (/restaurant|imbiss|bistro|pizzer|steak/.test(t)) return 'restaurant';
  if (/café|cafe|kaffee|coffee/.test(t)) return 'cafe';
  if (/aussicht|viewpoint|leuchtturm|düne|duene|plattform/.test(t)) {
    return 'viewpoint';
  }
  if (/shop|laden|markt|einkauf|dm|rossmann|supermarkt/.test(t)) {
    return 'shopping';
  }
  if (/strand|beach|baden/.test(t)) return 'beach';
  if (/hotel|pension|unterkunft/.test(t)) return 'hotel';
  return 'generic';
}

export function defaultDwellMinForLabel(label: string): number {
  return DEFAULT_DWELL_MIN[inferDwellKind(label)];
}

/**
 * How early to arrive when not explicitly set — mirrors logistics arrival buffer.
 */
export function defaultEarlyArrivalMin(mode: LogisticsMode = 'generic'): number {
  return computeArrivalBufferMin({ mode });
}

/**
 * Reverse schedule: deadline − dwell − travel − earlyArrival = leave-by.
 */
export function computeStayAwareLeaveBy(opts: {
  deadlineMs: number;
  travelMin: number;
  dwellMin?: number | null;
  placeLabel?: string | null;
  mode?: LogisticsMode;
}): {
  leaveByMs: number;
  dwellMin: number;
  earlyArrivalMin: number;
  travelMin: number;
} {
  const dwellMin =
    opts.dwellMin != null && opts.dwellMin > 0
      ? Math.round(opts.dwellMin)
      : defaultDwellMinForLabel(opts.placeLabel ?? '');
  const earlyArrivalMin = defaultEarlyArrivalMin(opts.mode ?? 'generic');
  const travelMin = Math.max(0, Math.ceil(opts.travelMin));
  const leaveByMs =
    opts.deadlineMs -
    (dwellMin + travelMin + earlyArrivalMin) * 60_000;
  return { leaveByMs, dwellMin, earlyArrivalMin, travelMin };
}
