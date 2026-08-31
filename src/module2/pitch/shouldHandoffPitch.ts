/**
 * Wann M2 den Auswahl-Pitch statt Agent-Dual-Option nutzen soll.
 */

import { detectCityBestIntent, detectPitchKind } from './parentBrief';
import { looksLikePicnicQuery } from './picnicIntent';
import { extractNamedRestaurantWish } from './namedVenueIntent';

/** Klare Auswahl-/Empfehlungsabsicht — kein STT-Müll, kein Proaktiv-Drift. */
const CHOICE_RE =
  /\b((?:was|wo)\s+(?:kann|soll|würdest|wuerdest|empfiehl)|empfehl(?:ung|st|en)?\s+(?:mir|doch|mal|ein)|zwei\s+option|alternativ(?:e|en)?|bester|beste[rn]?\s+\w+|restaurant|italiener|grieche|pizza|essen\s+gehen|was\s+zu\s+essen|was\s+essen|zum\s+essen|hotel(?:\s+\w+){0,3}\s+(?:mit|in|nahe|für|fuer|finden|suche)|(?:suche|find(?:e|en)?|brauch(?:e)?)\s+(?:ein\s+|ein\s+gutes\s+)?hotel|hotel\s+(?:suchen|finden)|kino|biergarten|hunger|süßhunger|sueßhunger|brunch|sushi|burger|frühstück|fruehstueck|café|cafe\s+(?:in|nahe|empfehl)|snack|snacks|imbiss|döner|doener|eis|spaghettieis|bock\s+auf|strand|baden|hingehen|ins\s+wasser|badestelle|freibad|picknick|picnic|grillen|grillplatz|liegewiese|toilette|apotheke|geldautomat|ladestation|parkplatz|parken)\b/iu;

export function shouldHandoffToPitchModule(userText: string): boolean {
  const t = userText.replace(/\s+/g, ' ').trim();
  if (t.length < 4) return false;
  try {
    const { isInventoryFollowUp } = require('../router/liveInventoryGate') as {
      isInventoryFollowUp: (s: string) => boolean;
    };
    const { getLastLiveInventory } = require('../context/shortTermContext') as {
      getLastLiveInventory: () => { kind: string; query: string } | null;
    };
    const pending = getLastLiveInventory();
    if (
      pending &&
      (pending.kind === 'pitch_choice' || pending.kind === 'hotel') &&
      isInventoryFollowUp(t)
    ) {
      return true;
    }
  } catch {
    /* soft */
  }
  if (t.length < 8) return false;
  const kindEarly = detectPitchKind(t);
  const hotelEscape = kindEarly === 'hotel';
  const namedVenueEscape = Boolean(extractNamedRestaurantWish(t));
  const diningEscape =
    (kindEarly === 'food' ||
      namedVenueEscape ||
      /\b(speisekarte|menükarte|menuekarte)\b/iu.test(t)) &&
    !/\b(plan(e|en|ung)|tagesplan|und\s+dann|danach)\b/i.test(t);
  const picnicEscape =
    looksLikePicnicQuery(t) &&
    !/\b(plan(e|en|ung)|tagesplan|und\s+dann|danach)\b/i.test(t);
  let parkingEscape = false;
  try {
    const { isParkingSearchIntent } = require('../../services/concierge/timeCareIntent') as {
      isParkingSearchIntent: (s: string) => boolean;
    };
    parkingEscape = isParkingSearchIntent(t);
  } catch {
    parkingEscape = false;
  }
  // Parken zuerst pitchen — nicht M5/Tour klauen.
  // Parken+Erkunden ist Compound (Pitch, dann Tour), kein Chaos-Tagesplan.
  if (parkingEscape) {
    try {
      const { isParkingThenTour } = require('../router/compoundFollowUp') as {
        isParkingThenTour: (s: string) => boolean;
      };
      if (isParkingThenTour(t)) return true;
    } catch {
      /* soft */
    }
    try {
      const { looksLikeChaoticDayPlanUtterance } = require('../planning/planUtteranceGate') as {
        looksLikeChaoticDayPlanUtterance: (s: string) => boolean;
      };
      if (!looksLikeChaoticDayPlanUtterance(t)) return true;
    } catch {
      return true;
    }
  }
  // Kombi-Tag nie als Gastro-Pitch am GPS klauen.
  try {
    const { shouldForceModul5Handoff } = require('../planning/planHandoffGuard') as {
      shouldForceModul5Handoff: (s: string) => boolean;
    };
    if (shouldForceModul5Handoff(t)) return false;
  } catch {
    /* soft */
  }
  try {
    const { orchestrateUtterance } = require('../reboot/pipeline/orchestrateSlots') as {
      orchestrateUtterance: (s: string) => { weaveDayPlan: boolean };
    };
    if (orchestrateUtterance(t).weaveDayPlan) return false;
  } catch {
    /* soft */
  }
  try {
    const { shouldHandoffToTourModule } = require('../tour/shouldHandoffTour') as {
      shouldHandoffToTourModule: (s: string) => boolean;
    };
    if (shouldHandoffToTourModule(t)) return false;
  } catch {
    /* soft */
  }
  // Hotel/Übernachtung: immer Pitch — auch ohne „suche/bitte“ (STT: „das günstigste Hotel … gibt“)
  if (hotelEscape) return true;
  // Speisekarte / Restaurant in Stadt: Karte liefern, auch ohne Frageverb
  if (diningEscape) return true;
  // Picknick/Grillen: Spot pitchen, keine Heritage-Tour / Timeline
  if (picnicEscape) return true;
  try {
    const { isPlaceGoQuery } = require('../router/placeGoQuery') as {
      isPlaceGoQuery: (s: string) => boolean;
    };
    if (isPlaceGoQuery(t)) return true;
  } catch {
    /* soft */
  }
  // Kein Pitch ohne erkennbare Frage/Wunsch (sonst Proaktiv / STT-Echo)
  if (
    !/[?]/.test(t) &&
    !/\b(bitte|kannst|könntest|koenntest|suche|such|zeig|empfehl|brauch|möcht|moecht|will|woll(?:en|t)|hätte|haette|bock|gibt\s+es|gibt|wo\s|find(?:e|en)?|lass(?:\s+uns)?|idee|gerne|gern|lust)\b/iu.test(
      t,
    )
  ) {
    return false;
  }
  if (!CHOICE_RE.test(t) && !detectCityBestIntent(t) && !hotelEscape) {
    return false;
  }
  const kind = kindEarly;
  return (
    kind === 'food' ||
    kind === 'cinema' ||
    kind === 'bar' ||
    kind === 'sight' ||
    kind === 'hotel' ||
    kind === 'generic' ||
    detectCityBestIntent(t)
  );
}
