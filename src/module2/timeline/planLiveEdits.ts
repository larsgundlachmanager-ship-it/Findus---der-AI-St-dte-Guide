/**
 * Live-Plan-Edits → FuturePlanStore + Kalender.
 * Frische Änderungen: status `pending_change` → blaue Zeitachse.
 */

import {
  requestOpenPlanCalendar,
  usePlanCalendarUiStore,
} from './planCalendarUiStore';
import { applyGapFillTravelLegs } from './gapFillTravel';
import {
  useFuturePlanStore,
  type FuturePlanStop,
  type FuturePlanTransport,
} from './futurePlanState';
import { resolveTravelOrigin, scheduleRefineNavLegRoute } from './planTravelHelpers';
import { resolveDateKeyFromUserText, todayDateKey, dateKeyFromMs } from '../../utils/dateKeys';
import { isPastMs } from './planNowGuard';
import {
  describeExistingStop,
  detectExistingPlanEditIntent,
  findStopByTitleHint,
  resolveExistingPlanReference,
  resolvePlanStopsFromUtterance,
} from './planStopResolve';
import { isLiveNavLegId } from './liveTourSchedule';
import { retireCommitmentsForStop } from './retireTimelineCommitments';
import { looksLikeClearDayPlan } from '../planning/planEditDetect';

const FRESH_MS = 12_000;
let clearTimer: ReturnType<typeof setTimeout> | null = null;

const TRANSPORT_CYCLE: FuturePlanTransport[] = [
  'walk',
  'bike',
  'transit',
  'car',
  'taxi',
];

export type PlanEditResult = {
  handled: boolean;
  speech: string;
};

function openLive(): void {
  requestOpenPlanCalendar();
}

function scheduleClearFresh(): void {
  if (clearTimer) clearTimeout(clearTimer);
  clearTimer = setTimeout(() => {
    clearTimer = null;
    clearFreshHighlights();
  }, FRESH_MS);
}

/** Frische Edits → planned. Choice-Karten bleiben blau bis Bestätigen. */
export function clearFreshHighlights(): void {
  const { plan, setStopStatus } = useFuturePlanStore.getState();
  for (const s of plan.stops) {
    if (s.status !== 'pending_change') continue;
    if (s.id.startsWith('choice_')) continue;
    if (s.id.startsWith('ft:')) continue;
    setStopStatus(s.id, 'planned');
  }
}

export function markFresh(
  ids: string[],
  opts?: { openCalendar?: boolean },
): void {
  const { setStopStatus } = useFuturePlanStore.getState();
  for (const id of ids) {
    setStopStatus(id, 'pending_change');
  }
  scheduleClearFresh();
  if (opts?.openCalendar) openLive();
}

export function addPlanStop(input: {
  title: string;
  lat?: number;
  lng?: number;
  plannedStartMs?: number | null;
  plannedEndMs?: number | null;
  transport?: FuturePlanTransport;
  kind?: FuturePlanStop['kind'];
  hardAnchor?: boolean;
  notes?: string;
  id?: string;
  bufferMin?: number;
  emoji?: string;
  /** Default false — Timeline eintragen ohne Kalender aufzuklappen */
  openCalendar?: boolean;
  journeyDetail?: string | null;
  userFixedTime?: boolean;
  planPriority?: FuturePlanStop['planPriority'];
  groupId?: string | null;
  groupLabel?: string | null;
  mapsUrl?: string | null;
  menuUrl?: string | null;
  reserveUrl?: string | null;
  websiteUrl?: string | null;
}): FuturePlanStop {
  const store = useFuturePlanStore.getState();
  const id = input.id ?? `stop_${Date.now()}`;
  const stop: FuturePlanStop = {
    id,
    title: input.title.trim() || 'Neuer Stopp',
    lat: input.lat,
    lng: input.lng,
    plannedStartMs: input.plannedStartMs ?? null,
    plannedEndMs: input.plannedEndMs ?? null,
    bufferMin:
      input.bufferMin ?? (id.startsWith('ft:') ? 0 : 12),
    transport: input.transport ?? store.plan.transportDefault,
    hardAnchor: input.hardAnchor,
    notes: input.notes,
    kind: input.kind ?? 'stop',
    status: 'pending_change',
    emoji: input.emoji,
    journeyDetail: input.journeyDetail,
    userFixedTime: input.userFixedTime,
    planPriority: input.planPriority,
    groupId: input.groupId,
    groupLabel: input.groupLabel,
    mapsUrl: input.mapsUrl,
    menuUrl: input.menuUrl,
    reserveUrl: input.reserveUrl,
    websiteUrl: input.websiteUrl,
  };
  if (isPastMs(stop.plannedStartMs)) {
    return stop;
  }
  const dayKey =
    stop.plannedStartMs != null
      ? dateKeyFromMs(stop.plannedStartMs)
      : store.plan.dayKey;
  store.upsertStopOnDay(dayKey, stop);
  scheduleClearFresh();
  if (input.openCalendar) openLive();
  return stop;
}

