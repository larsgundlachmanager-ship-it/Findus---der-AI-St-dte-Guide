/**
 * Modul 5 — Konflikte (Opfer-Hierarchie), Trigger, Final.
 *
 * Opfer: 6 frei → 5 löschen nur Frage → 4 nur schieben → 3 nur Frage → 1–2 heilig.
 * Erinnerungen: Prio1–3 = 30+5; ÖPNV = 10; sonst Leave-by = 5; Prio5/6 = keine.
 */

import {
  useFuturePlanStore,
  type FuturePlanStop,
  type FuturePlanTransport,
} from '../timeline/futurePlanState';
import { enqueueSpeech } from '../speech/speechQueue';
import { usePlanCalendarUiStore } from '../timeline/planCalendarUiStore';
import {
  registerDepartureWatch,
  registerTimeReminder,
} from '../../services/logistics/logisticsTriggerEngine';
import { useShoppingTaskStore } from '../../store/useShoppingTaskStore';
import { searchPlacesByText } from '../../services/navigation/googleMapsNav';
import { haversineMeters } from '../../db/database';
import { readRucksackSync, anchorCoords } from '../rucksack/rucksackStore';
import {
  buildReservationMailtoDraft,
  withReservationPrefill,
} from '../../services/reservation/reservationPrefill';
import { getCachedUserProfile } from '../../services/userProfileService';
import { getReservationContact } from '../../types/userProfile';
import type { PlanPriority } from './planningTypes';
import type { QuickAction } from '../../types/concierge';
import {
  detectOfferKind,
  isSafeOfferUrl,
  offerLabel,
} from './offerActionUtils';
import { applyGapFillTravelLegs } from '../timeline/gapFillTravel';
import { usePlanSessionStore } from './planSessionState';
import { sanitizePlanSpeech } from './planSpeechSanitize';
import {
  buildHelpFirstPlanActions,
  eveningGapHours,
  largestGapHours,
} from '../../services/affiliate/helpFirstMonetization';
import {
  findPlanOverlapPair,
  planStopsOverlap,
} from './planTimeOverlap';
import {
  isHardFixedStop,
  isSoftMovableStop,
  prioOfStop,
} from './planHardLock';

function prioOf(s: FuturePlanStop): PlanPriority {
  return prioOfStop(s);
}

export function hasTimeOverlap(
  stops: FuturePlanStop[] = useFuturePlanStore.getState().plan.stops,
): boolean {
  return planStopsOverlap(stops);
}

function findOverlapPair(
  stops: FuturePlanStop[],
): [FuturePlanStop, FuturePlanStop] | null {
  return findPlanOverlapPair(stops);
}

/** Weicheres Event im Overlap (höhere Prio-Zahl = weicher; Hard nie soft). */
function softerOf(
  a: FuturePlanStop,
  b: FuturePlanStop,
): FuturePlanStop {
  const aHard = isHardFixedStop(a);
  const bHard = isHardFixedStop(b);
  if (aHard !== bHard) return aHard ? b : a;
  return prioOf(a) >= prioOf(b) ? a : b;
}

function harderOf(
  a: FuturePlanStop,
  b: FuturePlanStop,
): FuturePlanStop {
  const aHard = isHardFixedStop(a);
  const bHard = isHardFixedStop(b);
  if (aHard !== bHard) return aHard ? a : b;
  return prioOf(a) < prioOf(b) ? a : b;
}

/**
 * Stop hinter härteren Anker schieben (Prio 4 Pflicht; auch Fallback wenn User nicht löschen will).
 * Harte User-Termine werden nie verschoben.
 */
export function shiftStopPastHarder(
  soft: FuturePlanStop,
  hard: FuturePlanStop,
  reason = 'Verschoben',
): boolean {
  if (isHardFixedStop(soft) || !isSoftMovableStop(soft)) return false;
  const hardEnd =
    hard.plannedEndMs ??
    (hard.plannedStartMs != null
      ? hard.plannedStartMs + 45 * 60_000
      : null);
  if (hardEnd == null) return false;
  const duration =
    soft.plannedEndMs != null && soft.plannedStartMs != null
      ? Math.max(20 * 60_000, soft.plannedEndMs - soft.plannedStartMs)
      : 45 * 60_000;
  const nextStart = hardEnd + 10 * 60_000;
  useFuturePlanStore.getState().upsertStop({
    ...soft,
    plannedStartMs: nextStart,
    plannedEndMs: nextStart + duration,
    status: 'pending_change',
    notes: [soft.notes, reason].filter(Boolean).join('\n'),
  });
  return true;
}

