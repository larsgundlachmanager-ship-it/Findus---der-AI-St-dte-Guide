/**
 * Modul 5 — Masterplan-Orchestrator.
 * 1) Kurze Bridge (Fakten: Los/Ziel) + Timeline-Gerüst
 * 2) Step-Pitches: Frühstück → Abend/Sunset → Landmarke/Ticket
 * 3) Nach jeder Auswahl Route, dann automatisch der nächste Punkt
 * 4) Tour in der Lücke, dann Routes + Final
 */

import { enqueueSpeech } from '../speech/speechQueue';
import {
  requestOpenPlanCalendar,
  usePlanCalendarUiStore,
} from '../timeline/planCalendarUiStore';
import {
  useFuturePlanStore,
  type FuturePlanStop,
  type FuturePlanTransport,
} from '../timeline/futurePlanState';
import { applyGapFillTravelLegs } from '../timeline/gapFillTravel';
import { readRucksackSync, anchorCoords } from '../rucksack/rucksackStore';
import {
  getActiveTaskOverride,
  usePlanSessionStore,
} from './planSessionState';
import type {
  IngestedPlan,
  IngestFixedNode,
  IngestGeoAnchor,
  IngestOpenWish,
  PlanNavNode,
} from './planningTypes';
import {
  derivePlanTasks,
  runPlanningIngestion,
} from './planningLlmIngestion';
import {
  executeDeepResearchAndPitch,
  executeLandmarkQaBrief,
  isExploreWish,
  isHotelWishText,
  isPlanLandmarkQaWish,
  isPlanPitchWish,
  parseWishFreeHours,
  triggerAsyncDeepResearch,
} from './planPlacesResearch';
import { isBreakfastWish, isGenericDayStartWish, isTravelToDestWish } from './planDestinationCity';
import { calculateNavigation } from './planMobilityEngine';
import { runFinalTimelineOptimization } from './planConflictResolve';
import { sanitizePlanSpeech, humanizePlanTitle } from './planSpeechSanitize';
import { pitchWalkRank } from './planWalkOrder';
import {
  canMergeBreakfastIntoCafe,
  enrichWishWithPrefs,
  isVaguePartyWish,
  mergeBreakfastShortAnswers,
  partyClarifyShortAnswers,
} from './planClarify';
import { isConcreteAppointmentTitle, isVagueSportVenueLocation } from './planLocationGranularity';
import { durationMinFromHmRange, parseHmRangeFromText } from './planTimeRange';
import {
  clampToFutureMs,
  isPastMs,
} from '../timeline/planNowGuard';
import { todayDateKey, offsetDateKey, tryResolveDateKeyFromUserText } from '../../utils/dateKeys';
import { getCachedUserProfile } from '../../services/userProfileService';
import {
  suggestTennisClubsInCity,
  cityFromPlanBlob,
} from './planTennisVenueResearch';
import { hotelCheckInMs, isHotelPlanBlob } from './planHotelTiming';
import {
  dayBoundsMs,
  findFreeSlotStartMs,
  hardIntervalsFromStops,
  msToHmLabel,
} from './planHardLock';

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Eine TTS-Session-ID pro User-Turn — keine neuen Jobs, die sich mittendrin abwürgen. */
let planSpeakTurnId = `m5_${Date.now()}`;

function beginPlanSpeakTurn(): void {
  planSpeakTurnId = `m5_${Date.now()}`;
}

/** Hotel „nahe Tennis“ ohne Club-Namen → Rückfrage. */
function needsVagueTennisVenueClarify(wish: IngestOpenWish): boolean {
  const blob = `${wish.title} ${wish.context}`;
  if (!/\btennis/i.test(blob)) return false;
  if (!/\b(nahe|nähe|neben|bei|am)\b/i.test(blob)) return false;
  if (/\btennisclub:\s*\S+/i.test(blob)) return false;
  if (/\b(phoenix(?:\s+club)?|tc\s+[A-Za-zÄÖÜäöüß]+|tennisclub\s+[A-Za-zÄÖÜäöüß])/i.test(blob)) {
    return false;
  }
  return true;
}

function speak(text: string): void {
  if (usePlanSessionStore.getState().phase === 'idle') return;
  const t = sanitizePlanSpeech((text ?? '').replace(/\s+/g, ' ').trim());
  if (!t) return;
  enqueueSpeech({
    kind: 'main',
    text: t,
    turnId: planSpeakTurnId,
  });
}

function openPlanCalendarModal(targetDate: string): void {
  // Immer sichtbar — nie headless „Zusammenfassung ohne Timeline“
  usePlanCalendarUiStore.getState().setHeadlessPlanning(false);
  useFuturePlanStore.getState().ensureDay(targetDate);
  usePlanCalendarUiStore.getState().requestDayKey(targetDate);
  requestOpenPlanCalendar();
  // Nach Open nochmal Tag setzen — sonst gewinnt ein paralleles ensureDay(heute/…)
  const reassert = () => {
    try {
      usePlanCalendarUiStore.getState().setHeadlessPlanning(false);
      useFuturePlanStore.getState().ensureDay(targetDate);
      usePlanCalendarUiStore.getState().requestDayKey(targetDate);
      if (!usePlanCalendarUiStore.getState().calendarVisible) {
        requestOpenPlanCalendar();
      }
    } catch {
      /* soft */
    }
  };
  setTimeout(reassert, 80);
  setTimeout(reassert, 280);
}

export function parseTimeToMs(dayKey: string, time: string | null | undefined): number | null {
  if (!time) return null;
  const m = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [y, mo, d] = dayKey.split('-').map(Number);
  const dt = new Date(y!, mo! - 1, d!, Number(m[1]), Number(m[2]), 0, 0);
  return dt.getTime();
}

function clearPlanningArtifactsOnDay(dayKey: string, lageMode: IngestedPlan['lageMode']): void {
  const plan = useFuturePlanStore.getState().getPlanForDay(dayKey);
  for (const s of [...plan.stops]) {
    if (s.id.startsWith('choice_')) {
      useFuturePlanStore.getState().removeStop(s.id);
      continue;
    }
    // Neu planen: Soft/Wünsche/Explore raus — feste User-Termine (fix_*/hard) bleiben
    if (lageMode === 'new') {
      const hard =
        s.hardAnchor ||
        s.userFixedTime ||
        (s.planPriority != null && s.planPriority <= 2) ||
        (s.id.startsWith('fix_') && Boolean(s.plannedStartMs));
      if (hard) continue;
      if (
        s.kind === 'wish' ||
        s.id.startsWith('wish_') ||
        s.id.startsWith('anchor_') ||
        s.id.startsWith('explore_') ||
        s.id.startsWith('nav_') ||
        (s.planPriority != null && s.planPriority >= 4)
      ) {
        useFuturePlanStore.getState().removeStop(s.id);
      }
    }
  }
}

function insertGeoAnchor(
  anchor: IngestGeoAnchor,
  dayKey: string,
  destCity?: string | null,
): void {
  const bag = readRucksackSync();
  const gps = anchorCoords(bag);
  const lat = anchor.lat ?? gps.lat;
  const lng = anchor.lng ?? gps.lng;
  const isToday = dayKey === todayDateKey();
  const dest = (destCity || '').trim();
  const rawName = (anchor.name || '').trim();
  const genericName =
    !rawName || /^(start|basis|hier|gps|aktuell)\b/i.test(rawName);
  const labelRaw =
    dest && (genericName || !isToday)
      ? dest
      : rawName || (isToday ? 'Hier' : dest || 'Basis');
  // Zukunftstag ohne Zielstadt und ohne Unterkunft → „?“ (Hotel noch offen)
  const label =
    !isToday &&
    !dest &&
    anchor.type !== 'HOTEL_START' &&
    !/hotel|pension|ferien/i.test(labelRaw)
      ? `${labelRaw.replace(/\s*\?\s*$/, '')} ?`.slice(0, 48)
      : labelRaw.replace(/\s*\?\s*$/, '').slice(0, 48);
  const kind =
    anchor.type === 'HOTEL_START'
      ? 'hotel'
      : isToday
        ? 'gps'
        : /hotel|pension|ferien/i.test(label)
          ? 'hotel'
          : 'home';

  // Basis oben in der UI — kein Fake-„08:00 Hamburg-Start“ als Timeline-Stop
  useFuturePlanStore.getState().setDayBase(dayKey, {
    label,
    kind: kind as 'home' | 'hotel' | 'gps' | 'other',
    lat,
    lng,
  });

  // Zukunfts-Tag: aktuelle Position zusätzlich anzeigen (echter Ortsname, kein „Basis jetzt: Basis jetzt“)
  if (!isToday) {
    const bagNow = readRucksackSync();
    const gpsNow = anchorCoords(bagNow);
    const hereLabel =
      (bagNow.cityHint && String(bagNow.cityHint).trim()) ||
      'Hier';
    useFuturePlanStore.getState().setDayOriginBase(dayKey, {
      label: hereLabel.slice(0, 48),
      kind: 'gps',
      lat: gpsNow.lat,
      lng: gpsNow.lng,
    });
  }

  // Alte Anker-Stops entfernen (Legacy)
  for (const s of [...useFuturePlanStore.getState().getPlanForDay(dayKey).stops]) {
    if (s.id.startsWith('anchor_')) {
      useFuturePlanStore.getState().removeStop(s.id);
    }
  }

  // Nur HEUTE: weicher GPS-Start nahe jetzt (für Gap-Fill / Anreise)
  if (!isToday) return;

  const startMs =
    clampToFutureMs(Date.now(), {
      nowMs: Date.now(),
      minAheadMs: 20 * 60_000,
    }) ?? Date.now() + 20 * 60_000;
  const stop: FuturePlanStop = {
    id: `anchor_${dayKey}_start`,
    title: label.slice(0, 48),
    lat,
    lng,
    plannedStartMs: startMs,
    plannedEndMs: startMs + 15 * 60_000,
    bufferMin: 5,
    transport: 'walk',
    hardAnchor: true,
    userFixedTime: false,
    kind: 'stop',
    status: 'planned',
    planPriority: 1,
    notes: 'Start (aktuell)',
    emoji: '🏁',
  };
  useFuturePlanStore.getState().upsertStopOnDay(dayKey, stop);
}