export function removePlanStop(
  id: string,
  opts?: { gapFill?: boolean },
): boolean {
  const store = useFuturePlanStore.getState();
  const stop =
    store.plan.stops.find((s) => s.id === id) ??
    Object.values(store.plansByDay)
      .flatMap((p) => p.stops)
      .find((s) => s.id === id);
  if (!stop) return false;
  store.removeStop(id);
  try {
    retireCommitmentsForStop(stop);
  } catch {
    /* soft */
  }

  // Zugehörige Reminder / „Los zu …“-Nav mitlöschen (kein Ghost-Leave-By)
  const leftover = useFuturePlanStore.getState().plan.stops;
  for (const s of leftover) {
    if (s.id === `nav_remind_${id}`) {
      useFuturePlanStore.getState().removeStop(s.id);
      continue;
    }
    if (s.kind === 'nav_leg' && s.id.startsWith(`leave_${id}_`)) {
      useFuturePlanStore.getState().removeStop(s.id);
      continue;
    }
    if (s.kind !== 'nav_leg') continue;
    if (!/^(Los zu|Weg nach|Los\s*→)/i.test(s.title)) continue;
    const dest = s.title
      .replace(/^(Los zu|Weg nach|Los\s*→)\s*/i, '')
      .trim();
    if (
      dest &&
      stop.title &&
      (dest.toLowerCase() === stop.title.toLowerCase() ||
        stop.title.toLowerCase().includes(dest.toLowerCase().slice(0, 10)))
    ) {
      useFuturePlanStore.getState().removeStop(s.id);
    }
  }
  const live = useFuturePlanStore.getState().plan.stops;
  const stopIds = new Set(
    live.filter((s) => s.kind === 'stop').map((s) => s.id),
  );
  for (const s of live) {
    if (!s.id.startsWith('nav_remind_')) continue;
    const targetId = s.id.replace(/^nav_remind_/, '');
    if (!stopIds.has(targetId)) {
      useFuturePlanStore.getState().removeStop(s.id);
    }
  }

  // Pending choice / choice-Karten aufräumen wenn gelöscht
  const pending = usePlanCalendarUiStore.getState().pendingChoice;
  const clearsPending =
    !!pending &&
    (stop.kind === 'wish' ||
      id.startsWith('choice_') ||
      (stop.title &&
        pending.stepKey
          .toLowerCase()
          .includes(stop.title.toLowerCase().slice(0, 8))));
  if (clearsPending || id.startsWith('choice_')) {
    const stillChoices = useFuturePlanStore
      .getState()
      .plan.stops.filter((s) => s.id.startsWith('choice_'));
    if (clearsPending || stillChoices.length === 0) {
      if (clearsPending) {
        for (const s of [...useFuturePlanStore.getState().plan.stops]) {
          if (s.id.startsWith('choice_')) {
            useFuturePlanStore.getState().removeStop(s.id);
          }
        }
      }
      usePlanCalendarUiStore.getState().clearPendingChoice();
      usePlanCalendarUiStore.getState().clearShortAnswers();
      usePlanCalendarUiStore.getState().clearMirroredActions();
    }
  }

  const doGap =
    opts?.gapFill !== false &&
    stop.kind !== 'nav_leg' &&
    !id.startsWith('choice_');
  if (doGap) {
    try {
      applyGapFillTravelLegs();
    } catch {
      /* soft */
    }
  }
  const remaining = useFuturePlanStore
    .getState()
    .plan.stops.filter(
      (s) => s.kind !== 'nav_leg' && !s.id.startsWith('choice_'),
    )
    .slice(0, 3)
    .map((s) => s.id);
  if (remaining.length) markFresh(remaining);
  else openLive();
  if (isLiveNavLegId(id) || stop.groupId === 'live_journey') {
    const leftover = useFuturePlanStore
      .getState()
      .plan.stops.some(
        (s) => isLiveNavLegId(s.id) || s.groupId === 'live_journey',
      );
    if (!leftover) {
      try {
        const { clearLiveNavFromPlan } = require('./syncLiveNavToPlan') as {
          clearLiveNavFromPlan: (opts?: { abandon?: boolean }) => void;
        };
        clearLiveNavFromPlan({ abandon: true });
      } catch {
        /* soft */
      }
      try {
        const { clearMultiStopTour } = require('../../services/navigation/multiStopTour') as {
          clearMultiStopTour: () => void;
        };
        clearMultiStopTour();
      } catch {
        /* soft */
      }
    }
  }
  return true;
}

function canReorderPlanStop(s: {
  id: string;
  kind?: string;
  plannedStartMs?: number | null;
}): boolean {
  if (s.kind === 'nav_leg') return false;
  if (s.id === 'nav_live_active') return false;
  if (s.id.startsWith('choice_')) return false;
  return true;
}

/** Drag in der Timeline: Zeiten der verschobenen Stopps tauschen. */
export function reorderTimedPlanStops(fromId: string, toIndex: number): boolean {
  const store = useFuturePlanStore.getState();
  const movable = store.plan.stops.filter(canReorderPlanStop);
  const from = movable.findIndex((s) => s.id === fromId);
  if (from < 0) return false;
  const to = Math.max(0, Math.min(movable.length - 1, toIndex));
  if (from === to) return false;
  const next = [...movable];
  const [moved] = next.splice(from, 1);
  if (!moved) return false;
  next.splice(to, 0, moved);
  const slots = movable.map((s) => ({
    start: s.plannedStartMs,
    end: s.plannedEndMs,
  }));
  for (let i = 0; i < next.length; i++) {
    const s = next[i]!;
    const slot = slots[i]!;
    store.upsertStop({
      ...s,
      plannedStartMs: slot.start,
      plannedEndMs: slot.end,
      status: 'pending_change',
    });
  }
  try {
    applyGapFillTravelLegs();
  } catch {
    /* soft */
  }
  return true;
}

