/**
 * Wann M2 den Auswahl-Pitch statt Agent-Dual-Option nutzen soll.
 */

import { detectCityBestIntent, detectPitchKind } from './parentBrief';
import { looksLikePicnicQuery } from './picnicIntent';
import { extractNamedRestaurantWish } from './namedVenueIntent';

/** Klare Auswahl-/Empfehlungsabsicht — kein STT-Müll, kein Proaktiv-Drift. */
const CHOICE_RE =
  /\b((?:was|wo)\s+(?:kann|soll|würdest|wuerdest|empfiehl)|empfehl(?:ung|st|en)?\s+(?:mir|doch|mal|ein)|zwei\s+option|alternativ(?:e|en)?|bester|beste[rn]?\s+\w+|restaurant|italiener|grieche|pizza|essen\s+gehen|was\s+zu\s+essen|was\s+essen|zum\s+essen|hotel(?:\s+\w+){0,3}\s+(?:mit|in|nahe|für|fuer|finden|suche)|(?:suche|find(?:e|en)?|brauch(?:e)?)\s+(?:ein\s+|ein\s+gutes\s+)?hotel|hotel\s+(?:suchen|finden)|kino|biergarten|hunger|süßhunger|sueßhunger|brunch|sushi|burger|frühstück|fruehstueck|café|cafe\s+(?:in|nahe|empfehl)|snack|snacks|imbiss|döner|doener|eis|spaghettieis|bock\s+auf|strand|baden|hingehen|ins\s+wasser|badestelle|freibad|picknick|picnic|grillen|grillplatz|liegewiese|toilette|apotheke|geldautomat|ladestation|parkplatz|parken|briefkasten|postkasten|mailbox|packstation|paketautomat|vorbeifahren|basketball|tischtennis|trinkwasser|trinkbrunnen)\b/iu;

/**
 * Sticky Venue: Reservierung / Fuß zum gewählten Ort — Task, kein neuer Pitch.
 */