/** Alias: Prio 4 nie löschen — nur schieben. */
export function shiftPrio4PastHarder(
  soft: FuturePlanStop,
  hard: FuturePlanStop,
): boolean {
  if (prioOf(soft) !== 4) return false;
  return shiftStopPastHarder(soft, hard, 'Verschoben (Prio 4 — nie löschen)');
}

/**
 * Opfert niedrigste Prio nur wenn auto-erlaubt (Prio 6).
 * @deprecated Prefer resolveOverlapsInteractive — retained for callers.
 */
export function dropLowestPriorityEvent(
  stops: FuturePlanStop[] = useFuturePlanStore.getState().plan.stops,
): FuturePlanStop | null {
  const candidates = stops
    .filter(
      (s) =>
        s.kind !== 'nav_leg' &&
        !s.id.startsWith('choice_') &&
        s.status !== 'done' &&
        prioOf(s) === 6,
    )
    .sort((a, b) => prioOf(b) - prioOf(a));
  const dropped = candidates[0] ?? null;
  if (!dropped) return null;
  useFuturePlanStore.getState().removeStop(dropped.id);
  return dropped;
}

async function askDropPermission(title: string, prio: PlanPriority): Promise<boolean> {
  const clean = sanitizePlanSpeech(title.replace(/^[🥇🥈📌📍✨🏁🔔]\s*/u, ''));
  const speech =
    prio === 3
      ? sanitizePlanSpeech(
          `Kurz eng: „${clean}“ kollidiert. Soll das Treffen weichen oder verschoben werden?`,
        )
      : sanitizePlanSpeech(
          `Kurz eng: „${clean}“ rausnehmen, damit der Rest passt?`,
        );
  enqueueSpeech({
    kind: 'main',
    text: speech,
    turnId: `m5_conflict_${Date.now()}`,
  });
  usePlanCalendarUiStore.getState().setShortAnswers([
    { id: 'conflict_no', label: 'Behalten', action: 'plan_reject' },
    { id: 'conflict_yes', label: 'Raus', action: 'plan_confirm' },
  ]);
  return usePlanSessionStore.getState().beginWaitConflict();
}

/**
 * Interaktive Overlap-Auflösung nach Opfer-Hierarchie.
 */
export async function resolveOverlapsInteractive(): Promise<{
  dropped: string[];
  shifted: string[];
}> {
  const dropped: string[] = [];
  const shifted: string[] = [];
  let guard = 0;

  while (hasTimeOverlap() && guard < 12) {
    guard += 1;
    const pair = findOverlapPair(useFuturePlanStore.getState().plan.stops);
    if (!pair) break;
    const soft = softerOf(pair[0], pair[1]);
    const hard = harderOf(pair[0], pair[1]);
    const p = prioOf(soft);

    if (p <= 2 || isHardFixedStop(soft)) {
      // Heilig — nicht auto-opfern / nicht verschieben
      break;
    }

    if (p === 6) {
      // Explore/Prio-6: schieben statt löschen — Route bleibt, Timing passt sich an
      if (
        soft.id.startsWith('explore_') ||
        soft.planPriority === 6
      ) {
        if (shiftStopPastHarder(soft, hard, 'Verschoben (Erkunden)')) {
          shifted.push(soft.title);
          try {
            const { repackExploreStopsOnDay } = await import(
              './planPlacesResearch'
            );
            repackExploreStopsOnDay(
              useFuturePlanStore.getState().plan.dayKey,
            );
          } catch {
            /* soft */
          }
          continue;
        }
      }
      useFuturePlanStore.getState().removeStop(soft.id);
      dropped.push(soft.title);
      continue;
    }

    if (p === 4) {
      if (shiftPrio4PastHarder(soft, hard)) {
        shifted.push(soft.title);
        continue;
      }
      break;
    }

    if (p === 5 || p === 3) {
      const ok = await askDropPermission(soft.title, p);
      usePlanCalendarUiStore.getState().clearShortAnswers();
      if (ok) {
        useFuturePlanStore.getState().removeStop(soft.id);
        dropped.push(soft.title);
        continue;
      }
      // User will behalten → schieben statt löschen
      if (shiftStopPastHarder(soft, hard, 'Verschoben (behalten)')) {
        shifted.push(soft.title);
        continue;
      }
      break;
    }
  }

  return { dropped, shifted };
}

