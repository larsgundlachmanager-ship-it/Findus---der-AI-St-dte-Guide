/**
 * Modul 5 — Planungsassistent Entry (Timeline / Kalender).
 * SSOT-Einstieg: Ingest → Session-Orchestrator.
 */

import { Linking } from 'react-native';
import { notePlanningSessionEnded } from '../../services/navigation/modulePriorityPolicy';
import { runPlanningIngestion } from './planningLlmIngestion';
import {
  injectNavigationNode,
  runPlanSession,
  applyMasterTimeline,
} from './planSessionOrchestrator';
import {
  isPlanningModuleActive,
  usePlanSessionStore,
} from './planSessionState';
import {
  revealPlanCalendarNow,
  usePlanCalendarUiStore,
} from '../timeline/planCalendarUiStore';
import { setActiveTaskOverride } from './planSessionState';
import type { IngestOpenWish } from './planningTypes';
import { useFuturePlanStore } from '../timeline/futurePlanState';
import { applyGapFillTravelLegs } from '../timeline/gapFillTravel';
import {
  buildReservationMailtoDraft,
  withReservationPrefill,
} from '../../services/reservation/reservationPrefill';
import { getCachedUserProfile } from '../../services/userProfileService';
import { getReservationContact } from '../../types/userProfile';
import { executeDeepResearchAndPitch, isExploreWish } from './planPlacesResearch';
import {
  ensurePlanningLiveChat,
  releasePlanningLiveChat,
} from './planLiveChatBridge';
import {
  beginPlanProSession,
  endPlanProSession,
} from './planProScore';
import {
  resetPlanAgentChat,
  seedPlanAgentAfterIngest,
  runPlanAgentFollowUp,
} from './planAgentSession';
import {
  detectPlanTimeConflict,
  offerConflictShortAnswers,
} from './planConflictHandoff';
import {
  inferTripPrefsFromText,
  loadPlanTripPrefs,
  savePlanTripPrefs,
} from './planTripPrefs';
import {
  looksLikePlanEditUtterance,
  looksLikeClearDayPlan,
} from './planEditDetect';
import { looksLikePlanWalkthroughUtterance } from './planUtteranceGate';
import { sanitizePlanSpeech } from './planSpeechSanitize';

export { isPlanningModuleActive } from './planSessionState';
export { MASTER_INGEST_SYSTEM } from './planningLlmIngestion';
export { DEEP_RESEARCH_SYSTEM } from './planPlacesResearch';
export { calculateNavigation } from './planMobilityEngine';
export { runFinalTimelineOptimization } from './planConflictResolve';
export { runPlanSession, startPlanStepLoop } from './planSessionOrchestrator';

let running = false;
let runningSinceMs = 0;

async function speakPlanAck(text: string): Promise<void> {
  try {
    const { enqueueSpeech } = await import('../speech/speechQueue');
    enqueueSpeech({
      kind: 'main',
      text: sanitizePlanSpeech(text),
      turnId: `m5_ack_${Date.now()}`,
    });
  } catch {
    /* soft */
  }
}

/** Labels that must NOT re-run planning ingest. */
const FINAL_ACTION_RE =
  /^\s*(tisch\s*reservieren|taxi\s*vorbestellen|tickets?\s*(buchen)?)\s*$/i;