/** Alle Plan-Stops eines Tages weg + offene Choices zurücksetzen. */
export function clearDayPlan(dayKey?: string): PlanEditResult {
  const dk = dayKey ?? useFuturePlanStore.getState().plan.dayKey ?? todayDateKey();
  useFuturePlanStore.getState().ensureDay(dk);
  const snapshot = [...useFuturePlanStore.getState().getPlanForDay(dk).stops];
  useFuturePlanStore.getState().clearDay(dk);
  try {
    for (const s of snapshot) retireCommitmentsForStop(s);
  } catch {
    /* soft */
  }
  try {
    const { clearLiveNavFromPlan } = require('./syncLiveNavToPlan') as {
      clearLiveNavFromPlan: (opts?: { abandon?: boolean }) => void;
    };
    clearLiveNavFromPlan({ abandon: true });
  } catch {
    /* soft */
  }
  try {
    const ui = usePlanCalendarUiStore.getState();
    ui.clearPendingChoice();
    ui.clearShortAnswers();
    ui.clearMirroredActions();
  } catch {
    /* soft */
  }
  try {
    const { usePlanSessionStore } = require('../planning/planSessionState') as {
      usePlanSessionStore: { getState: () => { reset: () => void } };
    };
    usePlanSessionStore.getState().reset();
  } catch {
    /* soft */
  }
  try {
    const { useLivePitchStore } = require('../pitch/publishPitchUi') as {
      useLivePitchStore: { getState: () => { clear: (force?: boolean) => void } };
    };
    useLivePitchStore.getState().clear(true);
  } catch {
    /* soft */
  }
  openLive();
  return {
    handled: true,
    speech:
      'Plan für heute ist leer. Sag Bescheid, wenn wir neu starten.',
  };
}

/** Alle Stops mit klarem Titel-Treffer entfernen (inkl. zugehöriger Nav/Reminder). */
export function removeStopsMatchingTitle(hint: string): string[] {
  const removed: string[] = [];
  const q = hint.trim().toLowerCase();
  if (q.length < 2) return removed;
  const store = useFuturePlanStore.getState();
  const matches = store.plan.stops.filter((s) => {
    if (s.kind === 'nav_leg') return false;
    if (s.id.startsWith('choice_') || s.id.startsWith('wish_')) return false;
    const t = s.title.toLowerCase();
    // Strikt: exakt, oder klarer Contains — kein 12-Zeichen-Blind-Match
    return t === q || (q.length >= 3 && (t.includes(q) || q.includes(t)));
  });
  // Bei mehreren unterschiedlichen Titeln: nur exakte, sonst nichts (Caller fragt nach)
  const titles = [...new Set(matches.map((m) => m.title.toLowerCase()))];
  if (titles.length > 1) {
    const exact = matches.filter((m) => m.title.toLowerCase() === q);
    if (!exact.length) return removed;
    for (const s of exact) {
      if (removePlanStop(s.id, { gapFill: false })) removed.push(s.title);
    }
  } else {
    for (const s of matches) {
      if (removePlanStop(s.id, { gapFill: false })) removed.push(s.title);
    }
  }
  if (removed.length) {
    try {
      applyGapFillTravelLegs();
    } catch {
      /* soft */
    }
    openLive();
  }
  return removed;
}

/** Kandidaten zum Löschen — genau lesen, bei Unklarheit leer / mehrere. */
function resolveDeleteCandidates(hint: string): FuturePlanStop[] {
  const q = hint.trim();
  if (q.length < 2) return [];
  const scored = resolvePlanStopsFromUtterance(q, { minScore: 28, limit: 5 });
  if (scored.length) {
    const top = scored[0]!.score;
    // Nur klar führende Treffer — bei Kopf-an-Kopf nachfragen
    const leaders = scored.filter((s) => s.score >= top - 4);
    if (leaders.length === 1) return [leaders[0]!.stop];
    if (leaders.length > 1) return leaders.map((l) => l.stop);
  }
  const exact = findStopByTitleHint(q);
  return exact ? [exact] : [];
}

/** Action-Buttons: Duplikat streichen vs. verschieben. */
export function publishDuplicateResolveActions(title: string): void {
  const clean = title.trim() || 'Eintrag';
  usePlanCalendarUiStore.getState().setShortAnswers([
    {
      id: 'dup_drop',
      label: 'Direkt streichen',
      action: 'prompt',
      prompt: `Lösche alle Einträge „${clean}“ aus meinem Plan — ganz streichen, nicht verschieben.`,
    },
    {
      id: 'dup_move',
      label: 'Verschieben',
      action: 'prompt',
      prompt: `Verschiebe den doppelten Eintrag „${clean}“ auf eine freie Zeit.`,
    },
  ]);
  openLive();
}

export function reschedulePlanStop(
  id: string,
  opts: {
    plannedStartMs?: number | null;
    plannedEndMs?: number | null;
    deltaMin?: number;
    /** Nur wenn User diesen Fix-Termin explizit neu ansetzt */
    allowHardMove?: boolean;
  },
): boolean {
  const store = useFuturePlanStore.getState();
  const stop = store.plan.stops.find((s) => s.id === id);
  if (!stop || stop.kind === 'nav_leg') return false;

  try {
    const { isHardFixedStop } = require('../planning/planHardLock') as {
      isHardFixedStop: (s: typeof stop) => boolean;
    };
    if (isHardFixedStop(stop) && !opts.allowHardMove) {
      console.warn('[timeline] reschedule blocked — hard fixed', id);
      return false;
    }
  } catch {
    /* soft */
  }

  try {
    const { isRealityLockedStop, clampToFutureMs } = require('./planNowGuard') as {
      isRealityLockedStop: (s: typeof stop, now?: number) => boolean;
      clampToFutureMs: (
        ms: number | null | undefined,
        o?: { nowMs?: number; minAheadMs?: number },
      ) => number | null;
    };
    if (isRealityLockedStop(stop)) {
      console.warn('[timeline-now] reschedule blocked — reality locked', id);
      return false;
    }
    if (opts.plannedStartMs != null && !opts.allowHardMove) {
      opts = {
        ...opts,
        plannedStartMs: clampToFutureMs(opts.plannedStartMs),
      };
    }
  } catch {
    /* soft */
  }

  let start = opts.plannedStartMs;
  let end = opts.plannedEndMs;
  if (opts.deltaMin != null) {
    const base = stop.plannedStartMs ?? Date.now() + 30 * 60_000;
    start = base + opts.deltaMin * 60_000;
    if (stop.plannedEndMs != null && stop.plannedStartMs != null) {
      const dur = stop.plannedEndMs - stop.plannedStartMs;
      end = start + dur;
    } else if (stop.plannedEndMs != null) {
      end = stop.plannedEndMs + opts.deltaMin * 60_000;
    }
  }

  store.upsertStop({
    ...stop,
    plannedStartMs: start !== undefined ? start : stop.plannedStartMs,
    plannedEndMs: end !== undefined ? end : stop.plannedEndMs,
    status: 'pending_change',
  });
  try {
    applyGapFillTravelLegs();
  } catch {
    /* soft */
  }
  markFresh([id], { openCalendar: true });
  return true;
}