function fetchPendingGeoWishes(): Array<{
  id: string;
  itemLabel: string;
  placeTypes: string[];
}> {
  try {
    return useShoppingTaskStore
      .getState()
      .getOpenTasks()
      .filter((t) => t.anchor === 'store')
      .map((t) => ({
        id: t.id,
        itemLabel: t.itemLabel,
        placeTypes: t.placeTypes.map(String),
      }));
  } catch {
    return [];
  }
}

export async function injectGeoStopsIfOnRoute(
  pending: ReturnType<typeof fetchPendingGeoWishes>,
): Promise<void> {
  if (pending.length === 0) return;
  const plan = useFuturePlanStore.getState().plan;
  const pathStops = plan.stops.filter(
    (s) =>
      typeof s.lat === 'number' &&
      typeof s.lng === 'number' &&
      s.kind !== 'wish',
  );
  if (pathStops.length < 1) return;

  const bag = readRucksackSync();
  const gps = anchorCoords(bag);

  for (const wish of pending.slice(0, 3)) {
    const query =
      wish.placeTypes.includes('drugstore') ||
      /zahnbürste|zahnbuerste|drogerie/i.test(wish.itemLabel)
        ? `Rossmann OR DM ${wish.itemLabel}`
        : wish.itemLabel;
    try {
      const hits = await searchPlacesByText({
        query,
        lat: gps.lat,
        lng: gps.lng,
        radiusM: 2500,
      });
      const hit = hits[0];
      if (!hit) continue;
      const nearRoute = pathStops.some(
        (s) =>
          haversineMeters(s.lat!, s.lng!, hit.lat, hit.lng) <= 400,
      );
      if (!nearRoute && pathStops.length > 0) {
        const mid = pathStops[Math.floor(pathStops.length / 2)]!;
        if (haversineMeters(mid.lat!, mid.lng!, hit.lat, hit.lng) > 600) {
          continue;
        }
      }
      const id = `geo_${wish.id}`;
      if (plan.stops.some((s) => s.id === id)) continue;
      useFuturePlanStore.getState().upsertStop({
        id,
        title: `${hit.name} · ${wish.itemLabel}`,
        lat: hit.lat,
        lng: hit.lng,
        bufferMin: 5,
        transport: 'walk',
        kind: 'stop',
        status: 'planned',
        planPriority: 5,
        emoji: '🛒',
        notes: `Geo-Trigger: ${wish.itemLabel}`,
        mapsUrl:
          (() => {
            try {
              const { mapsUrlForGooglePlace } = require('../../services/research/eventInfoUrl') as {
                mapsUrlForGooglePlace: (o: {
                  placeName?: string | null;
                  placeId?: string | null;
                }) => string | null;
              };
              return mapsUrlForGooglePlace({
                placeName: hit.name,
                placeId: hit.placeId,
              }) || undefined;
            } catch {
              return undefined;
            }
          })(),
      });
    } catch {
      /* soft */
    }
  }
}

function setTrigger(
  nodeId: string,
  leadMin: number,
  opts: {
    title: string;
    atMs: number;
    mode?: 'walk' | 'transit' | 'taxi' | 'bike' | 'generic';
    priority?: number | null;
    destLat?: number | null;
    destLng?: number | null;
  },
): void {
  const departureMs = opts.atMs;
  if (!Number.isFinite(departureMs) || departureMs <= Date.now()) return;
  try {
    registerDepartureWatch({
      eventId: `m5_${nodeId}_${leadMin}`,
      title: opts.title,
      departureMs,
      walkEtaMin: leadMin,
      warnLeadMin: leadMin,
      mode:
        opts.mode === 'transit'
          ? 'train'
          : opts.mode === 'taxi'
            ? 'taxi'
            : opts.mode === 'bike'
              ? 'bike'
              : 'walk',
      planPriority: opts.priority ?? null,
      destLat: opts.destLat ?? null,
      destLng: opts.destLng ?? null,
      destName: opts.title,
      scheduleOsPush: true,
    });
  } catch {
    try {
      registerTimeReminder({
        title: opts.title,
        fireAtMs: departureMs - leadMin * 60_000,
        eventId: `m5_rem_${nodeId}_${leadMin}`,
        detail: `${leadMin} Min vorher`,
      });
    } catch {
      /* soft */
    }
  }
}