function msToHm(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Tisch / Taxi / Tickets → OPEN_URL / Book, nie neuer Ingest.
 */
async function handleFinalPlanAction(label: string): Promise<boolean> {
  const t = label.replace(/\s+/g, ' ').trim();
  if (!FINAL_ACTION_RE.test(t)) return false;

  const mirrored = usePlanCalendarUiStore.getState().mirroredActions;
  const match = mirrored.find(
    (a) => a.label.toLowerCase() === t.toLowerCase(),
  );
  if (match?.type === 'OPEN_URL' && match.payload.url) {
    try {
      await Linking.openURL(match.payload.url);
    } catch {
      /* soft */
    }
    return true;
  }
  if (match?.type === 'BOOK_UBER') {
    // Uber/Taxi-Button existiert — UI handleQuickAction via mirror; hier no-op ok
    return true;
  }

  if (/tisch/i.test(t)) {
    const profile = getCachedUserProfile();
    const contact = getReservationContact(profile);
    const plan = useFuturePlanStore.getState().plan;
    const dining =
      plan.stops.find(
        (s) =>
          s.kind === 'stop' &&
          !s.id.startsWith('choice_') &&
          /essen|restaurant|mittag|abend|café|cafe|dinner|lunch/i.test(
            `${s.title} ${s.notes ?? ''}`,
          ),
      ) ??
      plan.stops.find(
        (s) =>
          s.kind === 'stop' &&
          !s.id.startsWith('choice_') &&
          !s.id.startsWith('anchor_'),
      );
    if (!dining) return true;
    const name = dining.title.replace(/^[🥇🥈📌📍✨🏁]\s*/u, '').trim();
    const timeHm = msToHm(dining.plannedStartMs);
    let url =
      dining.reserveUrl?.trim() ||
      buildReservationMailtoDraft({
        restaurantEmail: null,
        restaurantName: name,
        guestName: contact.fullName || '',
        guestEmail: contact.email || '',
        guestPhone: contact.phoneNumber || null,
        partySize: 2,
        timeHm,
        dateIso: plan.dayKey,
        notes: null,
      });
    if (url && !/^mailto:/i.test(url) && dining.reserveUrl) {
      url = withReservationPrefill(url, {
        partySize: 2,
        dateIso: plan.dayKey,
        timeHm,
        guestName: contact.fullName || null,
        guestEmail: contact.email || null,
        guestPhone: contact.phoneNumber || null,
      });
    }
    try {
      await Linking.openURL(url);
    } catch {
      /* soft */
    }
    return true;
  }

  if (/tickets?/i.test(t)) {
    try {
      await Linking.openURL('https://www.google.com/search?q=tickets');
    } catch {
      /* soft */
    }
    return true;
  }

  return true;
}

/**
 * Mic / Short-Answer → Modul 5.
 * Gates (Confirm / Location / Step) laufen IMMER vor dem running-Lock.
 */
export async function runPlanningModule(input: {
  userText: string;
  turnId?: string;
  signal?: AbortSignal;
  frame?: import('../router/turnFrame').TurnFrame | null;
}): Promise<{ ok: boolean }> {
  const text = (input.userText ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return { ok: false };

  // Tag leeren ZUERST — sonst wird „lösche die Timeline“ als Wunsch ingestiert
  if (looksLikeClearDayPlan(text)) {
    try {
      const { clearDayPlan } = require('../timeline/planLiveEdits') as {
        clearDayPlan: (dayKey?: string) => { handled: boolean; speech: string };
      };
      const direct = clearDayPlan();
      if (direct.speech) await speakPlanAck(direct.speech);
    } catch (err) {
      console.warn('[module5] clear day failed', err);
    }
    return { ok: true };
  }

  // Gates ZUERST — bevor Tour/Just-Do-It/Ingest „Ja“ als neuen Turn schluckt
  {
    const session = usePlanSessionStore.getState();
    if (session.waitingConflict) {
      const { isPlanConfirmYes } = require('./planConfirmAck') as {
        isPlanConfirmYes: (s: string) => boolean;
      };
      session.resolveConflict(isPlanConfirmYes(text));
      return { ok: true };
    }
    if (session.waitingLocation) {
      if (/^(der club heißt|der club heisst)\s*[.…]*$/i.test(text)) {
        return { ok: true };
      }
      session.resolveLocation(text);
      return { ok: true };
    }
    if (session.waitingConfirm) {
      try {
        const { shouldYieldPlanWaitToFlight, isFlightTripQuery } = require(
          '../../services/flights/flightTripIntent',
        ) as {
          shouldYieldPlanWaitToFlight: (o: {
            userText: string;
            hasOpenSession?: boolean;
            pendingAsk?: string | null;
          }) => boolean;
          isFlightTripQuery: (s: string) => boolean;
        };
        const {
          hydrateFlightTripSession,
          hasFlightTripSession,
          getFlightTripSession,
        } = require('../../services/flights/flightTripSession') as {
          hydrateFlightTripSession: () => Promise<void>;
          hasFlightTripSession: () => boolean;
          getFlightTripSession: () => { pendingAsk?: string | null } | null;
        };
        await hydrateFlightTripSession();
        const open = hasFlightTripSession();
        if (
          isFlightTripQuery(text) ||
          shouldYieldPlanWaitToFlight({
            userText: text,
            hasOpenSession: open,
            pendingAsk: open ? getFlightTripSession()?.pendingAsk ?? null : null,
          })
        ) {
          const { releasePlanWaitForForeignTopic } = require('./planSessionState') as {
            releasePlanWaitForForeignTopic: () => void;
          };
          releasePlanWaitForForeignTopic();
          return { ok: false, yieldToFlight: true };
        }
      } catch {
        /* soft */
      }
      const { isPlanConfirmYes, isPlanConfirmNo } = require('./planConfirmAck') as {
        isPlanConfirmYes: (s: string) => boolean;
        isPlanConfirmNo: (s: string) => boolean;
      };
      if (isPlanConfirmYes(text)) {
        session.resolveConfirm(true);
        return { ok: true };
      }
      if (isPlanConfirmNo(text)) {
        session.resolveConfirm(false);
        return { ok: true };
      }
      if (looksLikePlanEditUtterance(text)) {
        try {
          const { applyPlanEditFromUtterance } = require('../timeline/planLiveEdits') as {
            applyPlanEditFromUtterance: (t: string) => {
              handled: boolean;
              speech: string;
            };
          };
          const direct = applyPlanEditFromUtterance(text);
          if (direct.handled) {
            if (direct.speech) await speakPlanAck(direct.speech);
            return { ok: true };
          }
        } catch {
          /* soft */
        }
      }
      session.setPendingAmendment(text);
      session.resolveConfirm(false);
      return { ok: true };
    }

    // Compound-Skeleton → Step-Loop (kein zweiter Tages-Monolog / Re-Ingest)
    if (
      looksLikePlanWalkthroughUtterance(text) &&
      (session.plan?.openWishesQueue?.length ?? 0) > 0
    ) {
      if (running) {
        if (runningSinceMs > 0 && Date.now() - runningSinceMs > 90_000) {
          running = false;
          runningSinceMs = 0;
        } else if (
          session.phase === 'step_loop' ||
          session.phase === 'select_mode'
        ) {
          await speakPlanAck('Wir sind schon bei den Punkten — tipp Weiter oder wähl.');
          return { ok: true };
        }
      }
      running = true;
      runningSinceMs = Date.now();
      try {
        const { startPlanStepLoop } = await import('./planSessionOrchestrator');
        const ok = await startPlanStepLoop({ plan: session.plan });
        return { ok };
      } catch (err) {
        console.warn('[module5] step loop failed', err);
        await speakPlanAck(
          'Da ist kurz etwas hängen geblieben — sag nochmal „Punkte durchgehen“.',
        );
        return { ok: false };
      } finally {
        running = false;
        runningSinceMs = 0;
      }
    }
  }

  try {
    usePlanCalendarUiStore.getState().touchPlanInteraction();
  } catch {
    /* soft */
  }

  // Prefs + Idle-Fenster von Sekunde 1 — Mic erst bei Rückfrage
  void loadPlanTripPrefs();
  void ensurePlanningLiveChat();

  // Timeline SOFORT öffnen — Ingest/Recherche darf den ersten Paint nicht blocken
  try {
    const { tryResolveDateKeyFromUserText, todayDateKey } = require(
      '../../utils/dateKeys',
    ) as {
      tryResolveDateKeyFromUserText: (t: string) => string | null;
      todayDateKey: () => string;
    };
    const sessionDay = usePlanSessionStore.getState().plan?.targetDate ?? null;
    const day =
      tryResolveDateKeyFromUserText(text) ||
      usePlanCalendarUiStore.getState().requestedDayKey ||
      sessionDay ||
      useFuturePlanStore.getState().plan.dayKey ||
      todayDateKey();
    useFuturePlanStore.getState().ensureDay(day);
    await revealPlanCalendarNow(day);
    if (!usePlanSessionStore.getState().active) {
      try {
        const { speakContextualBridgeFireAndForget } = require(
          '../../services/speech/contextualBridge',
        ) as {
          speakContextualBridgeFireAndForget: (
            t: string,
            o?: { allowLiveChat?: boolean },
          ) => void;
        };
        speakContextualBridgeFireAndForget(text, { allowLiveChat: true });
      } catch {
        /* soft */
      }
      if (!looksLikePlanEditUtterance(text)) {
        try {
          const { buildSkeletonPlanFromUtterance } = require('./planUtteranceSlots') as {
            buildSkeletonPlanFromUtterance: (o: {
              utterance: string;
              dayKey: string;
              gpsCity?: string | null;
              destCity?: string | null;
              geoAnchor: {
                name: string;
                type: 'CURRENT_GPS' | 'HOTEL_START';
                needsClarification: boolean;
                lat?: number | null;
                lng?: number | null;
              };
            }) => import('./planningTypes').IngestedPlan;
          };
          const { readRucksackSync, anchorCoords } = require('../rucksack/rucksackStore') as {
            readRucksackSync: () => { cityHint?: string | null };
            anchorCoords: (b: { cityHint?: string | null }) => { lat: number; lng: number };
          };
          const bag = readRucksackSync();
          const gps = anchorCoords(bag);
          const skeleton = buildSkeletonPlanFromUtterance({
            utterance: text,
            dayKey: day,
            gpsCity: bag.cityHint ?? null,
            destCity: input.frame?.destCity ?? null,
            geoAnchor: {
              name: bag.cityHint ? `Start (${bag.cityHint})` : 'Start',
              type: 'CURRENT_GPS',
              needsClarification: false,
              lat: gps.lat,
              lng: gps.lng,
            },
          });
          if (skeleton.openWishesQueue.length > 0) {
            applyMasterTimeline(skeleton);
          }
        } catch (seedErr) {
          console.warn('[module5] skeleton seed failed', seedErr);
        }
      }
    }
  } catch (err) {
    console.warn('[module5] early calendar open failed', err);
  }

  // Guard: Final-Action-Labels nie als neuen Planungs-Ingest
  if (FINAL_ACTION_RE.test(text)) {
    await handleFinalPlanAction(text);
    return { ok: true };
  }

  // Tour / Erkunden während Planung → Tour-Stops (nicht Chat)
  try {
    const { shouldHandoffToTourModule } = await import(
      '../tour/shouldHandoffTour'
    );
    if (shouldHandoffToTourModule(text)) {
      const { tryEarlyTourHandoff } = await import(
        '../router/handoffs/m5Early'
      );
      const tour = await tryEarlyTourHandoff({
        rewritten: text,
        turnId: `m5_tour_${Date.now()}`,
      });
      if (tour) {
        return { ok: true };
      }
    }
  } catch (err) {
    console.warn('[module5] tour handoff failed', err);
  }

  // Just-Do-It während Planung — Wecker/Timer nur wenn KEIN Tagesplan
  try {
    const { clockIntentYieldsToDayPlan } = require('./planClockGuard') as {
      clockIntentYieldsToDayPlan: (s: string) => boolean;
    };
    if (!clockIntentYieldsToDayPlan(text)) {
      const { tryEarlyJustDoIt } = await import(
        '../../services/concierge/earlyJustDoIt'
      );
      const early = await tryEarlyJustDoIt(text);
      if (early?.speech) {
        try {
          if (early.quickActions?.length) {
            usePlanCalendarUiStore
              .getState()
              .setMirroredActions(early.quickActions.slice(0, 4));
          }
          const { presentConciergeResponse } = await import(
            '../../services/concierge/presentConcierge'
          );
          await presentConciergeResponse(
            {
              speechText: early.speech,
              visualBullets: (early.bullets ?? []).slice(0, 3),
              quickActions: (early.quickActions ?? []).slice(0, 4),
              cardTitle: early.cardTitle,
            },
            { userText: text, skipAutoNav: true },
          );
        } catch {
          await speakPlanAck(early.speech);
        }
        return { ok: true };
      }
    }
  } catch (err) {
    console.warn('[module5] just-do-it handoff failed', err);
  }

  const prefPatch = inferTripPrefsFromText(text);
  if (Object.keys(prefPatch).length) void savePlanTripPrefs(prefPatch);

  // Touristen-Trip: N Tage / Stadt → Skeletons + Kalender
  try {
    const {
      parseTripStayUtterance,
      looksLikeTripStayOnly,
    } = require('../../services/trip/parseTripStay') as {
      parseTripStayUtterance: (s: string) => {
        dayCount: number;
        cityName: string | null;
        startDayKey: string;
        sourceText: string;
      } | null;
      looksLikeTripStayOnly: (s: string) => boolean;
    };
    const {
      activateTripStay,
    } = require('../../services/trip/activateTripStay') as {
      activateTripStay: (p: {
        dayCount: number;
        cityName: string | null;
        startDayKey: string;
        sourceText: string;
      }) => { ok: boolean; speechHint: string };
    };
    const stay = parseTripStayUtterance(text);
    if (stay) {
      const activated = activateTripStay(stay);
      if (activated.ok && looksLikeTripStayOnly(text)) {
        await speakPlanAck(activated.speechHint);
        return { ok: true };
      }
    }
  } catch (err) {
    console.warn('[module5] trip stay activate failed', err);
  }

  const session = usePlanSessionStore.getState();

  // Wochentag/Plan-Tag während aktiver Session → Timeline-Tag mitziehen
  if (session.active && session.plan) {
    try {
      const { normalizeTargetDate } = require('./planningLlmIngestion') as {
        normalizeTargetDate: (raw: unknown, utterance: string) => string;
      };
      const { tryResolveDateKeyFromUserText } = require('../../utils/dateKeys') as {
        tryResolveDateKeyFromUserText: (t: string) => string | null;
      };
      if (tryResolveDateKeyFromUserText(text)) {
        const nextDay = normalizeTargetDate(session.plan.targetDate, text);
        if (nextDay !== session.plan.targetDate) {
          const updated = { ...session.plan, targetDate: nextDay };
          session.setPlan(updated);
          usePlanCalendarUiStore.getState().requestDayKey(nextDay);
          useFuturePlanStore.getState().ensureDay(nextDay);
          applyMasterTimeline(updated);
        }
      }
    } catch {
      /* soft */
    }
  }

  // Aktive Session / Timeline: Edits zuerst direkt, Agent nur als Fallback
  const calOpen = usePlanCalendarUiStore.getState().calendarVisible;
  const hasStops = useFuturePlanStore.getState().plan.stops.length > 0;
  if (
    (session.active || calOpen || hasStops) &&
    (looksLikePlanEditUtterance(text) ||
      detectPlanTimeConflict(text).conflict)
  ) {
    const conflict = detectPlanTimeConflict(text);
    if (conflict.conflict && !looksLikePlanEditUtterance(text)) {
      offerConflictShortAnswers();
      await speakPlanAck(conflict.speech);
      return { ok: true };
    }
    // Sichtbaren Tag halten
    try {
      const dayKey =
        usePlanCalendarUiStore.getState().requestedDayKey ||
        useFuturePlanStore.getState().plan.dayKey;
      if (dayKey) {
        useFuturePlanStore.getState().ensureDay(dayKey);
        usePlanCalendarUiStore.getState().requestDayKey(dayKey);
      }
    } catch {
      /* soft */
    }
    // Direkter Edit vor Agent — „von 14 auf 16“ darf nicht in Re-Ingest landen
    try {
      const { applyPlanEditFromUtterance } = require('../timeline/planLiveEdits') as {
        applyPlanEditFromUtterance: (t: string) => {
          handled: boolean;
          speech: string;
        };
      };
      const direct = applyPlanEditFromUtterance(text);
      if (direct.handled) {
        if (direct.speech) await speakPlanAck(direct.speech);
        return { ok: true };
      }
    } catch {
      /* soft */
    }
    try {
      const dayKey =
        usePlanCalendarUiStore.getState().requestedDayKey ||
        useFuturePlanStore.getState().plan.dayKey;
      const result = await runPlanAgentFollowUp({
        userText: text,
        dayKey,
        event: conflict.conflict ? 'conflict' : 'edit',
        signal: input.signal,
      });
      const toolsRan = (result.toolCalls?.length ?? 0) > 0;
      if (!toolsRan) {
        try {
          const { applyPlanEditFromUtterance } = require('../timeline/planLiveEdits') as {
            applyPlanEditFromUtterance: (t: string) => {
              handled: boolean;
              speech: string;
            };
          };
          const direct = applyPlanEditFromUtterance(text);
          if (direct.handled) {
            if (direct.speech) await speakPlanAck(direct.speech);
            return { ok: true };
          }
        } catch {
          /* soft */
        }
      }
      if (result.speech) await speakPlanAck(result.speech);
      // Tag nach Agent wieder anfordern
      try {
        if (dayKey) {
          useFuturePlanStore.getState().ensureDay(dayKey);
          usePlanCalendarUiStore.getState().requestDayKey(dayKey);
        }
      } catch {
        /* soft */
      }
      return { ok: true };
    } catch (err) {
      console.warn('[module5] edit agent failed', err);
      try {
        const { applyPlanEditFromUtterance } = require('../timeline/planLiveEdits') as {
          applyPlanEditFromUtterance: (t: string) => {
            handled: boolean;
            speech: string;
          };
        };
        const direct = applyPlanEditFromUtterance(text);
        if (direct.handled) {
          await speakPlanAck(direct.speech);
          return { ok: true };
        }
      } catch {
        /* soft */
      }
    }
  }

  // Selection / Step-Loop: Picks, Neu suchen, Wunsch ändern — nie still verwerfen
  if (
    session.active &&
    (session.phase === 'step_loop' || session.phase === 'select_mode')
  ) {
    const pending = usePlanCalendarUiStore.getState().pendingChoice;
    const lower = text.toLowerCase();

    // Neuer Hotel-/Just-Do-It-Wunsch ≠ aktuelle Frühstücks-Auswahl — nicht mergen
    try {
      const { detectPitchKind } = await import('../pitch/parentBrief');
      const { looksLikeSingleJustDoItRequest } = await import(
        './planUtteranceGate'
      );
      const newKind = detectPitchKind(text);
      const pendingBlob = pending
        ? `${pending.headline ?? ''} ${pending.options.map((o) => o.title).join(' ')}`
        : '';
      const pendingKind = pendingBlob ? detectPitchKind(pendingBlob) : null;
      const hotelAsk =
        newKind === 'hotel' ||
        /\b(hotel|übernacht|uebernacht|unterkunft|zimmer)\b/i.test(text);
      const kindClash =
        hotelAsk && pendingKind != null && pendingKind !== 'hotel';
      if (
        (hotelAsk || looksLikeSingleJustDoItRequest(text)) &&
        (kindClash || hotelAsk)
      ) {
        usePlanCalendarUiStore.getState().clearPendingChoice();
        if (hotelAsk) {
          const hotelWish: IngestOpenWish = {
            id: `wish_hotel_${Date.now()}`,
            title: 'Hotel',
            priority: 4,
            context: text.slice(0, 400),
            estimatedTime: null,
            completeness: 2,
          };
          // In Plan-Queue aufnehmen (ohne Frühstück zu überschreiben)
          try {
            const plan = session.plan;
            if (plan) {
              const next = {
                ...plan,
                openWishesQueue: [
                  hotelWish,
                  ...plan.openWishesQueue.filter(
                    (w) =>
                      !/\b(hotel|übernacht|uebernacht)\b/i.test(
                        `${w.title} ${w.context}`,
                      ),
                  ),
                ],
              };
              usePlanSessionStore.getState().setPlan(next);
            }
          } catch {
            /* soft */
          }
          await speakPlanAck('Alles klar — ich such Hotels in der genannten Stadt.');
          const pitch = await executeDeepResearchAndPitch(hotelWish);
          if (pitch.spokenText?.trim()) {
            await speakPlanAck(pitch.spokenText);
          } else if (!pitch.uiCards?.length) {
            await speakPlanAck(
              'Ich finde gerade keine passenden Hotels — sag Stadt und Zeitraum nochmal klar.',
            );
          }
          return { ok: true };
        }
        // Anderes Just-Do-It: Concierge/Pitch soll übernehmen
        return { ok: false };
      }
    } catch (err) {
      console.warn('[module5] hotel interrupt failed', err);
    }

    if (
      /\b(neu\s*suchen|beides\s*nicht|andere[sn]?|nochmal)\b/i.test(text)
    ) {
      await handlePlanCalendarDirect({ kind: 'reject' });
      return { ok: true };
    }

    // Medaille / Option A/B
    if (/\b(🥇|gold|erste[rn]?|option\s*a|favorit)\b/i.test(text) && pending) {
      const title = pending.options[0]?.title;
      if (title) {
        await handlePlanCalendarDirect({ kind: 'pick', title });
        return { ok: true };
      }
    }
    if (/\b(🥈|silber|zweite[rn]?|option\s*b|alternative)\b/i.test(text) && pending) {
      const title = pending.options[1]?.title ?? pending.options[0]?.title;
      if (title) {
        await handlePlanCalendarDirect({ kind: 'pick', title });
        return { ok: true };
      }
    }

    // Ortsname aus pending / choice_* matchen
    if (pending) {
      const hit = pending.options.find((o) => {
        const name = o.title.replace(/^[🥇🥈]\s*/u, '').trim().toLowerCase();
        return name.length >= 3 && lower.includes(name.slice(0, Math.min(12, name.length)));
      });
      if (hit) {
        await handlePlanCalendarDirect({ kind: 'pick', title: hit.title });
        return { ok: true };
      }
    }

    // Freie Änderung am aktuellen Wunsch → Re-Research mit neuem Kontext
    if (pending?.stepKey) {
      const wish =
        session.plan?.openWishesQueue.find(
          (w) => w.id === pending.stepKey || w.title === pending.stepKey,
        ) ?? null;
      if (wish) {
        const amended: IngestOpenWish = {
          ...wish,
          context: `${wish.context} | Änderung: ${text}`.slice(0, 400),
        };
        void speakPlanAck('Alles klar — ich such neu.');
        void executeDeepResearchAndPitch(amended);
        return { ok: true };
      }
    }

    // Neuer Wunsch mitten im Loop
    session.setPendingAmendment(text);
    usePlanCalendarUiStore.getState().clearPendingChoice();
    void speakPlanAck('Passt — ich bau das in den Plan ein.');
    return { ok: true };
  }

  // Ingest-Lock nur für neuen Session-Start (nicht für Gates oben)
  if (running) {
    // Stuck-Lock nach 90 s freigeben
    if (runningSinceMs > 0 && Date.now() - runningSinceMs > 90_000) {
      console.warn('[module5] running lock stuck — reset');
      running = false;
      runningSinceMs = 0;
    } else if (session.active) {
      session.setPendingAmendment(text);
      void speakPlanAck('Alles klar — ist notiert.');
      return { ok: true };
    } else {
      await speakPlanAck('Einen Moment — ich bin noch beim Planen.');
      return { ok: false };
    }
  }

  running = true;
  runningSinceMs = Date.now();
  beginPlanProSession();
  try {
    // Altes SessionPlan-HUD darf die neue Timeline nicht konkurrieren
    try {
      const { useSessionPlanStore } = require('../../store/useSessionPlanStore') as {
        useSessionPlanStore: { getState: () => { setPlan: (p: null) => void } };
      };
      useSessionPlanStore.getState().setPlan(null);
    } catch {
      /* soft */
    }
    const dayHint =
      usePlanCalendarUiStore.getState().requestedDayKey ??
      useFuturePlanStore.getState().plan.dayKey ??
      null;
    resetPlanAgentChat(dayHint ?? undefined);
    const ingested = await runPlanningIngestion(text, {
      signal: input.signal,
      dayKeyHint: dayHint,
      frame: input.frame ?? null,
    });
    seedPlanAgentAfterIngest(text, ingested.bridgeSpeech || '');
    await runPlanSession(ingested);
    return { ok: true };
  } catch (err) {
    console.warn('[module5] planning failed', err);
    await speakPlanAck(
      'Da ist kurz etwas hängen geblieben — sag’s noch einmal.',
    );
    return { ok: false };
  } finally {
    running = false;
    runningSinceMs = 0;
  }
}

export function onPlanningModuleClosed(): void {
  const s = usePlanSessionStore.getState();
  if (s.waitingConfirm) s.resolveConfirm(false);
  if (s.waitingLocation) s.resolveLocation('');
  if (s.waitingConflict) s.resolveConflict(false);
  s.reset();
  endPlanProSession();
  void releasePlanningLiveChat(false);
  try {
    notePlanningSessionEnded();
  } catch {
    /* soft */
  }
}

function findWishStopAnywhere(
  stopId: string,
): { stop: import('../timeline/futurePlanState').FuturePlanStop; dayKey: string } | null {
  const store = useFuturePlanStore.getState();
  const active = store.plan.stops.find((s) => s.id === stopId);
  if (active) return { stop: active, dayKey: store.plan.dayKey };
  const requested = usePlanCalendarUiStore.getState().requestedDayKey?.trim();
  if (requested && /^\d{4}-\d{2}-\d{2}$/.test(requested)) {
    const hit = store.getPlanForDay(requested).stops.find((s) => s.id === stopId);
    if (hit) return { stop: hit, dayKey: requested };
  }
  for (const [dk, day] of Object.entries(store.plansByDay)) {
    const hit = day.stops.find((s) => s.id === stopId);
    if (hit) return { stop: hit, dayKey: dk };
  }
  return null;
}

function wishFromStop(
  stop: import('../timeline/futurePlanState').FuturePlanStop,
): IngestOpenWish {
  return {
    id: stop.id,
    title: stop.title,
    priority: (stop.planPriority === 4 ||
    stop.planPriority === 5 ||
    stop.planPriority === 6
      ? stop.planPriority
      : 5) as 4 | 5 | 6,
    context: stop.notes ?? stop.title,
    estimatedTime:
      stop.plannedStartMs != null
        ? `${String(new Date(stop.plannedStartMs).getHours()).padStart(2, '0')}:${String(new Date(stop.plannedStartMs).getMinutes()).padStart(2, '0')}`
        : null,
    completeness: 2,
  };
}

/** Instant Cover vor Analyze/Research — gleiche Härte wie Concierge-Bridge. */
export function speakOpenPlanInstantBridge(seed: string): void {
  try {
    const { pickFloskelForUserText } = require('../../services/speech/floskelEngine') as {
      pickFloskelForUserText: (s: string) => { phrase: string };
    };
    const phrase = pickFloskelForUserText(seed).phrase?.trim();
    if (!phrase) return;
    const { enqueueSpeech } = require('../speech/speechQueue') as {
      enqueueSpeech: (o: {
        kind: 'bridging' | 'main';
        text: string;
        turnId: string;
      }) => void;
    };
    enqueueSpeech({
      kind: 'bridging',
      text: phrase,
      turnId: `open_plan_bridge_${Date.now()}`,
    });
  } catch {
    /* soft */
  }
}

/** UI: User tippt offenen Plan → Override für Auto-Schleife. */
export function overrideOpenWishFromStop(stopId: string): void {
  const found = findWishStopAnywhere(stopId);
  if (!found || found.stop.kind !== 'wish') return;
  setActiveTaskOverride(wishFromStop(found.stop));
}

/**
 * Offenes Band / Wish antippen → Recherche fortsetzen (nicht löschen).
 */
export async function resumeOpenWishResearch(stopId: string, opts?: { skipBridge?: boolean }): Promise<boolean> {
  const found = findWishStopAnywhere(stopId);
  if (!found) return false;
  const { stop, dayKey } = found;
  try {
    useFuturePlanStore.getState().ensureDay(dayKey);
    usePlanCalendarUiStore.getState().requestDayKey(dayKey);
  } catch {
    /* soft */
  }

  let wish = wishFromStop(stop);
  const isHotelWish =
    /^hotel\??$/i.test(wish.title.trim()) ||
    /:hotel$/i.test(stop.id) ||
    /\b(hotel|unterkunft|hostel)\b/i.test(`${wish.title} ${wish.context}`);
  const isCarWish =
    /^mietwagen\??$/i.test(wish.title.trim()) ||
    /:car$/i.test(stop.id) ||
    /\bmietwagen\b/i.test(`${wish.title} ${wish.context}`);

  // Instant Bridge vor Research — außer UI hat schon sync Cover gefeuert.
  if (!opts?.skipBridge) {
    speakOpenPlanInstantBridge(
      isHotelWish
        ? 'Hotel Unterkunft suchen'
        : isCarWish
          ? 'Mietwagen suchen'
          : wish.title || 'Recherche',
    );
  }

  if (isHotelWish || isCarWish) {
    try {
      const { enrichOpenWishFromFlight } = require('../../services/flights/flightOpenPlanContext') as {
        enrichOpenWishFromFlight: (
          w: IngestOpenWish,
          k: 'hotel' | 'car',
        ) => IngestOpenWish;
      };
      wish = enrichOpenWishFromFlight(wish, isHotelWish ? 'hotel' : 'car');
    } catch {
      /* soft */
    }
  }

  setActiveTaskOverride(wish);

  if (isHotelWish) {
    // Filter-Chips: Hotel / Hostel / Budget — Refine ohne Blockade der Recherche.
    try {
      usePlanCalendarUiStore.getState().setShortAnswers([
        {
          id: 'open_hotel_filter_hotel',
          label: 'Hotel',
          action: 'prompt',
          prompt: 'Hotel suchen, kein Hostel',
        },
        {
          id: 'open_hotel_filter_hostel',
          label: 'Hostel',
          action: 'prompt',
          prompt: 'Hostel oder günstige Unterkunft',
        },
        {
          id: 'open_hotel_filter_budget',
          label: 'Günstig',
          action: 'prompt',
          prompt: 'Günstige Unterkunft billig Budget Spät-Check-in',
        },
      ]);
    } catch {
      /* soft */
    }
  }

  try {
    const isFlightAccess = /^ft:[^:]+:(taxiopt|oepnvopt|xferwp|xfergt)$/i.test(
      stop.id,
    );
    if (isFlightAccess) {
      const { resumeFlightAccessWish } = require('../../services/flights/flightTimeline') as {
        resumeFlightAccessWish: (id: string) => Promise<boolean>;
      };
      await resumeFlightAccessWish(stop.id);
      setActiveTaskOverride(null);
      return true;
    }
    usePlanSessionStore.getState().setActive(true);
    const { resolveCityChatScope } = require('../context/placeContext') as {
      resolveCityChatScope: (t?: string | null) => {
        cityKey: string;
        cityHint: string | null;
      };
    };
    const { tagPlanSessionCity } = require('./planSessionState') as {
      tagPlanSessionCity: (o: {
        cityKey?: string | null;
        cityHint?: string | null;
      }) => void;
    };
    let scope = resolveCityChatScope(wish.title || wish.context);
    if (isHotelWish || isCarWish) {
      try {
        const { flightDestCityForOpenPlan } = require('../../services/flights/flightOpenPlanContext') as {
          flightDestCityForOpenPlan: () => string | null;
        };
        const dest = flightDestCityForOpenPlan()?.trim();
        if (dest) {
          scope = { cityKey: dest.toLowerCase(), cityHint: dest };
        }
      } catch {
        /* soft */
      }
    }
    tagPlanSessionCity({
      cityKey: scope.cityKey,
      cityHint: scope.cityHint,
    });
  } catch {
    /* soft */
  }
  usePlanSessionStore.getState().setPhase('select_mode');

  if (isExploreWish(wish)) {
    const { executeExploreWishInsert, parseWishFreeHours } = await import(
      './planPlacesResearch'
    );
    const m = wish.estimatedTime?.match(/^(\d{1,2}):/);
    const startH = m ? Number(m[1]) : 10;
    const result = await executeExploreWishInsert(wish, {
      dayKey,
      fixedCount: useFuturePlanStore
        .getState()
        .getPlanForDay(dayKey)
        .stops.filter((s) => s.kind === 'stop' && s.hardAnchor).length,
      freeHoursHint:
        parseWishFreeHours(wish) ?? Math.max(2, Math.min(6, 20 - startH)),
    });
    const { enqueueSpeech } = await import('../speech/speechQueue');
    enqueueSpeech({
      kind: 'main',
      text: result.spokenText,
      turnId: `m5_explore_${Date.now()}`,
    });
    return true;
  }

  const pitch = await executeDeepResearchAndPitch(wish);
  const { enqueueSpeech } = await import('../speech/speechQueue');
  enqueueSpeech({
    kind: 'main',
    text:
      pitch.spokenText ||
      `Zwei Optionen für ${wish.title} — was ist dein Favorit?`,
    turnId: `m5_resume_${Date.now()}`,
  });
  return true;
}

function clearChoiceStops(groupId?: string | null): void {
  const stops = [...useFuturePlanStore.getState().plan.stops];
  for (const s of stops) {
    if (!s.id.startsWith('choice_')) continue;
    if (
      !groupId ||
      s.choiceGroupId === groupId ||
      s.planTaskId === groupId
    ) {
      useFuturePlanStore.getState().removeStop(s.id);
    }
  }
}

/** Location-Gate aus Short-Answer (Tennisclub-Vorschlag o.ä.). */
export function resolvePlanLocationInput(text: string): { ok: boolean } {
  try {
    usePlanCalendarUiStore.getState().touchPlanInteraction();
  } catch {
    /* soft */
  }
  const session = usePlanSessionStore.getState();
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return { ok: false };
  if (session.waitingLocation) {
    session.resolveLocation(t);
    return { ok: true };
  }
  void runPlanningModule({ userText: t });
  return { ok: true };
}

/** UI Short-Answer Direct (Confirm / Pick / Reject=Neu suchen). */
export async function handlePlanCalendarDirect(input: {
  kind: 'accept' | 'reject' | 'pick' | 'confirm';
  title?: string;
  stopId?: string;
}): Promise<boolean> {
  const session = usePlanSessionStore.getState();
  if (input.kind === 'confirm' || input.kind === 'accept') {
    if (session.waitingConflict) {
      session.resolveConflict(true);
      return true;
    }
    if (session.waitingConfirm) {
      session.resolveConfirm(true);
      return true;
    }
    usePlanCalendarUiStore.getState().clearPendingChoice();
    usePlanCalendarUiStore.getState().clearShortAnswers();
    return true;
  }
  if (input.kind === 'reject') {
    if (session.waitingConflict) {
      session.resolveConflict(false);
      return true;
    }
    // Während Confirm: „Ändern“ → negativ auflösen (Orchestrator holt Amendment)
    if (session.waitingConfirm) {
      // Nur „Ändern“ tippen → nächste Runde fragt nach dem Inhalt
      session.setPendingAmendment(null);
      session.resolveConfirm(false);
      return true;
    }
    // „Neu suchen“ → Re-Research aktueller Wunsch
    const pending = usePlanCalendarUiStore.getState().pendingChoice;
    const stepKey = pending?.stepKey;
    clearChoiceStops(stepKey);
    usePlanCalendarUiStore.getState().clearPendingChoice();
    usePlanCalendarUiStore.getState().clearShortAnswers();
    usePlanCalendarUiStore.getState().clearMirroredActions();

    const wishStop = stepKey
      ? useFuturePlanStore.getState().plan.stops.find((s) => s.id === stepKey)
      : null;
    const sessionWish = usePlanSessionStore.getState().plan?.openWishesQueue.find(
      (w) => w.id === stepKey || w.title === stepKey,
    );
    const wish: IngestOpenWish | null = sessionWish
      ? sessionWish
      : wishStop
        ? {
            id: wishStop.id,
            title: wishStop.title,
            priority: (wishStop.planPriority === 4 ||
            wishStop.planPriority === 5 ||
            wishStop.planPriority === 6
              ? wishStop.planPriority
              : 5) as 4 | 5 | 6,
            context: wishStop.notes ?? wishStop.title,
            estimatedTime: null,
          }
        : null;
    if (wish) {
      void executeDeepResearchAndPitch(wish);
    }
    return true;
  }

  if (input.kind === 'pick' && input.title) {
    const pending = usePlanCalendarUiStore.getState().pendingChoice;
    const dayKey = useFuturePlanStore.getState().plan.dayKey;
    const cleanTitle = input.title
      .replace(/^[🥇🥈❓]\s*/u, '')
      .replace(/^👉\s*/u, '')
      .trim();

    // Prefer matching choice_* stop from timeline tap
    const choiceStop =
      (input.stopId
        ? useFuturePlanStore
            .getState()
            .plan.stops.find((s) => s.id === input.stopId)
        : null) ??
      useFuturePlanStore.getState().plan.stops.find(
        (s) =>
          s.id.startsWith('choice_') &&
          s.title.replace(/^[🥇🥈]\s*/u, '').trim().toLowerCase() ===
            cleanTitle.toLowerCase(),
      ) ??
      useFuturePlanStore.getState().plan.stops.find(
        (s) =>
          s.id.startsWith('choice_') &&
          s.title.toLowerCase().includes(cleanTitle.toLowerCase()),
      );

    const opt = pending?.options.find((o) =>
      o.title.toLowerCase().includes(cleanTitle.toLowerCase()),
    );

    const lat = choiceStop?.lat ?? opt?.lat;
    const lng = choiceStop?.lng ?? opt?.lng;
    if (lat == null || lng == null) return false;

    const groupId =
      choiceStop?.choiceGroupId ??
      choiceStop?.planTaskId ??
      pending?.stepKey ??
      null;
    const committedId = `stop_${groupId ?? 'pick'}_${Date.now()}`;
    const startMs = choiceStop?.plannedStartMs ?? pending?.anchorTimeMs ?? null;
    const isHotelPick = /\b(hotel|bude|hostel|pension|motel|inn\b|superbude)\b/i.test(
      cleanTitle,
    );

    useFuturePlanStore.getState().upsertStopOnDay(dayKey, {
      id: committedId,
      title: cleanTitle,
      lat,
      lng,
      plannedStartMs: startMs,
      plannedEndMs:
        isHotelPick || startMs == null ? null : startMs + 60 * 60_000,
      bufferMin: 10,
      transport: 'walk',
      kind: 'stop',
      status: 'planned',
      planPriority: 4,
      mapsUrl: choiceStop?.mapsUrl ?? opt?.mapsUrl ?? null,
      menuUrl: choiceStop?.menuUrl ?? opt?.menuUrl ?? null,
      reserveUrl:
        choiceStop?.reserveUrl ??
        (/friseur|haar|salon|barber/i.test(cleanTitle)
          ? `https://www.google.com/search?q=${encodeURIComponent(`${cleanTitle} Termin buchen`)}`
          : /essen|restaurant|burger|pizza|café|cafe|osteria|trattoria/i.test(
                cleanTitle,
              )
            ? `https://www.google.com/search?q=${encodeURIComponent(`${cleanTitle} Tisch reservieren`)}`
            : null),
      notes: choiceStop?.notes,
      emoji: '📍',
      planTaskId: groupId,
      userFixedTime: false,
    });

    clearChoiceStops(groupId);
    if (groupId) {
      try {
        useFuturePlanStore.getState().removeStop(groupId);
      } catch {
        /* soft */
      }
    }

    usePlanCalendarUiStore.getState().clearPendingChoice();
    usePlanCalendarUiStore.getState().clearShortAnswers();
    usePlanCalendarUiStore.getState().clearMirroredActions();

    try {
      applyGapFillTravelLegs();
    } catch {
      /* soft */
    }

    const wish: IngestOpenWish = {
      id: groupId ?? committedId,
      title: cleanTitle,
      priority: 4,
      context: cleanTitle,
      estimatedTime: null,
    };

    const isHotel = isHotelPick;

    if (isHotel) {
      try {
        const {
          parseHotelAdults,
          defaultHotelStayWindow,
        } = require('../../services/concierge/hotelAvailabilityService') as {
          parseHotelAdults: (t: string) => number;
          defaultHotelStayWindow: () => { checkin: string; checkout: string };
        };
        const { parseHotelStayDatesForPlan } = require('./planStayDates') as {
          parseHotelStayDatesForPlan: (
            blob: string,
            dayKey?: string | null,
          ) => { checkin: string; checkout: string };
        };
        const ctxBlob = [
          pending?.headline,
          choiceStop?.notes,
          usePlanSessionStore.getState().plan?.openWishesQueue
            .map((w) => `${w.title} ${w.context}`)
            .join(' '),
        ]
          .filter(Boolean)
          .join(' | ');
        const dates = parseHotelStayDatesForPlan(
          `${ctxBlob} ${cleanTitle}`,
          dayKey,
        );
        const win =
          dates.checkin && dates.checkout
            ? dates
            : defaultHotelStayWindow();
        const adults = parseHotelAdults(ctxBlob) || 2;
        const liveBook =
          (choiceStop?.menuUrl?.trim() &&
          /^https?:\/\//i.test(choiceStop.menuUrl) &&
          !/google\.[^/]+\/search/i.test(choiceStop.menuUrl)
            ? choiceStop.menuUrl
            : null) ||
          (choiceStop?.reserveUrl?.trim() &&
          /^https?:\/\//i.test(choiceStop.reserveUrl)
            ? choiceStop.reserveUrl
            : null) ||
          (opt?.menuUrl?.trim() && /^https?:\/\//i.test(opt.menuUrl)
            ? opt.menuUrl
            : null);
        const cityHint =
          (() => {
            try {
              const { extractCityFromText } = require('../context/shortTermContext') as {
                extractCityFromText: (t: string) => string | null;
              };
              return extractCityFromText(ctxBlob);
            } catch {
              return null;
            }
          })() || null;
        const { finalizeHotelBookAffiliateUrl } = require('../../services/affiliate/hotelPropertyDeepLink') as {
          finalizeHotelBookAffiliateUrl: (o: {
            hotelName: string;
            city?: string | null;
            bookUrl?: string | null;
            checkin: string;
            checkout: string;
            adults?: number;
          }) => string;
        };
        const bookUrl = finalizeHotelBookAffiliateUrl({
          hotelName: cleanTitle,
          city: cityHint,
          bookUrl: liveBook,
          checkin: win.checkin,
          checkout: win.checkout,
          adults,
        });

        // Async: Property-Deep-Link nachziehen (Expedia Zimmer-Seite)
        void (async () => {
          try {
            const { resolveHotelPropertyAffiliateUrl } = await import(
              '../../services/affiliate/hotelPropertyDeepLink'
            );
            const deep = await resolveHotelPropertyAffiliateUrl({
              hotelName: cleanTitle,
              city: cityHint,
              bookUrl: liveBook,
              checkin: win.checkin,
              checkout: win.checkout,
              adults,
            });
            if (deep && deep !== bookUrl) {
              usePlanCalendarUiStore.getState().setMirroredActions([
                {
                  type: 'OPEN_URL',
                  label: '🏨 Zimmer buchen',
                  payload: {
                    url: deep,
                    destName: cleanTitle,
                    destination: cityHint || cleanTitle,
                    checkin: win.checkin,
                    checkout: win.checkout,
                    adults,
                  },
                },
              ]);
            }
          } catch {
            /* soft */
          }
        })();

        useFuturePlanStore.getState().setDayBase(dayKey, {
          label: cleanTitle.slice(0, 48),
          kind: 'hotel',
          lat: lat ?? undefined,
          lng: lng ?? undefined,
        });

        const { enqueueSpeech } = require('../speech/speechQueue') as {
          enqueueSpeech: (o: {
            kind: string;
            text: string;
            turnId: string;
          }) => void;
        };

        usePlanCalendarUiStore.getState().setMirroredActions([
          {
            type: 'OPEN_URL',
            label: '🏨 Zimmer buchen',
            payload: {
              url: bookUrl,
              destName: cleanTitle,
              destination: cityHint || cleanTitle,
              checkin: win.checkin,
              checkout: win.checkout,
              adults,
            },
          },
        ]);

        const hour = new Date().getHours();
        const checkinHint =
          hour < 15
            ? 'Check-in ab 15 Uhr ist üblich — trage ich so ein, wenn du willst.'
            : 'Check-in kann flexibel sein — ich lege ihn sinnvoll in deinen Tag.';

        enqueueSpeech({
          kind: 'main',
          text: `${cleanTitle} ist drin. Oben siehst du den Partner-Link — Zeitraum ist vorausgefüllt, du bestätigst nur noch. ${checkinHint} Möchtest du jetzt buchen?`,
          turnId: `hotel_pick_${Date.now()}`,
        });
      } catch (err) {
        console.warn('[plan] hotel pick CTA failed', err);
      }
    }

    void injectNavigationNode(wish, committedId).then(() => {
      try {
        applyGapFillTravelLegs();
      } catch {
        /* soft */
      }
    });

    return true;
  }
  return false;
}