export function setStopTransport(
  id: string,
  transport: FuturePlanTransport,
): boolean {
  const store = useFuturePlanStore.getState();
  const stop = store.plan.stops.find((s) => s.id === id);
  if (!stop) return false;
  const emoji =
    transport === 'transit'
      ? '🚌'
      : transport === 'bike'
        ? '🚲'
        : transport === 'taxi'
          ? '🚕'
          : transport === 'car'
            ? '🚗'
            : stop.kind === 'nav_leg'
              ? '🚶'
              : stop.emoji;

  // Nav-Leg: nur diesen Weg umstellen + schnell neu rechnen — kein Full-Gap-Fill
  // (sonst überschreibt transportDefault die Wahl wieder)
  if (stop.kind === 'nav_leg') {
    const titleBase =
      stop.title.replace(/^(ÖPNV|Rad|Fußweg|Fahrt|Los)\s+(nach|zu)\s+/i, '') ||
      stop.title;
    const title =
      transport === 'transit'
        ? `ÖPNV nach ${titleBase}`
        : transport === 'bike'
          ? `Rad nach ${titleBase}`
          : transport === 'taxi' || transport === 'car'
            ? `Fahrt nach ${titleBase}`
            : `Fußweg nach ${titleBase}`;
    store.upsertStop({
      ...stop,
      transport,
      emoji,
      title,
      notes: undefined,
      journeyDetail: null,
      routeEstimate: 'fallback',
      status: 'pending_change',
    });
    try {
      usePlanCalendarUiStore.getState().markRouteComputing(id, true);
    } catch {
      /* soft */
    }
    void refineSingleNavLeg(id, transport);
    markFresh([id], { openCalendar: true });
    return true;
  }

  store.upsertStop({
    ...stop,
    transport,
    status: 'pending_change',
  });
  try {
    applyGapFillTravelLegs();
  } catch {
    /* soft */
  }
  markFresh([id], { openCalendar: true });
  return true;
}

async function refineSingleNavLeg(
  navId: string,
  transport: FuturePlanTransport,
): Promise<void> {
  const clearComputing = () => {
    try {
      usePlanCalendarUiStore.getState().markRouteComputing(navId, false);
    } catch {
      /* soft */
    }
  };
  try {
    const store = useFuturePlanStore.getState();
    const leg = store.plan.stops.find((s) => s.id === navId);
    if (!leg || leg.kind !== 'nav_leg') {
      clearComputing();
      return;
    }

    let from: { lat: number; lng: number } | null = null;
    let to: { lat: number; lng: number } | null =
      leg.lat != null && leg.lng != null
        ? { lat: leg.lat, lng: leg.lng }
        : null;
    let arriveAtMs: number | null = null;
    let prepBufferMin = 0;

    if (navId.startsWith('nav_here_')) {
      const toId = navId.slice('nav_here_'.length);
      const b = store.plan.stops.find((s) => s.id === toId);
      if (b?.lat != null && b.lng != null) {
        to = { lat: b.lat, lng: b.lng };
        arriveAtMs = b.plannedStartMs ?? null;
        prepBufferMin = b.bufferMin || 0;
      }
      const origin = resolveTravelOrigin({
        beforeMs: arriveAtMs ?? leg.plannedStartMs ?? null,
      });
      if (origin) from = { lat: origin.lat, lng: origin.lng };
    } else {
      const m = navId.match(/^nav_(.+)_([^_]+(?:_.+)?)$/);
      // Prefer last underscore split: nav_{fromId}_{toId}
      const parts = navId.startsWith('nav_')
        ? navId.slice(4).split('_')
        : [];
      // ids can contain underscores — match known stop ids
      if (parts.length >= 2) {
        for (let split = 1; split < parts.length; split++) {
          const fromId = parts.slice(0, split).join('_');
          const toId = parts.slice(split).join('_');
          const a = store.plan.stops.find((s) => s.id === fromId);
          const b = store.plan.stops.find((s) => s.id === toId);
          if (
            a?.lat != null &&
            a.lng != null &&
            b?.lat != null &&
            b.lng != null
          ) {
            from = { lat: a.lat, lng: a.lng };
            to = { lat: b.lat, lng: b.lng };
            arriveAtMs = b.plannedStartMs ?? null;
            prepBufferMin = b.bufferMin || 0;
            break;
          }
        }
      }
      void m;
    }
    if (!from) {
      const origin = resolveTravelOrigin({
        beforeMs: leg.plannedStartMs ?? null,
      });
      if (origin) from = { lat: origin.lat, lng: origin.lng };
    }
    if (!from || !to) {
      clearComputing();
      return;
    }

    scheduleRefineNavLegRoute({
      navId,
      from,
      to,
      arriveAtMs,
      prepBufferMin,
      transport,
    });
  } catch {
    clearComputing();
  }
}