function insertTimeline(fixedNodes: IngestFixedNode[], dayKey: string): void {
  const today = todayDateKey();
  // Vergangenheitstage nie befüllen — auf heute umbiegen
  const effectiveDay = dayKey < today ? today : dayKey;
  for (const n of fixedNodes) {
    // Feste Termine: Zeit exakt wie User/LLM — nie clampToFuture (13:00≠14:00)
    const startMs = parseTimeToMs(effectiveDay, n.time);
    if (effectiveDay < today) continue;
    const id = `fix_${effectiveDay}_${n.title.replace(/\W+/g, '_').slice(0, 24)}_${n.priority}`;
    const hotelFix = isHotelPlanBlob(`${n.title} ${n.location ?? ''} ${n.address ?? ''}`);
    const durMin = hotelFix
      ? null
      : durationMinFromHmRange(n.time, n.endTime) ??
        (n.priority <= 2 ? 60 : 60);
    const stop: FuturePlanStop = {
      id,
      title: (humanizePlanTitle(n.title) || n.title).slice(0, 48),
      // Keine Fake-GPS-Koordinaten — sonst rechnen Routen zum falschen Ort
      lat: typeof n.lat === 'number' ? n.lat : undefined,
      lng: typeof n.lng === 'number' ? n.lng : undefined,
      plannedStartMs: startMs,
      // Hotel = nur Check-in-Punkt, kein 18–19-Band
      plannedEndMs:
        hotelFix || startMs == null || durMin == null
          ? null
          : startMs + durMin * 60_000,
      bufferMin: n.priority === 1 ? 15 : 10,
      transport: 'walk',
      hardAnchor: n.priority <= 2 && !n.needsClarification,
      userFixedTime: Boolean(n.time) || n.priority <= 2,
      kind: 'stop',
      status: n.needsClarification ? 'pending_change' : 'planned',
      planPriority: n.priority,
      notes: hotelFix
        ? [n.location || n.address, 'Check-in'].filter(Boolean).join(' · ')
        : n.location || n.address || undefined,
      emoji: hotelFix ? '🏨' : n.priority === 1 ? '📌' : '📍',
      planTaskId: id,
    };
    useFuturePlanStore.getState().upsertStopOnDay(effectiveDay, stop);
  }
}

/**
 * Offene Wünsche MIT Zeit → blaue Bänder auf der Achse (kind wish + plannedStartMs).
 */
function insertOpenBands(wishes: IngestOpenWish[], dayKey: string): void {
  const nowMs = Date.now();
  const isToday = dayKey === todayDateKey();
  const bounds = dayBoundsMs(dayKey);
  wishes.forEach((w, i) => {
    const id = w.id ?? `wish_${dayKey}_${i}`;
    let startMs = parseTimeToMs(dayKey, w.estimatedTime ?? null);
    const hotelBand = isHotelPlanBlob(`${w.title} ${w.context}`);
    if (startMs == null && hotelBand) {
      const stops = useFuturePlanStore.getState().getPlanForDay(dayKey).stops;
      startMs = hotelCheckInMs(w, dayKey, stops);
    }
    // Soft-Wünsche: um feste Termine herum legen (Mittag ≠ Bewerbungsgespräch)
    if (!hotelBand) {
      const dayStops = useFuturePlanStore.getState().getPlanForDay(dayKey).stops;
      const hard = hardIntervalsFromStops(dayStops);
      const durMin =
        durationMinFromHmRange(w.estimatedTime, w.endTime) ?? 45;
      const free = findFreeSlotStartMs({
        preferredStartMs: startMs,
        durationMs: durMin * 60_000,
        hardIntervals: hard,
        dayStartMs: bounds.start,
        dayEndMs: bounds.end,
        nowFloorMs: isToday ? nowMs + 15 * 60_000 : bounds.start,
      });
      if (free != null) startMs = free;
    } else if (isToday && startMs != null && isPastMs(startMs, nowMs)) {
      startMs = clampToFutureMs(startMs, { nowMs, minAheadMs: 25 * 60_000 });
    }
    const durMin =
      !hotelBand && w.endTime
        ? durationMinFromHmRange(w.estimatedTime, w.endTime)
        : hotelBand
          ? null
          : durationMinFromHmRange(w.estimatedTime, w.endTime) ?? 45;
    // Nur echte User-Fixzeiten (Prio ≤2) — LLM-Schätzzeit für Soft ≠ userFixed
    const softFixed = w.priority <= 2 && Boolean(w.estimatedTime);
    const stop: FuturePlanStop = {
      id,
      title: (humanizePlanTitle(w.title) || w.title || 'Offener Punkt').slice(0, 48),
      lat: w.lat ?? undefined,
      lng: w.lng ?? undefined,
      plannedStartMs: startMs,
      plannedEndMs:
        hotelBand || durMin == null || startMs == null
          ? null
          : startMs + durMin * 60_000,
      bufferMin: 5,
      transport: 'unknown',
      kind: 'wish',
      status: 'pending_change',
      planPriority: w.priority,
      openOrder: w.priority === 6 ? 900 + i : i,
      notes:
        startMs != null && w.estimatedTime && msToHmLabel(startMs) !== w.estimatedTime
          ? [w.context, `Slot ${msToHmLabel(startMs)} (um Fixtermine)`]
              .filter(Boolean)
              .join('\n')
          : w.context,
      emoji: w.priority === 6 ? '✨' : '🔵',
      userFixedTime: softFixed,
      planTaskId: id,
    };
    useFuturePlanStore.getState().upsertStopOnDay(dayKey, stop);
  });
}

function dayHintFromBlob(blob: string): 'today' | 'tomorrow' | 'overmorrow' {
  if (/\b(übermorgen|uebermorgen)\b/i.test(blob)) return 'overmorrow';
  // „Guten Morgen“ / „heute Morgen“ ≠ Plan-Tag morgen
  if (/\bguten\s+morgen\b/i.test(blob) || /\bheut(?:e)?\s+morgen\b/i.test(blob)) {
    return 'today';
  }
  if (/\bmorgen\b/i.test(blob) || /\btomorrow\b/i.test(blob)) return 'tomorrow';
  return 'today';
}

/**
 * Tag-Bucket relativ zum Plan-Zieltag — verhindert Doppel-Shift
 * (Plan schon „morgen“, Node-Text enthält noch „morgen“ → bleibt auf Zieltag).
 */
function relativeDayBucket(
  blob: string,
  planDayKey: string,
): 'primary' | 'plus1' | 'plus2' {
  const today = todayDateKey();
  const hint = dayHintFromBlob(blob);
  if (hint === 'overmorrow') {
    if (planDayKey === today) return 'plus2';
    if (planDayKey === offsetDateKey(1)) return 'plus1';
    return 'primary';
  }
  if (hint === 'tomorrow') {
    if (planDayKey === today) return 'plus1';
    return 'primary';
  }
  return 'primary';
}