function transportToMode(
  t: FuturePlanTransport,
): 'walk' | 'transit' | 'taxi' | 'bike' | 'generic' {
  if (t === 'transit') return 'transit';
  if (t === 'taxi' || t === 'car') return 'taxi';
  if (t === 'bike') return 'bike';
  if (t === 'walk') return 'walk';
  return 'generic';
}

function msToHm(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function findDiningStops(): FuturePlanStop[] {
  return useFuturePlanStore
    .getState()
    .plan.stops.filter(
      (s) =>
        s.kind === 'stop' &&
        !s.id.startsWith('choice_') &&
        !s.id.startsWith('anchor_') &&
        /essen|restaurant|mittag|abendessen|café|cafe|brunch|dinner|lunch|gastro|imbiss|pizzeria/i.test(
          `${s.title} ${s.notes ?? ''}`,
        ),
    );
}

/**
 * Erste Morgen-Abfahrt → Wecker rückwärts (Leave-by − Prep).
 * Nicht die gesprochene Los-Uhrzeit als Weckzeit.
 */
async function armWakeFromFirstLeaveBy(): Promise<void> {
  const stops = [...useFuturePlanStore.getState().plan.stops].sort(
    (a, b) => (a.plannedStartMs ?? 0) - (b.plannedStartMs ?? 0),
  );
  const firstLeave = stops.find((s) => {
    if (s.plannedStartMs == null) return false;
    const h = new Date(s.plannedStartMs).getHours();
    if (h >= 14) return false;
    if (s.kind === 'nav_leg') return true;
    return /\b(anreise|abfahrt|aufbruch|bahn|zug)\b/i.test(
      `${s.title} ${s.notes ?? ''}`,
    );
  });
  if (!firstLeave?.plannedStartMs) return;
  if (firstLeave.plannedStartMs < Date.now() + 20 * 60_000) return;

  const { DEFAULT_MORNING_PREP_MIN, buildWakeProposalFromLeaveBy } =
    await import('../../services/alarms/wakeAlarmAdvisor');
  const proposal = buildWakeProposalFromLeaveBy({
    leaveByMs: firstLeave.plannedStartMs,
    departureMs: firstLeave.plannedStartMs,
    reasonLabel: firstLeave.title || 'Losgehen',
    prepMin: DEFAULT_MORNING_PREP_MIN,
  });
  if (!proposal) return;

  const { setWakeAlarmWithBridge } = await import(
    '../../services/alarms/nativeAlarmBridge'
  );
  const result = await setWakeAlarmWithBridge({
    wakeAtMs: proposal.wakeAtMs,
    reasonLabel: proposal.reasonLabel,
    leaveByMs: proposal.leaveByMs,
    reminderKey: `plan_end_wake:${firstLeave.id}`,
    preferNative: true,
    wakeMode: 'replace',
  });
  if (result.ok) {
    const wakeClock = new Date(proposal.wakeAtMs).toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const leaveClock = new Date(firstLeave.plannedStartMs).toLocaleTimeString(
      'de-DE',
      { hour: '2-digit', minute: '2-digit' },
    );
    enqueueSpeech({
      kind: 'main',
      text: sanitizePlanSpeech(`Wecker steht auf ${wakeClock}, Losgehen ${leaveClock}.`),
      turnId: `m5_final_${Date.now()}`,
    });
  }
}

export function applyPlanReminderMatrix(): void {
  const nodes = useFuturePlanStore.getState().plan.stops.filter(
    (s) => s.kind !== 'wish' && !s.id.startsWith('choice_'),
  );

  for (const node of nodes) {
    if (node.kind === 'nav_leg') continue;
    const p = prioOf(node);
    const at = node.plannedStartMs;
    if (at == null) continue;

    // Prio 5 + 6: bewusst still
    if (p === 5 || p === 6) continue;

    const common = {
      title: node.title,
      atMs: at,
      priority: p,
      destLat: node.lat ?? null,
      destLng: node.lng ?? null,
    };

    if (p === 1 || p === 2 || p === 3) {
      setTrigger(node.id, 30, common);
      setTrigger(node.id, 5, common);
      useFuturePlanStore.getState().upsertStop({
        ...node,
        emoji: node.emoji?.includes('🔔')
          ? node.emoji
          : `🔔 ${node.emoji ?? ''}`.trim(),
        status: 'trigger_active',
      });
    } else if (p === 4) {
      // Leave-by / Zeitfenster: 5 Min
      setTrigger(node.id, 5, common);
    }
  }

  for (const leg of nodes.filter((s) => s.kind === 'nav_leg')) {
    const at = leg.plannedStartMs;
    if (at == null) continue;
    const lead = leg.transport === 'transit' ? 10 : 5;
    setTrigger(leg.id, lead, {
      title: leg.title || 'Losgehen',
      atMs: at,
      mode: transportToMode(leg.transport),
      destLat: leg.lat ?? null,
      destLng: leg.lng ?? null,
    });
  }
}

function showFinalActionCards(opts?: {
  hasTaxi?: boolean;
  hasTransit?: boolean;
}): void {
  const profile = getCachedUserProfile();
  const contact = getReservationContact(profile);
  const dayKey = useFuturePlanStore.getState().plan.dayKey;
  const dining = findDiningStops();
  const primary =
    dining[0] ??
    useFuturePlanStore
      .getState()
      .plan.stops.find(
        (s) =>
          s.kind === 'stop' &&
          !s.id.startsWith('choice_') &&
          !s.id.startsWith('anchor_'),
      );

  const actions: QuickAction[] = [];
  const shortAnswers: Array<{
    id: string;
    label: string;
    action: 'prompt';
    prompt?: string;
  }> = [];

  // Mobility-Board nach Prefs / berechneten Legs — nicht blind Taxi+Tickets
  if (opts?.hasTaxi) {
    actions.push({
      type: 'BOOK_UBER',
      label: 'Taxi vorbestellen',
      payload: {},
    });
  }
  if (opts?.hasTransit) {
    actions.push({
      type: 'OPEN_URL',
      label: 'ÖPNV-Verbindung',
      payload: {
        url: 'https://www.google.com/maps/dir/?api=1&travelmode=transit',
      },
    });
  }

  if (primary) {
    const timeHm = msToHm(primary.plannedStartMs);
    const isHair = /friseur|haar|salon|barber/i.test(primary.title);
    const mailto = buildReservationMailtoDraft({
      restaurantEmail: null,
      restaurantName: primary.title.replace(/^[🥇🥈📌📍✨🏁🔔]\s*/u, '').trim(),
      guestName: contact.fullName || '',
      guestEmail: contact.email || '',
      guestPhone: contact.phoneNumber || null,
      partySize: 2,
      timeHm,
      dateIso: dayKey,
      notes: null,
    });
    let reserveUrl = primary.reserveUrl?.trim() || null;
    if (reserveUrl && !/^mailto:/i.test(reserveUrl)) {
      reserveUrl = withReservationPrefill(reserveUrl, {
        partySize: 2,
        dateIso: dayKey,
        timeHm,
        guestName: contact.fullName || null,
        guestEmail: contact.email || null,
        guestPhone: contact.phoneNumber || null,
      });
    }
    const tableUrl = reserveUrl || mailto;
    actions.push({
      type: 'OPEN_URL',
      label: isHair ? 'Termin buchen' : 'Tisch reservieren',
      payload: { url: tableUrl },
    });
    if (primary.menuUrl && isSafeOfferUrl(primary.menuUrl)) {
      const labels = offerLabel(detectOfferKind(primary.title));
      actions.push({
        type: 'OPEN_URL',
        label: labels.shortLabel,
        payload: { url: primary.menuUrl },
      });
    }
  }

  // Hilfe-zuerst: Flughafen / Lücke / Hotel — max 2 Extra-Buttons
  try {
    const allStops = useFuturePlanStore.getState().plan.stops;
    const intervals = allStops
      .filter(
        (s) =>
          s.kind === 'stop' &&
          s.plannedStartMs != null &&
          !s.id.startsWith('choice_'),
      )
      .map((s) => ({
        startMs: s.plannedStartMs!,
        endMs: s.plannedEndMs ?? s.plannedStartMs! + 45 * 60_000,
      }));
    const planBlob = allStops.map((s) => s.title).join(' ');
    const flightOrAirport = /\b(flug|flughafen|airport|boarding)\b/iu.test(
      planBlob,
    );
    const hotelish = /\b(hotel|check[- ]?in|check[- ]?out|übernacht|uebernacht|hostel|airbnb)\b/iu.test(
      planBlob,
    );
    const lateEvent = intervals.some((iv) => {
      const h = new Date(iv.startMs).getHours();
      return h >= 18;
    });
    const helpActions = buildHelpFirstPlanActions({
      planBlob,
      flightOrAirportInPlan: flightOrAirport,
      hasLongGapHours: largestGapHours(intervals),
      hasEveningGapHours: eveningGapHours(intervals, dayKey),
      cityName: getCachedUserProfile()?.cityName,
      checkoutConflict: hotelish && lateEvent,
    });
    for (const ha of helpActions) {
      if (actions.length >= 4) break;
      const dup = actions.some(
        (a) =>
          a.type === ha.type &&
          (a.payload.url ?? a.label) === (ha.payload.url ?? ha.label),
      );
      if (!dup) actions.push(ha);
    }
  } catch {
    /* soft */
  }

  for (const a of actions.slice(0, 4)) {
    shortAnswers.push({
      id: `final_${a.label}`,
      label: a.label.slice(0, 28),
      action: 'prompt',
      prompt: a.label,
    });
  }

  usePlanCalendarUiStore.getState().setMirroredActions(actions.slice(0, 4));
  usePlanCalendarUiStore.getState().setShortAnswers(
    shortAnswers.map((s) => ({
      ...s,
      action: 'prompt' as const,
    })),
  );
}

/**
 * Finaler Timeline-Check: Konflikte → Geo → Trigger → kurze Speech → Actions.
 */
export async function runFinalTimelineOptimization(): Promise<void> {
  const { dropped, shifted } = await resolveOverlapsInteractive();

  const pendingGeoWishes = fetchPendingGeoWishes();
  if (pendingGeoWishes.length > 0) {
    await injectGeoStopsIfOnRoute(pendingGeoWishes);
  }

  try {
    applyGapFillTravelLegs();
  } catch {
    /* soft */
  }

  applyPlanReminderMatrix();

  // Wecker erst JETZT — rückwärts von der ersten Abfahrt, nie die Los-Uhrzeit selbst.
  try {
    await armWakeFromFirstLeaveBy();
  } catch (err) {
    console.warn('[module5] plan-end wake failed', err);
  }

  // Flug/Checkout-Puffer aus timeBufferPolicy (Logistik)
  try {
    const { assessTimeBuffer } = await import(
      '../../services/planning/timeBufferPolicy'
    );
    const { getPlanTripPrefsSync } = await import('./planTripPrefs');
    const prefs = getPlanTripPrefsSync();
    for (const s of useFuturePlanStore.getState().plan.stops) {
      if (s.kind === 'nav_leg' || s.kind === 'wish') continue;
      const blob = `${s.title} ${s.notes ?? ''}`;
      if (!/\b(flug|flieger|abflug|check-?out|boarding)\b/i.test(blob)) continue;
      const kind = /\b(flug|flieger|abflug|boarding)\b/i.test(blob)
        ? 'flight_commercial'
        : 'hotel_checkout';
      const assessed = assessTimeBuffer({
        kind: kind as 'flight_commercial' | 'hotel_checkout',
        text: blob,
        userPreferredMin: prefs.extraWakeBufferMin ?? undefined,
      });
      if (assessed?.minutes && s.plannedStartMs) {
        const leaveMs = s.plannedStartMs - assessed.minutes * 60_000;
        useFuturePlanStore.getState().upsertStop({
          ...s,
          bufferMin: Math.max(s.bufferMin || 0, assessed.minutes),
          notes: [s.notes, assessed.reason].filter(Boolean).join(' · ').slice(0, 200),
        });
        if (assessed.askUserSpeech) {
          usePlanCalendarUiStore.getState().setMirroredActions([
            ...usePlanCalendarUiStore.getState().mirroredActions,
            {
              type: 'SET_WAKE_ALARM',
              label: '⏰ Wecker',
              payload: {
                destName: `Los zu ${s.title}`.slice(0, 40),
                timeLabel: new Date(leaveMs).toLocaleTimeString('de-DE', {
                  hour: '2-digit',
                  minute: '2-digit',
                }),
              },
            },
          ]);
        }
      }
    }
  } catch {
    /* soft */
  }

  // Bei echten Rest-Konflikten optional Pro-Slot (Geld-Deckel)
  if (hasTimeOverlap()) {
    try {
      const { tryConsumePlanProSlot } = await import('./planProScore');
      if (tryConsumePlanProSlot('final_conflict')) {
        const { runPlanAgentFollowUp } = await import('./planAgentSession');
        const dayKey = useFuturePlanStore.getState().plan.dayKey;
        const fix = await runPlanAgentFollowUp({
          userText:
            'Final-Konflikt: Timeline hat noch Überlappungen. Schlage minimale Fixes vor und setze Tools.',
          dayKey,
          event: 'final_conflict',
        });
        if (fix.speech) {
          enqueueSpeech({
            kind: 'main',
            text: sanitizePlanSpeech(fix.speech),
            turnId: `m5_final_cf_${Date.now()}`,
          });
        }
      }
    } catch {
      /* soft */
    }
  }

  // Per-Stop: Speisekarte/Termin-Links nachziehen wo fehlend
  for (const node of useFuturePlanStore.getState().plan.stops) {
    if (node.kind !== 'stop' || node.id.startsWith('choice_')) continue;
    const title = node.title;
    let changed = false;
    let menuUrl = node.menuUrl ?? null;
    let reserveUrl = node.reserveUrl ?? null;
    if (
      !menuUrl &&
      /restaurant|burger|pizza|osteria|trattoria|bistro/i.test(title) &&
      !/bar|kneipe|pub|museum|ticket/i.test(title)
    ) {
      // Kein Fake-Google-Account-Link — nur wenn noch keine echte URL
      menuUrl = null;
    }
    if (!reserveUrl) {
      if (/friseur|haar|salon|barber/i.test(title)) {
        reserveUrl = `https://www.google.com/search?q=${encodeURIComponent(`${title} Termin buchen`)}`;
        changed = true;
      } else if (
        /restaurant|burger|pizza|osteria|trattoria|café|cafe|essen/i.test(title)
      ) {
        reserveUrl = `https://www.google.com/search?q=${encodeURIComponent(`${title} Tisch reservieren`)}`;
        changed = true;
      }
    }
    if (changed) {
      useFuturePlanStore.getState().upsertStop({
        ...node,
        menuUrl,
        reserveUrl,
      });
    }
  }

  const taxiLegs = useFuturePlanStore
    .getState()
    .plan.stops.filter(
      (s) =>
        s.kind === 'nav_leg' &&
        (s.transport === 'taxi' || s.transport === 'car'),
    );
  const transitLegs = useFuturePlanStore
    .getState()
    .plan.stops.filter(
      (s) => s.kind === 'nav_leg' && s.transport === 'transit',
    );

  const parts: string[] = ['Plan steht.'];
  if (dropped.length > 0) {
    parts.push(
      `Raus: ${dropped
        .slice(0, 2)
        .map((t) => t.replace(/^[🥇🥈📌📍✨🏁🔔]\s*/u, ''))
        .join(', ')}.`,
    );
  }
  if (shifted.length > 0) {
    parts.push(
      `Verschoben: ${shifted
        .slice(0, 2)
        .map((t) => t.replace(/^[🥇🥈📌📍✨🏁🔔]\s*/u, ''))
        .join(', ')}.`,
    );
  }
  parts.push(
    'Unter den Stops: Maps, Speisekarte, Termin/Tisch. Wege in der Timeline checken.',
  );

  enqueueSpeech({
    kind: 'main',
    text: sanitizePlanSpeech(parts.join(' ')),
    turnId: `m5_final_${Date.now()}`,
  });
  showFinalActionCards({
    hasTaxi: taxiLegs.length > 0,
    hasTransit: transitLegs.length > 0,
  });
}