export function cycleStopTransport(id: string): FuturePlanTransport | null {
  const stop = useFuturePlanStore.getState().plan.stops.find((s) => s.id === id);
  if (!stop) return null;
  const cur = stop.transport === 'unknown' ? 'walk' : stop.transport;
  const idx = TRANSPORT_CYCLE.indexOf(cur);
  const next =
    TRANSPORT_CYCLE[(idx >= 0 ? idx + 1 : 0) % TRANSPORT_CYCLE.length]!;
  setStopTransport(id, next);
  return next;
}

export function setPlanTransportDefault(
  transport: FuturePlanTransport,
): void {
  const store = useFuturePlanStore.getState();
  store.setTransportDefault(transport);
  try {
    applyGapFillTravelLegs();
  } catch {
    /* soft */
  }
  const ids = useFuturePlanStore
    .getState()
    .plan.stops.filter((s) => s.kind !== 'nav_leg')
    .map((s) => s.id);
  markFresh(ids, { openCalendar: true });
}

function parseClockToMs(utterance: string, dayBaseMs: number): number | null {
  const u = utterance.replace(/\s+/g, ' ').trim();
  // „von 14 auf 16“ / „von 14 Uhr auf 16 Uhr“ → Zielzeit
  const vonAuf = u.match(
    /\bvon\s+(\d{1,2})(?:[:.](\d{2}))?\s*(?:uhr\s*)?(?:auf|um)\s+(\d{1,2})(?:[:.](\d{2}))?\s*(?:uhr)?\b/i,
  );
  if (vonAuf) {
    const h = Number(vonAuf[3]);
    const min = vonAuf[4] != null ? Number(vonAuf[4]) : 0;
    if (Number.isFinite(h) && h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      const d = new Date(dayBaseMs);
      d.setHours(h, min, 0, 0);
      return d.getTime();
    }
  }
  // „auf 16 Uhr“ / „um 16 Uhr“ — letzte klare Zielzeit bevorzugen
  const targets = [
    ...u.matchAll(/\b(?:auf|um)\s+(\d{1,2})(?:[:.](\d{2}))?\s*uhr\b/gi),
  ];
  if (targets.length) {
    const last = targets[targets.length - 1]!;
    const h = Number(last[1]);
    const min = last[2] != null ? Number(last[2]) : 0;
    if (Number.isFinite(h) && h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      const d = new Date(dayBaseMs);
      d.setHours(h, min, 0, 0);
      return d.getTime();
    }
  }
  const m = u.match(/\b(?:um\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*uhr\b/i);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] != null ? Number(m[2]) : 0;
  if (!Number.isFinite(h) || h < 0 || h > 23 || min < 0 || min > 59) return null;
  const d = new Date(dayBaseMs);
  d.setHours(h, min, 0, 0);
  return d.getTime();
}

/** Sichtbarer / angeforderter Plan-Tag — nicht still auf heute springen. */
function lockPlanEditDay(preferred?: string | null): string {
  const req = usePlanCalendarUiStore.getState().requestedDayKey;
  const active = useFuturePlanStore.getState().plan.dayKey;
  const dk =
    (preferred && /^\d{4}-\d{2}-\d{2}$/.test(preferred) && preferred) ||
    (req && /^\d{4}-\d{2}-\d{2}$/.test(req) && req) ||
    (active && /^\d{4}-\d{2}-\d{2}$/.test(active) && active) ||
    todayDateKey();
  useFuturePlanStore.getState().ensureDay(dk);
  usePlanCalendarUiStore.getState().requestDayKey(dk);
  return dk;
}

/** Stop auf aktivem Tag oder in anderen Plan-Tagen finden und dorthin wechseln. */
function findEditableStopForUtterance(utterance: string): FuturePlanStop | null {
  const resolved = resolveExistingPlanReference(utterance);
  if (resolved.kind === 'match') return resolved.primary;
  const hintMatch = resolvePlanStopsFromUtterance(utterance, {
    minScore: 28,
    limit: 1,
  })[0]?.stop;
  if (hintMatch) return hintMatch;

  const store = useFuturePlanStore.getState();
  const activeKey = store.plan.dayKey;
  const dayKeys = Array.from(
    new Set([activeKey, ...Object.keys(store.plansByDay || {})]),
  );
  for (const dk of dayKeys) {
    if (dk === activeKey) continue;
    const dayStops = (store.plansByDay[dk]?.stops ?? []).filter(
      (s) =>
        s.kind !== 'nav_leg' &&
        !s.id.startsWith('choice_') &&
        !s.id.startsWith('nav_remind_') &&
        !s.id.startsWith('leave_'),
    );
    if (!dayStops.length) continue;
    // Temporär Tag aktivieren für Scoring
    store.ensureDay(dk);
    const hit =
      resolvePlanStopsFromUtterance(utterance, { minScore: 28, limit: 1 })[0]
        ?.stop ?? null;
    if (hit) {
      usePlanCalendarUiStore.getState().requestDayKey(dk);
      return hit;
    }
  }
  // Zurück auf vorherigen Tag wenn nichts
  store.ensureDay(activeKey);
  usePlanCalendarUiStore.getState().requestDayKey(activeKey);
  return null;
}

function parseTransport(utterance: string): FuturePlanTransport | null {
  const u = utterance.toLowerCase();
  if (/\bfahrrad|bike|rad\b/.test(u)) return 'bike';
  if (/\bzu\s*fu[ßs]|laufen|gehen|walk\b/.test(u)) return 'walk';
  if (/\bbus|bahn|öpnv|oepnv|tram|u-?bahn|s-?bahn\b/.test(u)) return 'transit';
  if (/\btaxi\b/.test(u)) return 'taxi';
  if (/\bauto|pkw|fahren\b/.test(u)) return 'car';
  if (/\bflug|flugzeug\b/.test(u)) return 'flight';
  return null;
}