export function applyMasterTimeline(plan: IngestedPlan): void {
  const dayKey = plan.targetDate;
  // Relativ zum Plan-Tag, nicht zur Wanduhr (sonst landet „morgen“ falsch)
  const baseMs = (() => {
    const [y, m, d] = dayKey.split('-').map(Number);
    if (!y || !m || !d) return Date.now();
    return new Date(y, m - 1, d, 12, 0, 0, 0).getTime();
  })();
  const tomorrowKey = offsetDateKey(1, baseMs);
  const overKey = offsetDateKey(2, baseMs);
  clearPlanningArtifactsOnDay(dayKey, plan.lageMode);
  // Transport-Default aus Onboarding (Fahrrad/Fuß/ÖPNV/Auto)
  try {
    const mode = getCachedUserProfile()?.mobilityMode;
    const map: Record<string, FuturePlanTransport> = {
      foot: 'walk',
      bike: 'bike',
      public_transit: 'transit',
      car: 'car',
    };
    if (mode && map[mode]) {
      useFuturePlanStore.getState().setTransportDefault(map[mode]!);
    }
  } catch {
    /* soft */
  }
  insertGeoAnchor(plan.geoAnchor, dayKey, plan.destinationCity);

  const fixedToday: IngestFixedNode[] = [];
  const fixedTomorrow: IngestFixedNode[] = [];
  const fixedOver: IngestFixedNode[] = [];
  for (const n of plan.fixedNodes) {
    const bucket = relativeDayBucket(
      `${n.title} ${n.location ?? ''}`,
      dayKey,
    );
    if (bucket === 'plus2') fixedOver.push(n);
    else if (bucket === 'plus1') fixedTomorrow.push(n);
    else fixedToday.push(n);
  }
  const wishToday: IngestOpenWish[] = [];
  const wishTomorrow: IngestOpenWish[] = [];
  const wishOver: IngestOpenWish[] = [];
  for (const w of plan.openWishesQueue) {
    const bucket = relativeDayBucket(`${w.title} ${w.context}`, dayKey);
    if (bucket === 'plus2') wishOver.push(w);
    else if (bucket === 'plus1') wishTomorrow.push(w);
    else wishToday.push(w);
  }

  insertTimeline(fixedToday, dayKey);
  insertOpenBands(wishToday, dayKey);
  if (fixedTomorrow.length || wishTomorrow.length) {
    useFuturePlanStore.getState().ensureDay(tomorrowKey);
    insertTimeline(fixedTomorrow, tomorrowKey);
    insertOpenBands(wishTomorrow, tomorrowKey);
  }
  if (fixedOver.length || wishOver.length) {
    useFuturePlanStore.getState().ensureDay(overKey);
    insertTimeline(fixedOver, overKey);
    insertOpenBands(wishOver, overKey);
  }
  // Aktiven Kalender-Tag wieder auf Plan-Zieltag — Multi-Day-ensureDay sonst „weg“
  useFuturePlanStore.getState().ensureDay(dayKey);
  try {
    usePlanCalendarUiStore.getState().requestDayKey(dayKey);
  } catch {
    /* soft */
  }
  try {
    applyGapFillTravelLegs();
  } catch {
    /* soft */
  }
}

/** Confirm nur bei echten Fixterminen — Explore-only / Soft-Wünsche ohne Confirm. */
function planNeedsVoiceConfirm(plan: IngestedPlan): boolean {
  return plan.fixedNodes.some((n) => Boolean(n.time) || n.priority <= 2);
}

const GASTRO_WISH_RE =
  /\b(restaurant|essen|dinner|mittag|pizza|burger|café|cafe|imbiss|gastro|abendessen|italiener|sushi|steak)\b/i;

function planAlreadyHasGastro(plan: IngestedPlan): boolean {
  for (const w of plan.openWishesQueue) {
    if (GASTRO_WISH_RE.test(`${w.title} ${w.context}`)) return true;
  }
  for (const n of plan.fixedNodes) {
    if (GASTRO_WISH_RE.test(`${n.title} ${n.location ?? ''}`)) return true;
  }
  try {
    const stops = useFuturePlanStore.getState().getPlanForDay(plan.targetDate)
      .stops;
    for (const s of stops) {
      if (s.kind === 'nav_leg' || s.id.startsWith('choice_')) continue;
      if (GASTRO_WISH_RE.test(`${s.title} ${s.notes ?? ''}`)) return true;
    }
  } catch {
    /* soft */
  }
  return false;
}

async function waitForUserLocationInput(): Promise<string> {
  return usePlanSessionStore.getState().beginWaitLocation();
}

