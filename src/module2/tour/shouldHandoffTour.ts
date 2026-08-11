/**
 * Wann M2 an das Tour-Modul übergibt (vor Pitch).
 */

import {
  detectTourMode,
  looksLikeNamedItinerary,
  shouldPreferTourOverPitch,
  SINGULAR_PITCH_RE,
  MULTI_STOP_RE,
  PATH_RE,
  THEME_MULTI_RE,
} from './parentBrief';

const PLAN_DAY_RE =
  /\b(tagesplan|ganzen\s+tag|morgen\s+früh|timeline|plane\s+mir\s+den\s+tag|itinerar)\b/iu;

export function shouldHandoffToTourModule(userText: string): boolean {
  const t = userText.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  // Klare Multi-Stop-/Path-Tour: Tour gewinnt — auch bei offener M5-Session
  const mode = detectTourMode(t);
  const clearTour =
    mode != null &&
    shouldPreferTourOverPitch(t) &&
    !looksLikeNamedItinerary(t) &&
    !PLAN_DAY_RE.test(t) &&
    !/\b(vormittag|nachmittag|und\s+dann|danach|kalender|timeline)\b/i.test(t);

  if (!clearTour) {
    // Modul 5 besitzt Tagespläne / Multi-Slot — Tour darf das nicht mehr kapern
    try {
      const { shouldForceModul5Handoff } = require('../planning/planHandoffGuard') as {
        shouldForceModul5Handoff: (s: string) => boolean;
      };
      if (shouldForceModul5Handoff(t)) return false;
    } catch {
      if (PLAN_DAY_RE.test(t)) return false;
    }
  }
  if (looksLikeNamedItinerary(t)) return false;
  // Singular Pitch gewinnt nur ohne Multi/Path
  if (
    SINGULAR_PITCH_RE.test(t) &&
    !MULTI_STOP_RE.test(t) &&
    !THEME_MULTI_RE.test(t) &&
    !PATH_RE.test(t)
  ) {
    return false;
  }
  if (!shouldPreferTourOverPitch(t)) return false;
  return detectTourMode(t) != null;
}