export function applyPlanEditFromUtterance(utterance: string): PlanEditResult {
  const u = utterance.trim();
  if (!u) return { handled: false, speech: '' };
  const lower = u.toLowerCase();
  // Immer auf dem sichtbaren Plan-Tag bleiben (außer User nennt klar einen anderen)
  const lockedDay = lockPlanEditDay(null);
  const plan = useFuturePlanStore.getState().plan;
  const hasStops = plan.stops.some((s) => s.kind !== 'nav_leg');
  const dayBase =
    plan.stops.find((s) => s.plannedStartMs != null)?.plannedStartMs ??
    (() => {
      const [y, m, d] = lockedDay.split('-').map(Number);
      if (y && m && d) return new Date(y, m - 1, d, 12, 0, 0, 0).getTime();
      return Date.now();
    })();

  const softEdit = detectExistingPlanEditIntent(u);
  const wantsDelete =
    softEdit.wantsDelete ||
    /lösch|loesch|entfernen|streich|raus\s+damit|\bcancel\b|über\s+den\s+haufen|ueber\s+den\s+haufen/.test(
      lower,
    );
  const wantsClearAll = looksLikeClearDayPlan(u);
  const dayShiftKey = (() => {
    if (/\bguten\s+morgen\b|\bheut(?:e)?\s+morgen\b/.test(lower)) return null;
    if (/\b(übermorgen|uebermorgen)\b/.test(lower)) {
      return resolveDateKeyFromUserText(u);
    }
    if (/\bmorgen\b/.test(lower)) return resolveDateKeyFromUserText(u);
    if (/\bheute\b/.test(lower) && /\b(lieber|stattdessen|wechsel|für|auf)\b/.test(lower)) {
      return todayDateKey();
    }
    return null;
  })();
  const wantsMove =
    softEdit.wantsMove ||
    /verschieb|leg\s+.+?\s+(auf|um)|später\s+legen|spaeter\s+legen|früher\s+legen|frueher\s+legen|\+\s*15|\-\s*15/.test(
      lower,
    ) ||
    (/\b(änder|aender|ändern|aendern|setz|stell)\w*\b/.test(lower) &&
      /\b(auf|um|von)\s+\d{1,2}(?::\d{2})?\b/.test(lower)) ||
    (/(\bauf\s+\d{1,2}|\bum\s+\d{1,2}).*uhr/.test(lower) &&
      /verschieb|leg|setz|änder|aender/.test(lower)) ||
    (dayShiftKey != null &&
      /\b(verschieb|leg|setz|termin|stopp|eintrag|einkauf|museum|essen)\b/.test(
        lower,
      ));
  const wantsAdd =
    /hinzu(?:fügen|fuegen)?|ergänz\w*|ergaenz\w*|neuen?\s+stopp|pack\s+.+\s+dazu|füge?\s+.+\s+hinzu|fuege?\s+.+\s+hinzu|noch\s+mit\s+in|noch\s+dazu|dazu\s+noch|auch\s+noch|in\s+(?:mein(?:en?)?\s+)?(?:navi|plan|route)|danach\s+(?:noch\s+)?(?:zum|zur)/.test(
      lower,
    );
  const wantsTransport =
    /fortbewegung|verkehrsmittel|umstell(?:en)?\s+auf|wechsel(?:n)?\s+(?:auf|zu)\s+(?:fahrrad|bus|bahn|auto|zu\s*fu)/.test(
      lower,
    ) ||
    (/^(?:bitte\s+)?(?:alles\s+)?(?:mit\s+dem\s+)?(?:fahrrad|zu\s*fu[ßs]|bus|bahn|öpnv|auto|taxi)\b/.test(
      lower,
    ) &&
      hasStops);

  if (
    !wantsDelete &&
    !wantsMove &&
    !wantsAdd &&
    !wantsTransport &&
    !wantsClearAll
  ) {
    return { handled: false, speech: '' };
  }

  if (wantsClearAll) {
    return clearDayPlan(plan.dayKey);
  }

  const t = parseTransport(lower);

  if (wantsTransport && t && !wantsDelete && !wantsMove && !wantsAdd) {
    const titleHint =
      u.match(
        /(?:für|bei)\s+(.+?)(?:\s+(?:fahrrad|zu\s*fu|bus|bahn|auto|taxi|öpnv)|$)/i,
      )?.[1] ?? '';
    const stop = findStopByTitleHint(titleHint);
    if (stop) {
      setStopTransport(stop.id, t);
      lockPlanEditDay(lockedDay);
      return {
        handled: true,
        speech: `„${stop.title}“ läuft jetzt per ${t}.`,
      };
    }
    setPlanTransportDefault(t);
    lockPlanEditDay(lockedDay);
    return {
      handled: true,
      speech: `Fortbewegung auf ${t} umgestellt.`,
    };
  }

  if (wantsDelete) {
    // „Spot A / Spot B“ und ähnliche Platzhalter alle raus
    if (/\bspot\s*[ab]\b|\boption\s*[ab]\b/i.test(lower)) {
      const placeholders = plan.stops.filter(
        (s) =>
          s.kind !== 'nav_leg' &&
          /^(spot\s*[ab]|option\s*[ab]|erste idee|zweite idee)$/i.test(
            s.title.trim(),
          ),
      );
      if (placeholders.length) {
        for (const s of placeholders) removePlanStop(s.id, { gapFill: false });
        try {
          applyGapFillTravelLegs();
        } catch {
          /* soft */
        }
        return {
          handled: true,
          speech: `${placeholders.length} Platzhalter raus.`,
        };
      }
    }
    const afterMatch = u.match(
      /(?:lösch|loesch|entferne|streich)\w*\s+(?:den\s+|die\s+|das\s+|alle\s+)?(.+?)(?:\s+bitte)?$/i,
    );
    let cleanAfter = (afterMatch?.[1] ?? '')
      .replace(
        /\b(termine?|einträge|eintraege|stopps?|aus\s+dem\s+plan|komplett|ganz|bitte)\b/gi,
        '',
      )
      .trim();
    if (!cleanAfter && softEdit.wantsDelete) {
      cleanAfter = (
        u.match(
          /(?:brauch\s+(?:ich\s+)?nicht|doch\s+nicht|raus\s+damit)\s+(?:den\s+|die\s+|das\s+)?(.+)$/i,
        )?.[1] ?? ''
      )
        .replace(
          /\b(termine?|einträge|eintraege|stopps?|aus\s+dem\s+plan|komplett|ganz|bitte)\b/gi,
          '',
        )
        .trim();
    }

    // Mehrere Namen explizit genannt
    const multiHints = cleanAfter
      .split(/\s*(?:,| und |\/)\s*/i)
      .map((x) => x.trim())
      .filter((x) => x.length >= 2);
    if (multiHints.length > 1) {
      const removed: string[] = [];
      const unclear: string[] = [];
      for (const hint of multiHints) {
        const cands = resolveDeleteCandidates(hint);
        if (cands.length === 1) {
          if (removePlanStop(cands[0]!.id)) removed.push(cands[0]!.title);
        } else if (cands.length > 1) {
          unclear.push(hint);
        } else {
          unclear.push(hint);
        }
      }
      if (removed.length) {
        try {
          applyGapFillTravelLegs();
        } catch {
          /* soft */
        }
      }
      if (unclear.length && !removed.length) {
        return {
          handled: true,
          speech: `Unklar bei „${unclear.join(', ')}“ — welchen Eintrag genau streichen?`,
        };
      }
      if (removed.length) {
        return {
          handled: true,
          speech: unclear.length
            ? `Weg: ${[...new Set(removed)].join(', ')}. Bei „${unclear.join(', ')}“ sag mir den genauen Namen.`
            : `Weg: ${[...new Set(removed)].join(', ')}.`,
        };
      }
    }

    if (cleanAfter.length >= 2) {
      const cands = resolveDeleteCandidates(cleanAfter);
      if (cands.length > 1) {
        const names = [...new Set(cands.map((c) => c.title))].slice(0, 3);
        return {
          handled: true,
          speech: `Meinst du ${names.map((n) => `„${n}“`).join(' oder ')}? Sag den genauen Namen.`,
        };
      }
      if (cands.length === 1) {
        const stop = cands[0]!;
        removePlanStop(stop.id);
        return {
          handled: true,
          speech: `„${stop.title}“ ist raus — inkl. Erinnerung und Weg dorthin.`,
        };
      }
      // Kein Blind-Match auf den letzten Stop — erst verstehen
      return {
        handled: true,
        speech: `Ich finde keinen klaren Treffer für „${cleanAfter}“. Welchen Eintrag soll ich streichen?`,
      };
    }

    // Kein Ziel genannt → nachfragen, nie raten
    return {
      handled: true,
      speech: 'Welchen Eintrag soll ich löschen?',
    };
  }

  if (wantsMove) {
    const dayBaseForMove = (() => {
      if (dayShiftKey) {
        const [y, m, d] = dayShiftKey.split('-').map((x) => Number(x));
        if (y && m && d) return new Date(y, m - 1, d, 12, 0, 0, 0).getTime();
      }
      return dayBase;
    })();
    const clock = parseClockToMs(lower, dayBaseForMove);
    let deltaMin: number | undefined = softEdit.deltaMin;
    if (deltaMin == null) {
      if (/später|spaeter|\+\s*15|15\s*min(?:uten)?\s*später/.test(lower)) {
        deltaMin = 15;
      } else if (/früher|frueher|-\s*15/.test(lower)) {
        deltaMin = -15;
      } else if (/(\d+)\s*min/.test(lower)) {
        const n = Number(lower.match(/(\d+)\s*min/)?.[1]);
        if (Number.isFinite(n)) {
          deltaMin = /früher|frueher|zurück|zurueck/.test(lower) ? -n : n;
        }
      }
    }
    const titleHint =
      u.match(
        /(?:verschieb|leg|änder|aender)\w*\s+(?:den\s+|die\s+|das\s+)?(?:termine?\s+(?:des\s+|der\s+|vom\s+)?)?(.+?)(?:\s+(?:auf|um|nach|von|früher|frueher|später|spaeter|morgen|heute)\b)/i,
      )?.[1] ??
      u.match(
        /(?:den\s+|die\s+|das\s+)?(?:termin|stopp|eintrag|punkt|turnier)\s+(?:mit\s+(?:dem\s+|der\s+|dem\s+)?)?(.+?)(?:\s+(?:später|spaeter|früher|frueher|auf|um|von|morgen|heute)\b)/i,
      )?.[1] ??
      '';
    const resolved = resolveExistingPlanReference(u);
    const stop =
      (titleHint ? findStopByTitleHint(titleHint) : null) ??
      (resolved.kind === 'match' ? resolved.primary : null) ??
      findEditableStopForUtterance(u) ??
      resolvePlanStopsFromUtterance(u, { minScore: 30, limit: 1 })[0]?.stop ??
      null;
    if (!stop) {
      if (resolved.kind === 'ambiguous') {
        const labels = resolved.stops
          .slice(0, 3)
          .map((s) => describeExistingStop(s))
          .join(' oder ');
        lockPlanEditDay(lockedDay);
        return {
          handled: true,
          speech: `Welchen meinst du — ${labels}?`,
        };
      }
      lockPlanEditDay(lockedDay);
      return {
        handled: true,
        speech: 'Welchen Stopp soll ich verschieben?',
      };
    }
    if (clock != null) {
      const hard = (() => {
        try {
          const { isHardFixedStop } = require('../planning/planHardLock') as {
            isHardFixedStop: (s: typeof stop) => boolean;
          };
          return isHardFixedStop(stop);
        } catch {
          return false;
        }
      })();
      const ok = reschedulePlanStop(stop.id, {
        plannedStartMs: clock,
        allowHardMove: true,
      });
      lockPlanEditDay(dayShiftKey || lockedDay);
      if (!ok && hard) {
        return {
          handled: true,
          speech: `„${stop.title}“ ist ein fester Termin — sag mir die neue Uhrzeit klar, dann setz ich ihn um.`,
        };
      }
      const hm = `${String(new Date(clock).getHours()).padStart(2, '0')}:${String(new Date(clock).getMinutes()).padStart(2, '0')}`;
      return {
        handled: true,
        speech: `„${stop.title}“ steht jetzt auf ${hm}.`,
      };
    } else if (dayShiftKey && stop.plannedStartMs != null) {
      const prev = new Date(stop.plannedStartMs);
      const [y, m, d] = dayShiftKey.split('-').map((x) => Number(x));
      const next = new Date(y!, m! - 1, d!, prev.getHours(), prev.getMinutes(), 0, 0);
      const hard = (() => {
        try {
          const { isHardFixedStop } = require('../planning/planHardLock') as {
            isHardFixedStop: (s: typeof stop) => boolean;
          };
          return isHardFixedStop(stop);
        } catch {
          return false;
        }
      })();
      const ok = reschedulePlanStop(stop.id, {
        plannedStartMs: next.getTime(),
        allowHardMove: hard,
      });
      if (!ok) {
        return {
          handled: true,
          speech: hard
            ? `„${stop.title}“ bleibt fest — den Tag wechsle ich nur, wenn du das klar so willst.`
            : `Konnte „${stop.title}“ nicht verschieben.`,
        };
      }
      try {
        useFuturePlanStore.getState().ensureDay(dayShiftKey);
        usePlanCalendarUiStore.getState().requestDayKey(dayShiftKey);
      } catch {
        /* soft */
      }
    } else if (deltaMin != null) {
      const hard = (() => {
        try {
          const { isHardFixedStop } = require('../planning/planHardLock') as {
            isHardFixedStop: (s: typeof stop) => boolean;
          };
          return isHardFixedStop(stop);
        } catch {
          return false;
        }
      })();
      if (hard) {
        return {
          handled: true,
          speech: `„${stop.title}“ ist fest — den schieb ich nicht von allein. Sag eine konkrete neue Uhrzeit.`,
        };
      }
      reschedulePlanStop(stop.id, { deltaMin });
    } else {
      const hard = (() => {
        try {
          const { isHardFixedStop } = require('../planning/planHardLock') as {
            isHardFixedStop: (s: typeof stop) => boolean;
          };
          return isHardFixedStop(stop);
        } catch {
          return false;
        }
      })();
      if (hard) {
        return {
          handled: true,
          speech: `„${stop.title}“ ist ein fester Termin — wann soll er stattdessen sein?`,
        };
      }
      reschedulePlanStop(stop.id, { deltaMin: 15 });
    }
    if (t) setStopTransport(stop.id, t);
    return {
      handled: true,
      speech: `„${stop.title}“ hab ich zeitlich angepasst.`,
    };
  }

  if (wantsAdd) {
    const title =
      u.match(
        /(?:hinzu(?:fügen|fuegen)?|ergänz\w*|ergaenz\w*|pack|füg\w*|fueg\w*)\s+(?:noch\s+)?(?:einen?\s+)?(.+)$/i,
      )?.[1]?.trim() ?? '';
    const clean = title
      .replace(/^(den|die|das|einen|eine|ein)\s+/i, '')
      .replace(/\s+dazu$/i, '')
      .trim();
    if (!clean || clean.length < 2) {
      return {
        handled: true,
        speech: 'Was soll rein in den Plan?',
      };
    }
    const clock = parseClockToMs(lower, dayBase);
    addPlanStop({
      title: clean,
      plannedStartMs: clock,
      transport: t ?? undefined,
      kind: clock != null ? 'stop' : 'wish',
    });
    return {
      handled: true,
      speech: `„${clean}“ ist im Plan.`,
    };
  }

  return { handled: false, speech: '' };
}

