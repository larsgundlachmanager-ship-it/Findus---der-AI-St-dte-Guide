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
} from './planSessionOrchestrator';
import {
  isPlanningModuleActive,
  usePlanSessionStore,
} from './planSessionState';
import { usePlanCalendarUiStore } from '../timeline/planCalendarUiStore';
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

export { isPlanningModuleActive } from './planSessionState';
export { MASTER_INGEST_SYSTEM } from './planningLlmIngestion';
export { DEEP_RESEARCH_SYSTEM } from './planPlacesResearch';
export { calculateNavigation } from './planMobilityEngine';
export { runFinalTimelineOptimization } from './planConflictResolve';
export { runPlanSession } from './planSessionOrchestrator';

let running = false;
let runningSinceMs = 0;

async function speakPlanAck(text: string): Promise<void> {
  try {
    const { enqueueSpeech } = await import('../speech/speechQueue');
    enqueueSpeech({
      kind: 'main',
      text,
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
}): Promise<{ ok: boolean }> {
  const text = (input.userText ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return { ok: false };

  // Guard: Final-Action-Labels nie als neuen Planungs-Ingest
  if (FINAL_ACTION_RE.test(text)) {
    await handleFinalPlanAction(text);
    return { ok: true };
  }

  const session = usePlanSessionStore.getState();

  // Conflict-Ask (Prio 5/3 löschen?): Ja → drop; Nein/Ändern → behalten
  if (session.waitingConflict) {
    const yes =
      /\b(ja|jo|ok|okay|klar|raus|weg|lösch|loesch|passt)\b/i.test(text) &&
      !/\b(nein|nicht|behalten|lass)\b/i.test(text);
    session.resolveConflict(yes);
    return { ok: true };
  }

  // Confirm-Gate: Ja → weiter; alles andere = Änderung annehmen
  if (session.waitingConfirm) {
    const yes =
      /\b(ja|jo|passt|ok|okay|klar|mach|los|perfekt|genau|bestätig|bestaetig)\b/i.test(
        text,
      ) && !/\b(änder|aender|nein|nicht)\b/i.test(text);
    if (yes) {
      session.resolveConfirm(true);
      return { ok: true };
    }
    // Änderung / Ablehnung: Text merken und Confirm negativ auflösen
    session.setPendingAmendment(text);
    session.resolveConfirm(false);
    return { ok: true };
  }

  // Location-Gate
  if (session.waitingLocation) {
    session.resolveLocation(text);
    return { ok: true };
  }

  // Selection / Step-Loop: Picks, Neu suchen, Wunsch ändern — nie still verwerfen
  if (
    session.active &&
    (session.phase === 'step_loop' || session.phase === 'select_mode')
  ) {
    const pending = usePlanCalendarUiStore.getState().pendingChoice;
    const lower = text.toLowerCase();

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
  try {
    const dayHint =
      usePlanCalendarUiStore.getState().requestedDayKey ??
      useFuturePlanStore.getState().plan.dayKey ??
      null;
    const ingested = await runPlanningIngestion(text, {
      signal: input.signal,
      dayKeyHint: dayHint,
    });
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
  try {
    notePlanningSessionEnded();
  } catch {
    /* soft */
  }
}

/** UI: User tippt offenen Plan → Override für Auto-Schleife. */
export function overrideOpenWishFromStop(stopId: string): void {
  const stop = useFuturePlanStore
    .getState()
    .plan.stops.find((s) => s.id === stopId);
  if (!stop || stop.kind !== 'wish') return;
  const wish: IngestOpenWish = {
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
  };
  setActiveTaskOverride(wish);
}

/**
 * Offenes Band / Wish antippen → Recherche fortsetzen (nicht löschen).
 */
export async function resumeOpenWishResearch(stopId: string): Promise<boolean> {
  const stop = useFuturePlanStore
    .getState()
    .plan.stops.find((s) => s.id === stopId);
  if (!stop) return false;
  const wish: IngestOpenWish = {
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
  setActiveTaskOverride(wish);
  usePlanSessionStore.getState().setActive(true);
  usePlanSessionStore.getState().setPhase('select_mode');

  if (isExploreWish(wish)) {
    const { executeExploreWishInsert, parseWishFreeHours } = await import(
      './planPlacesResearch'
    );
    const dayKey = useFuturePlanStore.getState().plan.dayKey;
    const m = wish.estimatedTime?.match(/^(\d{1,2}):/);
    const startH = m ? Number(m[1]) : 10;
    const result = await executeExploreWishInsert(wish, {
      dayKey,
      fixedCount: useFuturePlanStore
        .getState()
        .plan.stops.filter((s) => s.kind === 'stop' && s.hardAnchor).length,
      freeHoursHint:
        parseWishFreeHours(wish) ?? Math.max(2, Math.min(6, 17 - startH)),
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

    useFuturePlanStore.getState().upsertStopOnDay(dayKey, {
      id: committedId,
      title: cleanTitle,
      lat,
      lng,
      plannedStartMs: startMs,
      plannedEndMs: startMs != null ? startMs + 60 * 60_000 : null,
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
      userFixedTime: Boolean(startMs),
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

    const isHotel = /\b(hotel|bude|hostel|pension|motel|inn\b|superbude)\b/i.test(
      cleanTitle,
    );

    if (isHotel) {
      try {
        const {
          getExpediaAccommodationUrl,
          getStay22AccommodationUrl,
          getExpediaCamref,
        } = require('../../services/affiliate/affiliateService') as {
          getExpediaAccommodationUrl: (
            d: string,
            o?: { checkin?: string; checkout?: string; adults?: number },
          ) => string;
          getStay22AccommodationUrl: (
            d: string,
            o?: { checkin?: string; checkout?: string; adults?: number },
          ) => string;
          getExpediaCamref: () => string;
        };
        const {
          parseHotelStayDates,
          parseHotelAdults,
          defaultHotelStayWindow,
        } = require('../../services/concierge/hotelAvailabilityService') as {
          parseHotelStayDates: (t: string) => {
            checkin: string;
            checkout: string;
          };
          parseHotelAdults: (t: string) => number;
          defaultHotelStayWindow: () => { checkin: string; checkout: string };
        };
        const { enqueueSpeech } = require('../speech/speechQueue') as {
          enqueueSpeech: (o: {
            kind: string;
            text: string;
            turnId: string;
          }) => void;
        };
        const dates = parseHotelStayDates(cleanTitle);
        const win =
          dates.checkin && dates.checkout
            ? dates
            : defaultHotelStayWindow();
        const adults = parseHotelAdults(cleanTitle) || 2;
        const bookUrl = getExpediaCamref()
          ? getExpediaAccommodationUrl(cleanTitle, {
              checkin: win.checkin,
              checkout: win.checkout,
              adults,
            })
          : getStay22AccommodationUrl(cleanTitle, {
              checkin: win.checkin,
              checkout: win.checkout,
              adults,
            });

        usePlanCalendarUiStore.getState().setMirroredActions([
          {
            type: 'OPEN_URL',
            label: '🏨 Zimmer buchen',
            payload: { url: bookUrl, destination: cleanTitle },
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