function stripPlanConfirmQuestions(text: string): string {
  return (text ?? '')
    .replace(
      /\s*(passt\s+der\s+(fokus|grobe\s+plan|plan)[^.?！？]*[.?!？]?)/giu,
      '',
    )
    .replace(/\s*(soll(?:en)?\s+wir\s+(den\s+)?jetzt\s+suchen)[^.?！？]*[.?!？]?/giu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function maybeOfferDestinationCityPack(
  plan: IngestedPlan,
): Promise<'skipped' | 'loaded' | 'declined'> {
  const dest = (plan.destinationCity || '').trim();
  if (!dest) return 'skipped';
  // Soft-/unbekannte Stadt: kein erzwungenes Pack-Popup — nur bei Katalog-Pack.
  // Expliziter Wechsel („wechsel zu …“) läuft über cityProximity / UI.
  try {
    const { maybeCityPackOfferForText, acceptCityPackOffer } = await import(
      '../../services/cityPackOffer'
    );
    const offer = await maybeCityPackOfferForText(`in ${dest}`, {
      evenIfCached: true,
    });
    if (!offer) return 'skipped';
    // Soft (kein Pack): still Arbeitsstadt setzen — kein Popup, keine Rückfrage.
    if (offer.soft) {
      try {
        const { tagPlanSessionCity } = await import('./planSessionState');
        tagPlanSessionCity({
          cityKey: offer.city.id,
          cityHint: offer.city.name,
        });
      } catch {
        /* soft */
      }
      const res = await acceptCityPackOffer(offer.city.id, offer.city.name);
      return res.ok ? 'loaded' : 'skipped';
    }
    try {
      const { tagPlanSessionCity } = await import('./planSessionState');
      tagPlanSessionCity({
        cityKey: offer.city.id,
        cityHint: offer.city.name,
      });
    } catch {
      /* soft */
    }
    speak(
      `Für ${offer.city.name} recherchiere ich besser, wenn wir auf ${offer.city.name} wechseln. Wollen wir das?`,
    );
    usePlanCalendarUiStore.getState().setShortAnswers([
      {
        id: 'pack_stay',
        label: 'Nein',
        action: 'plan_reject',
      },
      {
        id: 'pack_load',
        label: 'Ja',
        action: 'plan_confirm',
      },
    ]);

    const watchAlreadySwitched = async (): Promise<void> => {
      try {
        const { getCachedUserProfile } = await import(
          '../../services/userProfileService'
        );
        const { sameFoldedCity } = await import('./planDestinationCity');
        for (let i = 0; i < 300; i++) {
          if (!usePlanSessionStore.getState().waitingConfirm) return;
          const profile = getCachedUserProfile();
          if (
            sameFoldedCity(profile?.cityName, offer.city.name) ||
            String(profile?.cityId || '').toLowerCase() ===
              offer.city.id.toLowerCase()
          ) {
            usePlanSessionStore.getState().resolveConfirm(true);
            return;
          }
          await sleepMs(400);
        }
      } catch {
        /* soft */
      }
    };

    const waitPackConfirm = async (): Promise<boolean> => {
      const p = usePlanSessionStore
        .getState()
        .beginWaitConfirm(120_000, false, 'pack_switch');
      void watchAlreadySwitched();
      return p;
    };

    try {
      const { getCachedUserProfile } = await import(
        '../../services/userProfileService'
      );
      const { presentCityPackSwitchCard, abortCitySwitchPrompt } = await import(
        '../../services/cityProximityService'
      );
      const profile = getCachedUserProfile();
      void presentCityPackSwitchCard({
        target: offer.city,
        activeId: profile?.cityId,
        activeName: String(profile?.cityName || '').trim() || 'deiner Stadt',
        softTarget: false,
      }).then((decision) => {
        const s = usePlanSessionStore.getState();
        if (!s.waitingConfirm || decision == null) return;
        s.resolveConfirm(decision === 'accept');
      });
      const accepted = await waitPackConfirm();
      abortCitySwitchPrompt(accepted ? 'accept' : 'dismiss');
      usePlanCalendarUiStore.getState().clearShortAnswers();
      if (!accepted) return 'declined';
      const res = await acceptCityPackOffer(offer.city.id);
      if (res.ok) {
        speak(
          `Alles klar — ${res.cityName} ist geladen. Ich mach mit dem Plan weiter.`,
        );
      }
      return res.ok ? 'loaded' : 'declined';
    } catch (uiErr) {
      console.warn('[module5] pack switch popup failed', uiErr);
    }
    const accepted = await waitPackConfirm();
    usePlanCalendarUiStore.getState().clearShortAnswers();
    if (!accepted) return 'declined';
    const res = await acceptCityPackOffer(offer.city.id);
    if (res.ok) {
      speak(
        `Alles klar — ${res.cityName} ist geladen. Ich mach mit dem Plan weiter.`,
      );
    }
    return res.ok ? 'loaded' : 'declined';
  } catch (err) {
    console.warn('[module5] destination pack offer failed', err);
    return 'skipped';
  }
}

async function waitForUserConfirmation(intro?: string): Promise<boolean> {
  const IDLE_MS = 2 * 60_000;
  const POLL = 1_500;
  const started = Date.now();

  // Frühestens nach 2 Min — und nur solange Timeline offen
  while (Date.now() - started < IDLE_MS) {
    if (usePlanSessionStore.getState().phase === 'idle') return true;
    if (!usePlanCalendarUiStore.getState().calendarVisible) {
      // Geschlossen = User will keine Confirm-Nachfragen
      return true;
    }
    await sleepMs(POLL);
  }

  if (!usePlanCalendarUiStore.getState().calendarVisible) {
    return true;
  }
  if (usePlanSessionStore.getState().phase === 'idle') return true;

  const line =
    stripPlanConfirmQuestions(intro ?? '') ||
    'Passt der grobe Plan so für dich?';
  speak(line);
  usePlanCalendarUiStore.getState().setShortAnswers([
    { id: 'confirm_change', label: 'Ändern', action: 'plan_reject' },
    { id: 'confirm_ok', label: 'Bestätigen', action: 'plan_confirm' },
  ]);

  const waitStarted = Date.now();
  const timeoutMs = 180_000;
  const confirmP = usePlanSessionStore
    .getState()
    .beginWaitConfirm(timeoutMs, false);

  // Während Warten: Timeline zu → still durch (kein „Plan noch offen?“-Nag)
  void (async () => {
    while (Date.now() - waitStarted < timeoutMs) {
      await sleepMs(POLL);
      if (!usePlanCalendarUiStore.getState().calendarVisible) {
        usePlanSessionStore.getState().resolveConfirm(true);
        return;
      }
      if (!usePlanSessionStore.getState().waitingConfirm) return;
    }
  })();

  return confirmP;
}

function toNavNode(stop: FuturePlanStop): PlanNavNode | null {
  if (typeof stop.lat !== 'number' || typeof stop.lng !== 'number') {
    return null;
  }
  return {
    id: stop.id,
    title: stop.title,
    coords: { lat: stop.lat, lng: stop.lng },
    plannedStartMs: stop.plannedStartMs,
    planPriority: stop.planPriority ?? null,
  };
}

function modeToTransport(
  mode: 'WALKING' | 'BICYCLE' | 'TRANSIT' | 'TAXI',
): FuturePlanTransport {
  switch (mode) {
    case 'BICYCLE':
      return 'bike';
    case 'TRANSIT':
      return 'transit';
    case 'TAXI':
      return 'taxi';
    default:
      return 'walk';
  }
}

export async function injectNavigationNode(
  wish: IngestOpenWish,
  committedStopId?: string,
): Promise<void> {
  const plan = useFuturePlanStore.getState().plan;
  const dayPlan = useFuturePlanStore.getState().getPlanForDay(plan.dayKey);
  const target =
    (committedStopId
      ? plan.stops.find((s) => s.id === committedStopId)
      : null) ??
    plan.stops.find(
      (s) =>
        s.kind !== 'wish' &&
        s.kind !== 'nav_leg' &&
        !s.id.startsWith('choice_') &&
        s.title.toLowerCase().includes(wish.title.slice(0, 12).toLowerCase()),
    );
  if (!target) return;
  const end = toNavNode(target);
  if (!end) return;

  const targetMs = target.plannedStartMs ?? Number.MAX_SAFE_INTEGER;
  const prev = [...dayPlan.stops]
    .filter(
      (s) =>
        s.kind !== 'wish' &&
        s.kind !== 'nav_leg' &&
        !s.id.startsWith('choice_') &&
        !s.id.startsWith('anchor_') &&
        s.id !== target.id &&
        typeof s.lat === 'number' &&
        typeof s.lng === 'number' &&
        (s.plannedStartMs ?? 0) <= targetMs,
    )
    .sort((a, b) => (a.plannedStartMs ?? 0) - (b.plannedStartMs ?? 0))
    .at(-1);

  const bag = readRucksackSync();
  const gps = anchorCoords(bag);
  const base = dayPlan.base;
  const start: PlanNavNode = prev
    ? toNavNode(prev) ?? {
        id: 'gps',
        title: 'Start',
        coords: { lat: gps.lat, lng: gps.lng },
      }
    : base?.lat != null && base.lng != null
      ? {
          id: 'day_base',
          title: base.label,
          coords: { lat: base.lat, lng: base.lng },
        }
      : {
          id: 'gps',
          title: 'Start',
          coords: { lat: gps.lat, lng: gps.lng },
        };

  const leg = await calculateNavigation(start, end);
  const leaveMs =
    (target.plannedStartMs ?? Date.now() + 60 * 60_000) -
    leg.duration * 60_000;

  useFuturePlanStore.getState().upsertStop({
    id: leg.id,
    title: `${leg.mode === 'TRANSIT' ? 'ÖPNV' : leg.mode === 'TAXI' ? 'Taxi' : leg.mode === 'BICYCLE' ? 'Rad' : 'Fuß'} → ${target.title}`,
    lat: start.coords.lat,
    lng: start.coords.lng,
    plannedStartMs: leaveMs,
    plannedEndMs: leaveMs + leg.duration * 60_000,
    bufferMin: 10,
    transport: modeToTransport(leg.mode),
    kind: 'nav_leg',
    status: 'planned',
    planPriority: 4,
    notes: `${leg.duration} Min inkl. Puffer`,
    emoji: '➡️',
    routeEstimate: 'routed',
  });
  if (leg.mode === 'TRANSIT') {
    try {
      const { scheduleRefineNavLegRoute } = await import(
        '../timeline/planTravelHelpers'
      );
      scheduleRefineNavLegRoute({
        navId: leg.id,
        from: start.coords,
        to: end.coords,
        arriveAtMs: target.plannedStartMs ?? null,
        prepBufferMin: 10,
        transport: 'transit',
      });
    } catch {
      /* soft */
    }
  }
}

async function waitForPickOrAdvance(timeoutMs = 180_000): Promise<void> {
  const start = Date.now();
  let hadChoice = Boolean(usePlanCalendarUiStore.getState().pendingChoice);
  while (Date.now() - start < timeoutMs) {
    const ui = usePlanCalendarUiStore.getState();
    if (hadChoice && !ui.pendingChoice) return;
    if (getActiveTaskOverride()) return;
    const phase = usePlanSessionStore.getState().phase;
    if (phase === 'idle' || phase === 'final') return;
    // Kein Reminder-Speak — User entscheidet selbst, wann weiter
    await new Promise((r) => setTimeout(r, 400));
    hadChoice = hadChoice || Boolean(ui.pendingChoice);
  }
}

function mergePlans(base: IngestedPlan, patched: IngestedPlan): IngestedPlan {
  const fixedByKey = new Map<string, IngestFixedNode>();
  for (const n of base.fixedNodes) {
    fixedByKey.set(n.title.toLowerCase(), { ...n });
  }
  for (const n of patched.fixedNodes) {
    const key = n.title.toLowerCase();
    const prev = fixedByKey.get(key);
    if (prev) {
      const range = parseHmRangeFromText(
        `${n.title} ${n.location ?? ''} ${n.time ?? ''} ${n.endTime ?? ''}`,
      );
      fixedByKey.set(key, {
        ...prev,
        ...n,
        time: n.time ?? range?.start ?? prev.time,
        endTime: n.endTime ?? range?.end ?? prev.endTime,
        location: n.location ?? prev.location,
        lat: n.lat ?? prev.lat,
        lng: n.lng ?? prev.lng,
        address: n.address ?? prev.address,
        needsClarification:
          n.needsClarification ?? prev.needsClarification,
      });
    } else {
      fixedByKey.set(key, { ...n });
    }
  }
  // Titel-Fuzzy: Amendment nennt gleichen Termin mit neuer Spanne
  for (const n of patched.fixedNodes) {
    const range = parseHmRangeFromText(
      `${n.title} ${n.location ?? ''} ${n.time ?? ''} ${n.endTime ?? ''}`,
    );
    if (!range) continue;
    for (const [key, prev] of fixedByKey) {
      if (key === n.title.toLowerCase()) continue;
      const overlap =
        key.includes(n.title.toLowerCase().slice(0, 8)) ||
        n.title.toLowerCase().includes(key.slice(0, 8));
      if (!overlap) continue;
      fixedByKey.set(key, {
        ...prev,
        time: range.start,
        endTime: range.end,
      });
    }
  }

  const merged: IngestedPlan = {
    targetDate: patched.targetDate || base.targetDate,
    geoAnchor: patched.geoAnchor.needsClarification
      ? base.geoAnchor
      : patched.geoAnchor,
    fixedNodes: [...fixedByKey.values()],
    openWishesQueue: (() => {
      const byKey = new Map<string, IngestOpenWish>();
      for (const w of base.openWishesQueue) {
        byKey.set(w.title.toLowerCase(), { ...w });
      }
      for (const w of patched.openWishesQueue) {
        const key = w.title.toLowerCase();
        const prev = byKey.get(key);
        if (prev) {
          const range = parseHmRangeFromText(
            `${w.title} ${w.context} ${w.estimatedTime ?? ''} ${w.endTime ?? ''}`,
          );
          byKey.set(key, {
            ...prev,
            ...w,
            estimatedTime:
              w.estimatedTime ?? range?.start ?? prev.estimatedTime,
            endTime: w.endTime ?? range?.end ?? prev.endTime,
            context: w.context || prev.context,
          });
        } else {
          byKey.set(key, { ...w });
        }
      }
      return [
        ...[...byKey.values()].filter((w) => w.priority !== 6),
        ...[...byKey.values()].filter((w) => w.priority === 6),
      ];
    })(),
    tasks: [],
    lageMode: patched.lageMode || base.lageMode,
    bridgeSpeech: patched.bridgeSpeech || base.bridgeSpeech,
    openQuestions: patched.openQuestions?.length
      ? patched.openQuestions
      : base.openQuestions,
    initialVoiceConfirm:
      patched.initialVoiceConfirm ||
      'Hab die Änderung eingetragen. Passt das so?',
  };
  if (patched.lageMode === 'change' && patched.openWishesQueue.length > 0) {
    for (const w of patched.openWishesQueue) {
      const idx = merged.openWishesQueue.findIndex(
        (e) => e.title.toLowerCase() === w.title.toLowerCase(),
      );
      if (idx >= 0) merged.openWishesQueue[idx] = w;
    }
  }
  // Prio 6 ans Ende
  merged.openWishesQueue = [
    ...merged.openWishesQueue.filter((w) => w.priority !== 6),
    ...merged.openWishesQueue.filter((w) => w.priority === 6),
  ];
  merged.tasks = derivePlanTasks(merged);
  return merged;
}

function selectionQueue(plan: IngestedPlan): IngestOpenWish[] {
  // Steps: Frühstück → Abend/Sunset → Landmarke Q&A/Ticket → Rest. Timeline chronologisch.
  return plan.openWishesQueue
    .filter(
      (w) =>
        (isPlanPitchWish(w) || isPlanLandmarkQaWish(w)) &&
        !isTravelToDestWish(w),
    )
    .sort((a, b) => {
      const r = pitchWalkRank(a) - pitchWalkRank(b);
      if (r !== 0) return r;
      return (a.estimatedTime || '99:99').localeCompare(b.estimatedTime || '99:99');
    });
}

function tourQueue(plan: IngestedPlan): IngestOpenWish[] {
  const leftover = plan.openWishesQueue.filter(
    (w) =>
      !isPlanPitchWish(w) &&
      !isPlanLandmarkQaWish(w) &&
      !isTravelToDestWish(w) &&
      !isGenericDayStartWish(w),
  );
  if (leftover.length === 0) return [];
  const named = leftover.filter((w) => !isExploreWish(w));
  const explore = leftover.filter((w) => isExploreWish(w));
  const landmarks = named.map((w) => w.title).filter(Boolean);
  const base = explore[0] ?? leftover[0]!;
  const extra =
    landmarks.length > 0
      ? `Route bindet genannte Orte ein: ${landmarks.join(', ')}. Start nach dem Frühstück, Ende am Abendessen.`
      : '';
  return [
    {
      ...base,
      priority: 6,
      context: `${base.context} | ${extra}`.trim().slice(0, 400),
    },
  ];
}

function speakBridge(plan: IngestedPlan): void {
  const dest = (plan.destinationCity || '').trim();
  const leave = plan.openWishesQueue.find((w) => isTravelToDestWish(w))
    ?.estimatedTime;
  const leaveBit = leave ? `Los ${leave.replace(/^0/, '')}` : '';
  const destBit = dest ? (leaveBit ? ` nach ${dest}` : dest) : '';
  const text = [
    leaveBit || destBit
      ? `${leaveBit}${destBit} — Timeline ist offen.`
      : 'Timeline ist offen.',
    'Wir gehen die Punkte nacheinander durch.',
  ]
    .filter(Boolean)
    .join(' ');
  speak(sanitizePlanSpeech(text));
}

/**
 * Masterplan-Session.
 * softStepLoop: bestehendes Compound-Skelett → direkt Step-Loop, kein Tages-Intro.
 */
export type RunPlanSessionOpts = {
  softStepLoop?: boolean;
};

export async function startPlanStepLoop(opts?: {
  plan?: IngestedPlan | null;
}): Promise<boolean> {
  const store = usePlanSessionStore.getState();
  const plan = opts?.plan ?? store.plan;
  if (!plan?.openWishesQueue?.length) return false;
  await runPlanSession(plan, { softStepLoop: true });
  return true;
}

export async function runPlanSession(
  ingestedPlan: IngestedPlan,
  opts?: RunPlanSessionOpts,
): Promise<void> {
  beginPlanSpeakTurn();
  const store = usePlanSessionStore.getState();
  store.setActive(true);
  const soft = Boolean(opts?.softStepLoop);
  try {
    const { resolveCityChatScope } = await import('../context/placeContext');
    const { tagPlanSessionCity } = await import('./planSessionState');
    const destCity = ingestedPlan.destinationCity?.trim() || null;
    const scope = resolveCityChatScope(
      [
        destCity || '',
        ingestedPlan.bridgeSpeech || '',
        ...ingestedPlan.openWishesQueue.map((w) => `${w.title} ${w.context}`),
        ...ingestedPlan.fixedNodes.map((n) => `${n.title} ${n.location ?? ''}`),
      ].join(' '),
    );
    tagPlanSessionCity({
      cityKey: destCity || scope.cityKey,
      cityHint: destCity || scope.cityHint,
    });
  } catch {
    /* soft */
  }

  let destPack: 'skipped' | 'loaded' | 'declined' = 'skipped';

  if (soft) {
    if (!ingestedPlan.tasks?.length) {
      ingestedPlan = {
        ...ingestedPlan,
        tasks: derivePlanTasks(ingestedPlan),
      };
    }
    store.setPlan(ingestedPlan);
    store.setTaskQueue(ingestedPlan.tasks);
    store.setPhase('list_build');
    applyMasterTimeline(ingestedPlan);
    openPlanCalendarModal(ingestedPlan.targetDate);
    speak(
      sanitizePlanSpeech(
        'Alles klar — wir gehen die Punkte nacheinander durch.',
      ),
    );
  } else {
  store.setPhase('lage');
  store.setPlan(ingestedPlan);
  store.setTaskQueue(ingestedPlan.tasks);

  // Nur den Zieldatum-Tag öffnen — kein Tag-Sprung
  openPlanCalendarModal(ingestedPlan.targetDate);

  // Mehr-Tage-Hinweis im Text: weitere Tage vorbereiten
  try {
    const { scoreFromUtterance } = await import('./planProScore');
    const hints = scoreFromUtterance(
      `${ingestedPlan.bridgeSpeech} ${ingestedPlan.openWishesQueue.map((w) => w.title).join(' ')}`,
    );
    if (hints.multiDay) {
      const { offsetDateKey } = await import('../../utils/dateKeys');
      useFuturePlanStore.getState().ensureDay(offsetDateKey(1));
      useFuturePlanStore.getState().ensureDay(offsetDateKey(2));
    }
  } catch {
    /* soft */
  }

  let skipClarify = false;
  if (
    ingestedPlan.geoAnchor.needsClarification ||
    ingestedPlan.fixedNodes.some((n) => n.needsClarification && !n.time)
  ) {
    // GPS + genannter Zielort → keine „Bist du in …?“-Rückfrage
    try {
      const { anchorCoords, readRucksackSync } = await import(
        '../rucksack/rucksackStore'
      );
      const { extractCityFromText } = await import(
        '../context/shortTermContext'
      );
      const gps = anchorCoords(readRucksackSync());
      const gpsOk =
        Number.isFinite(gps.lat) &&
        Number.isFinite(gps.lng) &&
        Math.abs(gps.lat) > 0.1;
      const blob = [
        ingestedPlan.bridgeSpeech,
        ...ingestedPlan.fixedNodes.map((n) => `${n.title} ${n.location ?? ''}`),
        ...ingestedPlan.openWishesQueue.map((w) => `${w.title} ${w.context}`),
      ].join(' ');
      const named = extractCityFromText(blob);
      if (gpsOk && named) {
        skipClarify = true;
        ingestedPlan = {
          ...ingestedPlan,
          geoAnchor: {
            ...ingestedPlan.geoAnchor,
            lat: gps.lat,
            lng: gps.lng,
            name: ingestedPlan.geoAnchor.name || 'hier',
            needsClarification: false,
          },
        };
        store.setPlan(ingestedPlan);
      }
    } catch {
      /* soft */
    }
  }

  store.setPhase('list_build');
  applyMasterTimeline(ingestedPlan);
  openPlanCalendarModal(ingestedPlan.targetDate);
  speakBridge(ingestedPlan);

  if (
    !skipClarify &&
    (ingestedPlan.geoAnchor.needsClarification ||
      ingestedPlan.fixedNodes.some((n) => n.needsClarification && !n.time))
  ) {
    speak('Kurze Frage: Wo startest du — oder wo ist der erste Termin?');
    const loc = await waitForUserLocationInput();
    if (loc.trim()) {
      ingestedPlan = {
        ...ingestedPlan,
        geoAnchor: {
          ...ingestedPlan.geoAnchor,
          name: loc.trim(),
          needsClarification: false,
        },
      };
      store.setPlan(ingestedPlan);
      applyMasterTimeline(ingestedPlan);
    }
  }

  // Unklarheiten danach — erst der ganze Plan, dann Stück für Stück
  const unclear = [
    ...ingestedPlan.fixedNodes.filter(
      (n) =>
        n.needsClarification ||
        (!n.location && n.time) ||
        isVagueSportVenueLocation(n.title, n.location),
    ),
  ];
  for (const n of unclear.slice(0, 4)) {
    const sportVague = isVagueSportVenueLocation(n.title, n.location);
    if (sportVague) {
      const blob = `${n.title} ${n.location ?? ''} ${ingestedPlan.bridgeSpeech}`;
      const cityName =
        cityFromPlanBlob(blob) ||
        (await import('../context/shortTermContext')).extractCityFromText(blob) ||
        '';
      const suggestions = cityName
        ? await suggestTennisClubsInCity(cityName)
        : [];
      const clubAnswers = suggestions.slice(0, 2).map((s, i) => ({
        id: `tennis_fix_${i}`,
        label: s.name.slice(0, 32),
        action: 'plan_location' as const,
        pick: s.name,
      }));
      usePlanCalendarUiStore.getState().setShortAnswers([
        ...clubAnswers,
        {
          id: 'tennis_fix_named',
          label: 'Club / Adresse',
          action: 'prompt',
          prompt: 'Der Platz heißt …',
        },
      ]);
      speak(
        sanitizePlanSpeech(
          suggestions.length >= 1
            ? `Für „${n.title}“${n.time ? ` um ${n.time}` : ''} brauche ich den genauen Platz — in ${cityName || 'der Stadt'} z. B. ${suggestions.map((s) => s.name).join(' oder ')}. Welcher ist es?`
            : `Für „${n.title}“${n.time ? ` um ${n.time}` : ''} brauche ich den genauen Tennisclub oder die Adresse — sonst kann ich keine Route planen.`,
        ),
      );
      const loc = await waitForUserLocationInput();
      usePlanCalendarUiStore.getState().clearShortAnswers();
      const trimmed = loc.trim();
      if (trimmed) {
        n.location = trimmed;
        n.needsClarification = false;
        // Lat/Lng vom Vorschlag oder Geocode — Pflicht für Route Basis→Venue
        const hit = suggestions.find(
          (s) =>
            s.name.toLowerCase() === trimmed.toLowerCase() ||
            trimmed.toLowerCase().includes(s.name.toLowerCase().slice(0, 12)),
        );
        if (hit) {
          n.lat = hit.lat;
          n.lng = hit.lng;
          n.address = hit.address ?? trimmed;
        } else {
          try {
            const { resolvePlacePackOsmGoogle } = await import(
              '../../services/navigation/packPlaceResolve'
            );
            const geo = await resolvePlacePackOsmGoogle({
              query: trimmed,
              cityHint: cityName || null,
            });
            if (geo) {
              n.lat = geo.lat;
              n.lng = geo.lng;
              n.address = geo.label || trimmed;
            }
          } catch {
            /* soft */
          }
        }
        ingestedPlan = {
          ...ingestedPlan,
          fixedNodes: [...ingestedPlan.fixedNodes],
          tasks: derivePlanTasks(ingestedPlan),
        };
        store.setPlan(ingestedPlan);
        openPlanCalendarModal(ingestedPlan.targetDate);
        applyMasterTimeline(ingestedPlan);
        try {
          applyGapFillTravelLegs();
        } catch {
          /* soft */
        }
      }
      continue;
    }

    const warm = isConcreteAppointmentTitle(n.title);
    speak(
      sanitizePlanSpeech(
        warm
          ? `Ah, stark — „${n.title}“${n.time ? ` um ${n.time}` : ''}. Was für eine Stelle, und wo genau ist die Adresse?`
          : `Kurz: „${n.title}“${n.time ? ` um ${n.time}` : ''} — wo genau?`,
      ),
    );
    const loc = await waitForUserLocationInput();
    if (loc.trim()) {
      n.location = loc.trim();
      n.needsClarification = false;
      try {
        const { resolvePlacePackOsmGoogle } = await import(
          '../../services/navigation/packPlaceResolve'
        );
        const planCity =
          cityFromPlanBlob(
            [
              loc,
              n.title,
              ingestedPlan.geoAnchor?.name,
              ...ingestedPlan.fixedNodes.map(
                (x) => `${x.title} ${x.location ?? ''} ${x.address ?? ''}`,
              ),
            ].join(' '),
          ) ||
          ingestedPlan.geoAnchor?.name ||
          null;
        const geo = await resolvePlacePackOsmGoogle({
          query: loc.trim(),
          cityHint: planCity,
        });
        if (geo) {
          n.lat = geo.lat;
          n.lng = geo.lng;
          n.address = geo.label || loc.trim();
        }
      } catch {
        /* soft */
      }
      ingestedPlan = {
        ...ingestedPlan,
        fixedNodes: [...ingestedPlan.fixedNodes],
        tasks: derivePlanTasks(ingestedPlan),
      };
      store.setPlan(ingestedPlan);
      openPlanCalendarModal(ingestedPlan.targetDate);
      applyMasterTimeline(ingestedPlan);
      try {
        applyGapFillTravelLegs();
      } catch {
        /* soft */
      }
    }
  }

  destPack = await maybeOfferDestinationCityPack(ingestedPlan);
  if (
    destPack === 'loaded' &&
    usePlanSessionStore.getState().phase === 'idle'
  ) {
    store.setActive(true);
    store.setPhase('list_build');
    store.setPlan(ingestedPlan);
  }
  } // end !soft preamble

  // Prefetch erste konkrete Auswahl (kein Explore) — bis zu 3 vorladen
  const queue0 = selectionQueue(ingestedPlan).filter((w) => !isExploreWish(w));
  triggerAsyncDeepResearch(queue0[0]);
  if (queue0[1]) triggerAsyncDeepResearch(queue0[1]);
  if (queue0[2]) triggerAsyncDeepResearch(queue0[2]);

  if (destPack === 'loaded') {
    store.setPhase('list_build');
  }

  // Nach dem kompletten Plan: Route + offene Punkte Stück für Stück
  openPlanCalendarModal(ingestedPlan.targetDate);
  applyMasterTimeline(ingestedPlan);
  try {
    applyGapFillTravelLegs();
  } catch {
    /* soft */
  }

  // Auswahl-Schleife: Pitch (Essen) zuerst; Tour mit Landmarken danach
  store.setPhase('step_loop');
  openPlanCalendarModal(ingestedPlan.targetDate);
  const livePlan = usePlanSessionStore.getState().plan ?? ingestedPlan;
  const concreteQueue = selectionQueue(livePlan);
  const exploreQueue = tourQueue(livePlan);
  let currentTaskIndex = 0;
  let exploreArmed = false;

  while (currentTaskIndex < concreteQueue.length) {
    if (usePlanSessionStore.getState().phase === 'idle') break;

    const override = getActiveTaskOverride();
    const activeTask = override || concreteQueue[currentTaskIndex]!;

    const nextWish = concreteQueue[currentTaskIndex + 1];
    if (nextWish) triggerAsyncDeepResearch(nextWish);

    store.setPhase('select_mode');
    let activeForPitch = enrichWishWithPrefs(activeTask);

    // Clarify: Party zu breit
    if (isVaguePartyWish(activeForPitch)) {
      partyClarifyShortAnswers();
      speak(
        sanitizePlanSpeech(
          `Kurz zu „${activeForPitch.title}“: Bar, Club, beides — oder hast du eine Musikrichtung?`,
        ),
      );
      const clarifyText = await waitForUserLocationInput();
      if (clarifyText.trim()) {
        activeForPitch = {
          ...activeForPitch,
          context: `${activeForPitch.context} | ${clarifyText.trim()}`.slice(
            0,
            400,
          ),
        };
        try {
          const { inferTripPrefsFromText, savePlanTripPrefs } = await import(
            './planTripPrefs'
          );
          const patch = inferTripPrefsFromText(clarifyText);
          if (Object.keys(patch).length) void savePlanTripPrefs(patch);
        } catch {
          /* soft */
        }
      }
      usePlanCalendarUiStore.getState().clearShortAnswers();
    }

    // Merge-Frage: Frühstück + Café-Meeting
    const cafeLike = concreteQueue.find(
      (w) =>
        w !== activeTask &&
        /\b(café|cafe|meeting|laptop)\b/i.test(`${w.title} ${w.context}`),
    );
    if (
      cafeLike &&
      canMergeBreakfastIntoCafe(activeForPitch, cafeLike) &&
      /\b(frühstück|fruehstueck)\b/i.test(
        `${activeForPitch.title} ${activeForPitch.context}`,
      )
    ) {
      mergeBreakfastShortAnswers();
      speak(
        sanitizePlanSpeech(
          'Möchtest du vorher im Meeting-Café frühstücken — oder getrennt suchen?',
        ),
      );
      const mergeAns = await waitForUserLocationInput();
      usePlanCalendarUiStore.getState().clearShortAnswers();
      if (/café|cafe|direkt|früher|frueher|verbind|im\s+meeting/i.test(mergeAns)) {
        const ci = concreteQueue.findIndex(
          (w) => w.id === cafeLike.id || w.title === cafeLike.title,
        );
        if (ci >= 0) {
          concreteQueue[ci] = {
            ...concreteQueue[ci]!,
            context: `${cafeLike.context} | inkl. Frühstück, früher da`.slice(
              0,
              400,
            ),
          };
        }
        // Frühstück überspringen — Café deckt es
        if (!getActiveTaskOverride()) {
          currentTaskIndex += 1;
        } else {
          usePlanSessionStore.getState().clearOverride();
        }
        continue;
      }
    }

    // Hotel nahe Tennis ohne Club-Namen → Vorschläge + Rückfrage
    if (
      isHotelWishText(`${activeForPitch.title} ${activeForPitch.context}`) &&
      needsVagueTennisVenueClarify(activeForPitch)
    ) {
      const blob = `${activeForPitch.title} ${activeForPitch.context}`;
      const cityName =
        cityFromPlanBlob(blob) ||
        (await import('../context/shortTermContext')).extractCityFromText(blob) ||
        '';
      const suggestions = cityName
        ? await suggestTennisClubsInCity(cityName)
        : [];
      const clubAnswers = suggestions.slice(0, 2).map((s, i) => ({
        id: `tennis_pick_${i}`,
        label: s.name.slice(0, 32),
        action: 'plan_location' as const,
        pick: s.name,
      }));
      usePlanCalendarUiStore.getState().setShortAnswers([
        ...clubAnswers,
        {
          id: 'tennis_club_named',
          label: 'Club nennen',
          action: 'prompt',
          prompt: 'Der Club heißt …',
        },
        {
          id: 'tennis_city_only',
          label: 'Nur Stadt',
          action: 'plan_location',
          pick: 'nur stadt',
        },
      ]);
      speak(
        sanitizePlanSpeech(
          suggestions.length >= 1
            ? `Kurz zum Tennis: in ${cityName || 'der Stadt'} gibt es z. B. ${suggestions.map((s) => s.name).join(' oder ')} — welcher Club ist es? Name oder Adresse reicht.`
            : 'Kurz: welcher Tennisclub genau? Name oder Adresse — sonst suche ich nur stadtweit, ohne Nähe-Garantie.',
        ),
      );
      const clarify = await waitForUserLocationInput();
      usePlanCalendarUiStore.getState().clearShortAnswers();
      const trimmed = clarify.trim();
      if (trimmed && !/^(nur\s+stadt|egal|skip)/i.test(trimmed)) {
        activeForPitch = {
          ...activeForPitch,
          context: `${activeForPitch.context} | Tennisclub: ${trimmed}`.slice(
            0,
            400,
          ),
        };
        const tennisNode = ingestedPlan.fixedNodes.find((n) =>
          /\btennis|turnier|match\b/i.test(`${n.title} ${n.location ?? ''}`),
        );
        if (tennisNode) {
          tennisNode.location = trimmed;
          tennisNode.needsClarification = false;
          try {
            const { resolvePlacePackOsmGoogle } = await import(
              '../../services/navigation/packPlaceResolve'
            );
            const geo = await resolvePlacePackOsmGoogle({
              query: trimmed,
              cityHint: cityName || null,
            });
            if (geo) {
              tennisNode.lat = geo.lat;
              tennisNode.lng = geo.lng;
              tennisNode.address = geo.label || trimmed;
            }
          } catch {
            /* soft */
          }
          store.setPlan(ingestedPlan);
          applyMasterTimeline(ingestedPlan);
          try {
            applyGapFillTravelLegs();
          } catch {
            /* soft */
          }
        }
      }
    }

    if (
      /\b(sonnenuntergang|sunset)\b/i.test(
        `${activeForPitch.title} ${activeForPitch.context}`,
      )
    ) {
      activeForPitch = {
        ...activeForPitch,
        context: `${activeForPitch.context} | Sunset-Wetter ehrlich: bei schlechtem Himmel nicht extra auf Sunset planen; Blick trotzdem, wenn der Ort ihn hergibt.`.slice(
          0,
          400,
        ),
      };
    }

    // Landmarke schon gewählt → Q&A + Ticket, kein Top-2-Pitch
    if (isPlanLandmarkQaWish(activeForPitch)) {
      const qa = await executeLandmarkQaBrief(activeForPitch);
      if (usePlanSessionStore.getState().phase === 'idle') break;
      openPlanCalendarModal(ingestedPlan.targetDate);
      speak(qa.spokenText);
      const acts: import('../../types/concierge').QuickAction[] = [];
      if (qa.ticketUrl) {
        acts.push({
          type: 'OPEN_URL',
          label: '🎟 Ticket',
          payload: { url: qa.ticketUrl, destName: activeForPitch.title },
        });
      }
      usePlanCalendarUiStore.getState().setMirroredActions(acts);
      usePlanCalendarUiStore.getState().setShortAnswers([
        {
          id: 'ticket_bought',
          label: 'Ticket gekauft',
          action: 'prompt',
          prompt: 'Ja, Ticket ist gekauft — bitte fest eintragen',
        },
        {
          id: 'ticket_skip',
          label: 'Weiter ohne Ticket',
          action: 'plan_advance',
        },
        {
          id: 'landmark_skip',
          label: 'Doch nicht hin',
          action: 'prompt',
          prompt: 'Zum Michel will ich doch nicht mehr hin',
        },
      ]);
      await waitForPickOrAdvance();
      usePlanCalendarUiStore.getState().clearShortAnswers();
      usePlanCalendarUiStore.getState().setMirroredActions([]);
      try {
        const {
          markLandmarkTicketResolved,
          peekOpenLandmarkTicket,
        } = require('./planLandmarkOpen') as {
          markLandmarkTicketResolved: (o?: {
            bought?: boolean;
            declined?: boolean;
          }) => void;
          peekOpenLandmarkTicket: () => { ticketPending: boolean } | null;
        };
        const amend = usePlanSessionStore.getState().takePendingAmendment?.();
        const blob = String(amend || '').toLowerCase();
        if (/gekauft|gebucht|ticket\s+ist/i.test(blob)) {
          markLandmarkTicketResolved({ bought: true, declined: false });
        } else if (/nicht\s+mehr|doch\s+nicht|kein\s+ticket/i.test(blob)) {
          markLandmarkTicketResolved({ declined: true });
        } else if (peekOpenLandmarkTicket()?.ticketPending) {
          // Weiter ohne Klärung → offen lassen, später nachfragen
        }
      } catch {
        /* soft */
      }
      if (usePlanSessionStore.getState().phase === 'idle') break;
      store.setPhase('step_loop');
      continue;
    }

    // Offene Landmarke (Ticket/Zeit) nachfragen, bevor nächster Pitch
    try {
      const {
        openLandmarkFollowUpSpeech,
        peekOpenLandmarkTicket,
      } = require('./planLandmarkOpen') as {
        openLandmarkFollowUpSpeech: () => string | null;
        peekOpenLandmarkTicket: () => unknown;
      };
      if (peekOpenLandmarkTicket()) {
        const fu = openLandmarkFollowUpSpeech();
        if (fu) {
          speak(fu);
          usePlanCalendarUiStore.getState().setShortAnswers([
            {
              id: 'ticket_bought2',
              label: 'Ticket gekauft',
              action: 'prompt',
              prompt: 'Ja, Ticket ist gekauft — bitte fest eintragen',
            },
            {
              id: 'ticket_time',
              label: 'Uhrzeit sagen',
              action: 'prompt',
              prompt: 'Michel um 14 Uhr einplanen',
            },
            {
              id: 'landmark_drop',
              label: 'Doch nicht',
              action: 'prompt',
              prompt: 'Zum Michel will ich doch nicht mehr hin',
            },
          ]);
          await waitForPickOrAdvance(90_000);
          usePlanCalendarUiStore.getState().clearShortAnswers();
          try {
            const { markLandmarkTicketResolved } = require('./planLandmarkOpen') as {
              markLandmarkTicketResolved: (o?: {
                bought?: boolean;
                declined?: boolean;
                timeHm?: string | null;
              }) => void;
            };
            const amend = usePlanSessionStore.getState().takePendingAmendment?.();
            const blob = String(amend || '').toLowerCase();
            if (/gekauft|gebucht/i.test(blob)) {
              markLandmarkTicketResolved({ bought: true });
            } else if (/nicht\s+mehr|doch\s+nicht/i.test(blob)) {
              markLandmarkTicketResolved({ declined: true });
            } else if (/\d{1,2}/.test(blob)) {
              markLandmarkTicketResolved({
                bought: true,
                timeHm: blob.match(/\d{1,2}(?::\d{2})?/)?.[0] ?? null,
              });
            }
          } catch {
            /* soft */
          }
        }
      }
    } catch {
      /* soft */
    }

    const pitch = await executeDeepResearchAndPitch(activeForPitch);
    if (usePlanSessionStore.getState().phase === 'idle') break;
    openPlanCalendarModal(ingestedPlan.targetDate);
    speak(
      pitch.spokenText ||
        `Als Nächstes: ${activeForPitch.title}. Zwei Optionen — was ist dein Favorit?`,
    );
    await waitForPickOrAdvance();
    if (usePlanSessionStore.getState().phase === 'idle') break;
    store.setPhase('step_loop');

    if (!usePlanCalendarUiStore.getState().pendingChoice) {
      await injectNavigationNode(activeTask);
      try {
        applyGapFillTravelLegs();
      } catch {
        /* soft */
      }
      openPlanCalendarModal(ingestedPlan.targetDate);
    }

    const midAmend = usePlanSessionStore.getState().takePendingAmendment();
    if (midAmend?.trim()) {
      try {
        const { applyPlanEditFromUtterance } = await import(
          '../timeline/planLiveEdits'
        );
        const direct = applyPlanEditFromUtterance(midAmend);
        if (direct.handled) {
          openPlanCalendarModal(ingestedPlan.targetDate);
          if (direct.speech) speak(direct.speech);
          continue;
        }
      } catch {
        /* soft */
      }
      try {
        const extra = await runPlanningIngestion(midAmend, {
          dayKeyHint: ingestedPlan.targetDate,
        });
        extra.targetDate = ingestedPlan.targetDate;
        ingestedPlan = mergePlans(ingestedPlan, extra);
        store.setPlan(ingestedPlan);
        applyMasterTimeline(ingestedPlan);
        openPlanCalendarModal(ingestedPlan.targetDate);
        for (const w of extra.openWishesQueue) {
          if (
            !concreteQueue.some(
              (q) => q.title.toLowerCase() === w.title.toLowerCase(),
            ) &&
            !exploreQueue.some(
              (q) => q.title.toLowerCase() === w.title.toLowerCase(),
            )
          ) {
            if (isExploreWish(w) || w.priority === 6) exploreQueue.push(w);
            else concreteQueue.splice(currentTaskIndex + 1, 0, w);
            insertOpenBands([w], ingestedPlan.targetDate);
          }
        }
        try {
          const { repackExploreStopsOnDay } = await import(
            './planPlacesResearch'
          );
          repackExploreStopsOnDay(ingestedPlan.targetDate);
        } catch {
          /* soft */
        }
        speak('Hab die Änderung eingetragen.');
      } catch {
        /* soft */
      }
    }

    if (!getActiveTaskOverride()) {
      currentTaskIndex += 1;
    } else {
      usePlanSessionStore.getState().clearOverride();
      const idx = concreteQueue.findIndex(
        (w) => w.id === activeTask.id || w.title === activeTask.title,
      );
      if (idx >= 0) currentTaskIndex = idx + 1;
    }

    const picked = !usePlanCalendarUiStore.getState().pendingChoice;
    const moreConcrete = currentTaskIndex < concreteQueue.length;
    const moreExplore = exploreQueue.length > 0;
    if (picked && moreConcrete) {
      continue;
    }
    if (picked && !moreConcrete && moreExplore) {
      exploreArmed = true;
      break;
    }
    if (!picked && (moreConcrete || moreExplore)) {
      openPlanCalendarModal(ingestedPlan.targetDate);
      if (!usePlanCalendarUiStore.getState().calendarVisible) {
        await sleepMs(200);
        openPlanCalendarModal(ingestedPlan.targetDate);
      }
      usePlanCalendarUiStore.getState().setShortAnswers([
        { id: 'plan_next', label: 'Weiter', action: 'plan_confirm' },
        { id: 'plan_pause', label: 'Später', action: 'plan_reject' },
      ]);
      const goOn = await usePlanSessionStore
        .getState()
        .beginWaitConfirm(12 * 60_000, false);
      usePlanCalendarUiStore.getState().clearShortAnswers();
      if (
        !goOn ||
        usePlanSessionStore.getState().phase === 'idle'
      ) {
        store.setPhase('step_loop');
        store.setActive(true);
        return;
      }
      if (!moreConcrete && moreExplore) {
        exploreArmed = true;
      }
    }
  }

  // Tour nach den konkreten Pitches (Frühstück → Abend → Landmarke)
  if (exploreArmed) {
    for (const explore of exploreQueue) {
      if (usePlanSessionStore.getState().phase === 'idle') break;
      const { executeExploreWishInsert } = await import('./planPlacesResearch');
      const freeHoursHint =
        parseWishFreeHours(explore) ??
        (() => {
          const m = explore.estimatedTime?.match(/^(\d{1,2}):/);
          const startH = m ? Number(m[1]) : 10;
          return Math.max(2, Math.min(6, 20 - startH));
        })();
      const result = await executeExploreWishInsert(explore, {
        dayKey: ingestedPlan.targetDate,
        fixedCount: ingestedPlan.fixedNodes.length,
        freeHoursHint,
      });
      speak(result.spokenText);
      usePlanCalendarUiStore.getState().setShortAnswers([
        { id: 'explore_reject', label: 'Neu suchen', action: 'plan_reject' },
        { id: 'explore_ok', label: 'Bestätigen', action: 'plan_confirm' },
      ]);
      const ok = await usePlanSessionStore
        .getState()
        .beginWaitConfirm(180_000, false);
      if (!ok) {
        const again = await executeExploreWishInsert(explore, {
          dayKey: ingestedPlan.targetDate,
          fixedCount: ingestedPlan.fixedNodes.length,
          freeHoursHint,
        });
        speak(again.spokenText);
        usePlanCalendarUiStore.getState().setShortAnswers([
          { id: 'explore_ok2', label: 'Bestätigen', action: 'plan_confirm' },
        ]);
        await usePlanSessionStore.getState().beginWaitConfirm(180_000, false);
      }
      usePlanCalendarUiStore.getState().clearShortAnswers();
    }
  } else if (exploreQueue.length > 0 || concreteQueue.length > 0) {
    store.setPhase('step_loop');
    store.setActive(true);
    try {
      applyGapFillTravelLegs();
    } catch {
      /* soft */
    }
    return;
  }

  store.setPhase('final');
  try {
    applyGapFillTravelLegs();
  } catch {
    /* soft */
  }
  await runFinalTimelineOptimization();

  // Ende: Übernachten vs Heimfahrt (Founder-Staging)
  try {
    const dest = (ingestedPlan.destinationCity || '').trim();
    if (dest && !/\bhier\b/i.test(dest)) {
      speak(
        sanitizePlanSpeech(
          `Passt der Tag so? Möchtest du in ${dest} übernachten, oder abends wieder nach Hause?`,
        ),
      );
      usePlanCalendarUiStore.getState().setShortAnswers([
        {
          id: 'plan_stay',
          label: 'Übernachten',
          action: 'prompt',
          prompt: `Ich möchte in ${dest} übernachten, Hotel in der Nähe vom Abendessen`,
        },
        {
          id: 'plan_home',
          label: 'Heimfahrt',
          action: 'prompt',
          prompt: `Abends wieder nach Hause von ${dest}`,
        },
      ]);
      await usePlanSessionStore.getState().beginWaitConfirm(120_000, false);
      usePlanCalendarUiStore.getState().clearShortAnswers();
    }
  } catch {
    /* soft */
  }

  store.setActive(false);
  store.setPhase('idle');
}