/**
 * User spricht über schon eingetragene Punkte — ohne klassischen Edit-Verb-Pfad.
 * Verhindert Doppel-Ingest als neuer Plan.
 */
export function acknowledgeExistingPlanReference(
  utterance: string,
): PlanEditResult {
  const ref = resolveExistingPlanReference(utterance);
  if (ref.kind === 'none') return { handled: false, speech: '' };

  if (ref.kind === 'ambiguous') {
    const labels = ref.stops
      .slice(0, 3)
      .map((s) => describeExistingStop(s))
      .join(' · ');
    requestOpenPlanCalendar();
    return {
      handled: true,
      speech: `Da passen mehrere: ${labels}. Welchen meinst du?`,
    };
  }

  // Edit-Intent → durch normalen Edit-Pfad (bereits erweitert)
  if (ref.wantsEdit) {
    const edited = applyPlanEditFromUtterance(utterance);
    if (edited.handled) return edited;
  }

  const primary = ref.primary;
  markFresh([primary.id]);
  requestOpenPlanCalendar();
  return {
    handled: true,
    speech: `${describeExistingStop(primary)} steht schon im Plan — soll ich was davor/danach schieben?`,
  };
}

export function planStopIdFromTimelineNodeId(nodeId: string): string | null {
  if (nodeId.startsWith('plan_')) return nodeId.slice('plan_'.length);
  return null;
}