export function isStickyVenueTaskIntent(userText: string): boolean {
  const t = userText.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  try {
    const { looksLikePitchMenuFollowUp } = require('./pitchMenuFollowUp') as {
      looksLikePitchMenuFollowUp: (s: string) => boolean;
    };
    if (looksLikePitchMenuFollowUp(t)) return true;
  } catch {
    /* soft */
  }
  if (
    /\b(reservier\w*|tisch\s+(?:anfrag|buch|vorbereiten|reserv)|platz\s+reserv)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  // Inline (kein Nav-Import): Fuß/Rad-Umschalten + Ziel
  if (
    /\b(lieber|doch|statt|möchte|moechte|will|lass\s+uns)\b/iu.test(t) &&
    /\b(zu\s+fu(?:ss|ß|ße)|zu\s*fuss|laufen|gehend|mit\s+dem\s+(?:fahrrad|rad))\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\b(keine\s+(?:öpnv|oepnv|bahn)|nicht\s+mit\s+(?:der\s+)?(?:bahn|bus|öpnv|oepnv)|lieber\s+zu\s+fu(?:ss|ß|ße))\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\b(zum|zur|nach)\s+\w{3,40}\s+(laufen|gehen)\b/iu.test(t) &&
    /\b(möchte|moechte|will|lass|jetzt)\b/iu.test(t)
  ) {
    return true;
  }
  // Gewählter Ort + Uhrzeit einplanen — kein Re-Pitch (nicht „wo essen heute Abend“)
  if (
    /\b(um\s+\d{1,2}(?:[:.]\d{2})?\s*(?:uhr)?|einplanen)\b/iu.test(t) &&
    (/\b(essen|tisch|hingehen|dort|restaurant|laden)\b/iu.test(t) ||
      utteranceMentionsStickyVenue(t) ||
      hasStickyVenueName()) &&
    !/\b(wo\s+(?:kann|soll)|empfiehl|welche|such(?:e|en)?|vorschlagen)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

function venueNameNeedle(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-zäöüß0-9]/giu, '')
    .slice(0, 10);
}

function utteranceMentionsStickyVenue(userText: string): boolean {
  const low = userText.toLowerCase().replace(/[^a-zäöüß0-9\s]/giu, ' ');
  const names: string[] = [];
  try {
    const { getShortTerm } = require('../context/shortTermContext') as {
      getShortTerm: () => { lastPlaceName?: string | null };
    };
    const n = String(getShortTerm().lastPlaceName || '').trim();
    if (n) names.push(n);
  } catch {
    /* soft */
  }
  try {
    const { useLivePitchStore } = require('./publishPitchUi') as {
      useLivePitchStore: {
        getState: () => { options?: Array<{ name?: string }> };
      };
    };
    for (const o of useLivePitchStore.getState().options ?? []) {
      if (o.name) names.push(o.name);
    }
  } catch {
    /* soft */
  }
  for (const n of names) {
    const needle = venueNameNeedle(n);
    if (needle.length >= 4 && low.replace(/\s+/g, '').includes(needle.slice(0, 6))) {
      return true;
    }
  }
  return false;
}

function hasStickyVenueName(): boolean {
  try {
    const { getShortTerm } = require('../context/shortTermContext') as {
      getShortTerm: () => { lastPlaceName?: string | null };
    };
    if (String(getShortTerm().lastPlaceName || '').trim()) return true;
  } catch {
    /* soft */
  }
  try {
    const { useLivePitchStore } = require('./publishPitchUi') as {
      useLivePitchStore: {
        getState: () => {
          selectedOptionId?: string | null;
          options?: Array<{ id: string; name?: string }>;
        };
      };
    };
    const st = useLivePitchStore.getState();
    if (st.selectedOptionId && (st.options?.length ?? 0) >= 1) return true;
    if ((st.options?.length ?? 0) === 1 && st.options?.[0]?.name) return true;
  } catch {
    /* soft */
  }
  return false;
}

export function shouldHandoffToPitchModule(userText: string): boolean {
  const t = userText.replace(/\s+/g, ' ').trim();
  if (t.length < 4) return false;
  try {
    const { looksLikePitchMenuFollowUp } = require('./pitchMenuFollowUp') as {
      looksLikePitchMenuFollowUp: (s: string) => boolean;
    };
    if (looksLikePitchMenuFollowUp(t)) return false;
  } catch {
    /* soft */
  }
  // Trivia / Faktenzahl / Personenalter → Chat/Research, kein Auswahl-Pitch
  try {
    const { looksLikeInstantAnswerLeadQuery } = require('../kernel/instantAnswerLeadQuery') as {
      looksLikeInstantAnswerLeadQuery: (s: string) => boolean;
    };
    if (looksLikeInstantAnswerLeadQuery(t)) return false;
  } catch {
    /* soft */
  }
  // Phase 5a: Basketball/TT/Trinkwasser/Grill/Briefkasten → immer Pitch
  try {
    const { isAmenityPlaceFindQuery } = require('../mission/amenityPlaceFind') as {
      isAmenityPlaceFindQuery: (s: string) => boolean;
    };
    if (isAmenityPlaceFindQuery(t)) return true;
  } catch {
    /* soft */
  }
  // SUP/Bouldern/Surf → Activity-Research, kein Gastro-HardMatch-Pitch
  try {
    const { isActivitySportQuery } = require('../../services/research/activitySportResearch') as {
      isActivitySportQuery: (s: string) => boolean;
    };
    if (
      isActivitySportQuery(t) &&
      !/\b(restaurant|pizza|essen\s+gehen|steak|hotel|kino)\b/iu.test(t)
    ) {
      return false;
    }
  } catch {
    /* soft */
  }
  // „Was kann man am Ort X machen?“ bei genanntem Sticky-Ort → Chat/Pack, kein Nearby-Pitch
  try {
    const { getShortTerm } = require('../context/shortTermContext') as {
      getShortTerm: () => { lastPlaceName: string | null };
    };
    const sticky = String(getShortTerm()?.lastPlaceName || '').trim();
    const anaphora =
      /\b(da|dort|hier|dabei|daran|dazu|in\s+diesem\s+park|im\s+park|am\s+ort)\b/iu.test(
        t,
      );
    const namedSticky =
      sticky.length >= 3 &&
      t.toLowerCase().includes(sticky.toLowerCase().slice(0, Math.min(12, sticky.length)));
    const activityAtNamedPlace =
      /\b(was\s+kann\s+(?:man|ich|wir)|was\s+gibt\s+es|was\s+machen)\b/iu.test(t) &&
      /\b(bei|in|am|im|auf)\s+[A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\s-]{2,40}/u.test(t) &&
      !/\b(restaurant|essen|pizza|hotel|kino|party|steak)\b/iu.test(t);
    if (
      ((anaphora || namedSticky) &&
        /\b(was\s+kann\s+man|was\s+gibt\s+es|was\s+machen|aktivit|unternehmen|entdecken)\b/iu.test(
          t,
        ) &&
        !/\b(restaurant|essen|pizza|hotel|kino|party)\b/iu.test(t)) ||
      activityAtNamedPlace
    ) {
      return false;
    }
  } catch {
    /* soft */
  }
  // Gewählter Ort + Reserve/Fuß/Uhr → Gastro/Nav-Task, kein neuer Pitch
  if (
    isStickyVenueTaskIntent(t) &&
    (hasStickyVenueName() || utteranceMentionsStickyVenue(t))
  ) {
    return false;
  }
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
      isInventoryFollowUp(t) &&
      !isStickyVenueTaskIntent(t)
    ) {
      return true;
    }
  } catch {
    /* soft */
  }
  if (t.length < 8) return false;
  // Aktivität/Verleih (SUP etc.): Call-1 frei — kein Pitch-Force (Autonomy Reboot).
  // Inline-Regex (kein activitySportResearch-Import → RN-Deps in Smokes).
  if (
    /\b(spikeball|bouldern|boulderhalle|surf(?:en|kurs)?|kitesurf|sup\b|stand[-\s]?up|paddle\s*board|paddle|beachvolleyball|klettern|tauchen|golf|tennis)\b/iu.test(
      t,
    )
  ) {
    return false;
  }
  // Gewässer-Follow-up (SUP auf dem genannten See/…) — nie lokale Gastro pitchen
  if (
    /\b(see|meer|fluss|alster|elb[e]?|hafen|weiher|bucht)\b/iu.test(t) &&
    /\b(sup\b|paddle|paddeln|kanu|kajak|schwimmen|baden|verleih|geht\s+das|darf\s+ich)\b/iu.test(
      t,
    )
  ) {
    return false;
  }
  try {
    const { resolveFollowupThread } = require('../reboot/pipeline/followupThread') as {
      resolveFollowupThread: (
        s: string,
        r: Array<{ role: 'user' | 'assistant'; text: string }>,
      ) => { inherit: string };
    };
    const { getShortTerm } = require('../context/shortTermContext') as {
      getShortTerm: () => { lastTopic?: string | null };
    };
    const topic = String(getShortTerm()?.lastTopic || '');
    if (
      resolveFollowupThread(t, []).inherit === 'water_activity' ||
      (/\b(sup\b|paddle|verleih)\b/iu.test(t) &&
        /\b(see|meer|fluss|alster|water|gewässer)\b/iu.test(topic))
    ) {
      return false;
    }
  } catch {
    /* soft */
  }
  const kindEarly = detectPitchKind(t);
  const hotelEscape = kindEarly === 'hotel';
  const namedVenueEscape = Boolean(extractNamedRestaurantWish(t));
  let menuFollowOnly = false;
  try {
    const { looksLikePitchMenuFollowUp } = require('./pitchMenuFollowUp') as {
      looksLikePitchMenuFollowUp: (s: string) => boolean;
    };
    menuFollowOnly = looksLikePitchMenuFollowUp(t);
  } catch {
    menuFollowOnly = false;
  }
  const diningEscape =
    !menuFollowOnly &&
    (kindEarly === 'food' ||
      namedVenueEscape ||
      (/\b(speisekarte|menükarte|menuekarte)\b/iu.test(t) &&
        !/\b(wo\s+|empfehl|restaurant\s+für|restaurant\s+fuer|hunger|zwei\s+option)\b/iu.test(
          t,
        ))) &&
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
  // Hotel/Übernachtung: Pitch nur bei klarer Hotel-Absicht — Call-1 darf task_fanout/chat wählen
  if (hotelEscape && !/\b(wie\s+alt|wer\s+ist|wetter)\b/iu.test(t)) return true;
  // Speisekarte / Restaurant: Pitch wenn Gastro-Auswahl — nicht Aktivität/SUP erzwingen
  if (diningEscape) {
    try {
      const { isActivitySportQuery } = require('../../services/research/activitySportResearch') as {
        isActivitySportQuery: (s: string) => boolean;
      };
      if (isActivitySportQuery(t)) return false;
    } catch {
      /* soft */
    }
    return true;
  }
  // Picknick/Grillen: Spot pitchen, keine Heritage-Tour / Timeline
  if (picnicEscape) return true;
  try {
    const { isPlaceGoQuery } = require('../router/placeGoQuery') as {
      isPlaceGoQuery: (s: string) => boolean;
    };
    if (isPlaceGoQuery(t)) {
      // Aktivität/Verleih („wo kann ich SUP“) → Call-1 frei (fanout/activity), kein Pitch-Force
      try {
        const { isActivitySportQuery } = require('../../services/research/activitySportResearch') as {
          isActivitySportQuery: (s: string) => boolean;
        };
        if (isActivitySportQuery(t)) return false;
      } catch {
        /* soft */
      }
      return true;
    }
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
