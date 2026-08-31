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
import { looksLikePicnicQuery } from '../pitch/picnicIntent';

const PLAN_DAY_RE =
  /\b(tagesplan|ganzen\s+tag|morgen\s+früh|timeline|plane\s+mir\s+den\s+tag|itinerar)\b/iu;

const LIFE_SLOT_RE =
  /\b(frühstück|fruehstueck|breakfast|pann|michel|elbblick|abendessen|los)\b/iu;

/** „Tour“ als Slot im Tagesplan ≠ Tour-Modul am GPS. */
function dayPlanOwnsTourWord(t: string): boolean {
  if (PLAN_DAY_RE.test(t)) return true;
  if (!LIFE_SLOT_RE.test(t)) return false;
  try {
    const { looksLikeChaoticDayPlanUtterance } =
      require('../planning/planUtteranceGate') as {
        looksLikeChaoticDayPlanUtterance: (s: string) => boolean;
      };
    if (looksLikeChaoticDayPlanUtterance(t)) return true;
  } catch {
    /* soft */
  }
  try {
    const { userWantsDestinationDay } =
      require('../planning/planDestinationCity') as {
        userWantsDestinationDay: (s: string) => boolean;
      };
    if (userWantsDestinationDay(t)) return true;
  } catch {
    /* soft */
  }
  return false;
}

export function shouldHandoffToTourModule(userText: string): boolean {
  const t = userText.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (looksLikePicnicQuery(t)) return false;
  try {
    const { isParkingSearchIntent } = require('../../services/concierge/timeCareIntent') as {
      isParkingSearchIntent: (s: string) => boolean;
    };
    if (isParkingSearchIntent(t)) return false;
  } catch {
    /* soft */
  }
  // Kombi-Tag (Hamburg frühstücken + Pannfisch + Michel + „eine Tour“)
  // ist Modul 5 — nie GPS-Pack-Tour ab Jetzt.
  if (dayPlanOwnsTourWord(t)) return false;

  const mode = detectTourMode(t);
  const clearTour =
    mode != null &&
    shouldPreferTourOverPitch(t) &&
    !looksLikeNamedItinerary(t) &&
    !PLAN_DAY_RE.test(t) &&
    !/\b(vormittag|nachmittag|und\s+dann|danach|kalender|timeline)\b/i.test(t);

  if (!clearTour) {
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
