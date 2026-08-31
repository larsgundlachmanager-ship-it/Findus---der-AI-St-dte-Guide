/**
 * SSOT: Wann Modul 5 den Turn übernimmt (keine Legacy-Compound / Tour / Pitch).
 */

import {
  looksLikeChaoticDayPlanUtterance,
  looksLikeModul5PlanUtterance,
  looksLikeOutfitOrWeatherUtterance,
  looksLikeSingleJustDoItRequest,
  looksLikeTouristTripUtterance,
  looksLikePlanWalkthroughUtterance,
} from './planUtteranceGate';
import { looksLikePlanEditUtterance } from './planEditDetect';
import { isPlanningModuleActive } from './planSessionState';
import { usePlanCalendarUiStore } from '../timeline/planCalendarUiStore';
import { looksLikeImportantModul2Finish } from './planSpeechPolicy';

/**
 * Harte Übergabe an runPlanningModule — vor Manager-LLM, Tour und Pitch.
 */
export function shouldForceModul5Handoff(userText: string): boolean {
  const t = (userText ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (looksLikeOutfitOrWeatherUtterance(t)) return false;
  // Compound-Skeleton schon da → Step-Loop starten, kein neuer Ingest-Monolog
  if (looksLikePlanWalkthroughUtterance(t) && isPlanningModuleActive()) {
    try {
      const { usePlanSessionStore } = require('./planSessionState') as {
        usePlanSessionStore: {
          getState: () => { plan?: { openWishesQueue?: unknown[] } | null };
        };
      };
      if ((usePlanSessionStore.getState().plan?.openWishesQueue?.length ?? 0) > 0) {
        return true;
      }
    } catch {
      return true;
    }
  }
  try {
    const { looksLikePicnicQuery } = require('../pitch/picnicIntent') as {
      looksLikePicnicQuery: (s: string) => boolean;
    };
    if (looksLikePicnicQuery(t) && !looksLikeChaoticDayPlanUtterance(t)) {
      return false;
    }
  } catch {
    /* soft */
  }
  try {
    const { isParkingSearchIntent } = require('../../services/concierge/timeCareIntent') as {
      isParkingSearchIntent: (s: string) => boolean;
    };
    if (isParkingSearchIntent(t)) {
      try {
        const { isParkingThenTour } = require('../router/compoundFollowUp') as {
          isParkingThenTour: (s: string) => boolean;
        };
        if (isParkingThenTour(t)) return false;
      } catch {
        /* soft */
      }
      if (!looksLikeChaoticDayPlanUtterance(t)) return false;
    }
  } catch {
    /* soft */
  }

  try {
    const { shouldYieldPlanWaitToFlight } = require('../../services/flights/flightTripIntent') as {
      shouldYieldPlanWaitToFlight: (opts: {
        userText: string;
        hasOpenSession?: boolean;
        pendingAsk?: string | null;
      }) => boolean;
    };
    const { hasFlightTripSession, getFlightTripSession } = require('../../services/flights/flightTripSession') as {
      hasFlightTripSession: () => boolean;
      getFlightTripSession: () => { pendingAsk?: string | null } | null;
    };
    const open = hasFlightTripSession();
    if (
      shouldYieldPlanWaitToFlight({
        userText: t,
        hasOpenSession: open,
        pendingAsk: open ? getFlightTripSession()?.pendingAsk ?? null : null,
      })
    ) {
      return false;
    }
  } catch {
    /* soft */
  }

  // Wecker/Timer/Erinnerung/Lautstärke/Nahschauen = Just-Do-It, nie als Plan-Ingest.
  // Ausnahme: Tagesplan — Wecker erst am Planende, „um 9 los“ ist Abfahrt.
  if (!looksLikeModul5PlanUtterance(t)) {
    try {
      const { isVolumeIntent, isLookNearIntent } = require(
        '../../services/concierge/earlyJustDoIt',
      ) as {
        isVolumeIntent: (s: string) => boolean;
        isLookNearIntent: (s: string) => boolean;
      };
      const { isClockIntent } = require('../../services/alarms/clockIntents') as {
        isClockIntent: (s: string) => boolean;
      };
      const { userAsksRemind } = require('../../services/concierge/reminderActionPolicy') as {
        userAsksRemind: (s: string) => boolean;
      };
      if (
        isClockIntent(t) ||
        isVolumeIntent(t) ||
        isLookNearIntent(t) ||
        userAsksRemind(t)
      ) {
        return false;
      }
    } catch {
      try {
        const { isClockIntent } = require('../../services/alarms/clockIntents') as {
          isClockIntent: (s: string) => boolean;
        };
        if (isClockIntent(t)) return false;
      } catch {
        /* soft */
      }
    }
  }

  // Explizite Einzel-Nav nie in M5 stehlen (auch bei offener Planungssession)
  try {
    const { isExplicitNavIntent } = require('../../services/intent/poiInfoVsNav') as {
      isExplicitNavIntent: (s: string) => boolean;
    };
    // Harte Regel: „Bring/Fahr mich…“ ist nie Timeline — egal Session/Kalender
    if (isExplicitNavIntent(t)) return false;
  } catch {
    /* soft */
  }

  // Explizite Sightseeing-Tour (Stopps/Rundgang) → Tour-Modul, nicht Timeline
  try {
    const { detectTourMode, shouldPreferTourOverPitch } = require('../tour/parentBrief') as {
      detectTourMode: (s: string) => string | null;
      shouldPreferTourOverPitch: (s: string) => boolean;
    };
    if (
      detectTourMode(t) &&
      shouldPreferTourOverPitch(t) &&
      !looksLikeChaoticDayPlanUtterance(t) &&
      !/\b(tagesplan|timeline|kalender|vormittag|nachmittag|und\s+dann|danach|frühstück|fruehstueck|breakfast|pann|michel|los)\b/i.test(
        t,
      )
    ) {
      return false;
    }
  } catch {
    /* soft */
  }

  // Chaos-Tag zuerst (Meeting+Frühstück+Essen+Party …)
  if (looksLikeChaoticDayPlanUtterance(t)) return true;

  // Touristen-Trip: „4 Tage München“ / Wochenende / Tagestrip
  if (looksLikeTouristTripUtterance(t)) return true;

  const sessionActive = isPlanningModuleActive();
  const calOpen = usePlanCalendarUiStore.getState().calendarVisible;

  // Aktive Planungssession: Wartezustände + Plan-Sprache → M5;
  // Off-Topic (Wissen/Wetter/Story) → Modul 2, Timeline bleibt offen.
  if (sessionActive) {
    try {
      const { usePlanSessionStore } = require('./planSessionState') as {
        usePlanSessionStore: {
          getState: () => {
            waitingConfirm: boolean;
            waitingLocation: boolean;
            waitingConflict: boolean;
            phase: string;
          };
        };
      };
      const s = usePlanSessionStore.getState();
      if (s.waitingConfirm || s.waitingLocation || s.waitingConflict) {
        return true;
      }
      if (s.phase === 'select_mode' || s.phase === 'step_loop') {
        // Pick / Neu-suchen / Edit während Pitch
        if (
          looksLikePlanEditUtterance(t) ||
          /\b(🥇|🥈|option\s*[ab]|favorit|neu\s*suchen|beides\s*nicht|weiter|passt)\b/i.test(
            t,
          )
        ) {
          return true;
        }
      }
    } catch {
      /* soft */
    }

    // Hotel in anderer Stadt / mit Daten = Sofort-Suche, nicht an Frühstücks-Pitch hängen
    if (
      /\b(hotel|übernacht|uebernacht|unterkunft|zimmer|hostel|pension)\b/i.test(
        t,
      ) &&
      !looksLikePlanEditUtterance(t)
    ) {
      return false;
    }
    // Speisekarte / Restaurant-Just-Do-It trotz offener Timeline
    if (
      /\b(speisekarte|menükarte|menuekarte)\b/i.test(t) &&
      !looksLikePlanEditUtterance(t)
    ) {
      return false;
    }
    if (looksLikeSingleJustDoItRequest(t) && !looksLikePlanEditUtterance(t)) {
      return false;
    }
    try {
      const { isPoiInfoQuestion } = require('../../services/intent/poiInfoVsNav') as {
        isPoiInfoQuestion: (s: string) => boolean;
      };
      if (isPoiInfoQuestion(t)) return false;
    } catch {
      /* soft */
    }
    // Stadt-/Ort-Geschichte („erzähl mir was über Prisdorf“) ≠ Tagesplan-Edit
    if (
      /\b(erzähl|erzaehl|erzähl\s+mir|geschichte|historie|wissenswert)\b/i.test(
        t,
      ) &&
      /\b(über|ueber|von|vom|zu|zum|zur)\b/i.test(t) &&
      !/\b(plan|änder|aender|verschieb|termin|kalender)\b/i.test(t)
    ) {
      return false;
    }
    // Pack-Story / Modul-1 klar benannt
    if (
      /\b(geschichte|historie|mehr\s+(dazu|historie)|erzähl|erzaehl)\b/i.test(
        t,
      ) &&
      !/\b(plan|änder|aender|verschieb|termin|kalender|und\s+dann)\b/i.test(t)
    ) {
      return false;
    }
    if (looksLikePlanEditUtterance(t) || looksLikeModul5PlanUtterance(t)) {
      return true;
    }
    // Wichtiges Off-Topic (Story/Notfall/GPS) → Modul 2 zu Ende; sonst Plan spricht
    if (looksLikeImportantModul2Finish(t)) return false;
    return true;
  }

  if (looksLikePlanEditUtterance(t) && (calOpen || sessionActive)) {
    return true;
  }

  if (looksLikeModul5PlanUtterance(t)) {
    return true;
  }

  // Kalender offen + Planungs-Sprache (nicht nur gucken + Einzelwunsch)
  if (
    calOpen &&
    !looksLikeSingleJustDoItRequest(t) &&
    /\b(plan|änder|aender|verschieb|lösch|loesch|termin|wunsch|danach|und\s+dann)\b/i.test(
      t,
    )
  ) {
    return true;
  }

  return false;
}

/** Legacy Compound-SessionPlan darf das nicht mehr kapern. */
export function shouldBlockLegacyCompoundPlan(userText: string): boolean {
  const t = (userText ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (looksLikeChaoticDayPlanUtterance(t)) return true;
  if (looksLikeModul5PlanUtterance(t)) return true;
  if (looksLikePlanEditUtterance(t)) return true;
  if (isPlanningModuleActive()) return true;
  if (
    t.length >= 50 &&
    /\b(um\s+\d{1,2}|\d{1,2}:\d{2})\b/.test(t) &&
    /\b(und\s+dann|danach|zuerst|außerdem|ausserdem)\b/i.test(t)
  ) {
    return true;
  }
  return false;
}
