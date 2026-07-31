/**
 * Plan vs. Ist — Verzug propagieren auf den Rest des Tages.
 */

import { useDayPlanStore } from '../../store/useDayPlanStore';
import {
  clockLabel,
  todayDateKey,
  type DayPlanItem,
} from '../../types/dayPlan';
import {
  recordVisitArrival,
  recordVisitDeparture,
  formatDelayLabel,
} from '../timeline/visitLog';

const SOFT_KINDS = new Set([
  'nav',
  'activity',
  'meal',
  'sunset',
  'breakfast',
  'pack',
  'checkout',
  'checkin',
  'buffer',
  'todo',
  'custom',
]);

/**
 * Verschiebt geplante Start/Enden aller späteren weichen Items um delayMs.
 * Harte Deadlines (hardDeadline) bleiben stehen — nur Notes/Badge.
 */
export function propagatePlanDelay(opts: {
  dateKey?: string;
  /** Item, das den Verzug ausgelöst hat */
  anchorItemId: string;
  /** Ist-Start − Plan-Start (positiv = Verspätung) */
  delayMs: number;
  reason?: string;
}): { shifted: number; delayMs: number } {
  const dateKey = opts.dateKey ?? todayDateKey();
  if (Math.abs(opts.delayMs) < 2 * 60_000) {
    return { shifted: 0, delayMs: opts.delayMs };
  }
  const store = useDayPlanStore.getState();
  const day = store.getDay(dateKey);
  const anchor = day.items.find((i) => i.id === opts.anchorItemId);
  if (!anchor?.startMs) return { shifted: 0, delayMs: opts.delayMs };

  const anchorPlanStart = anchor.startMs;
  let shifted = 0;
  const next = day.items.map((it) => {
    if (it.id === opts.anchorItemId) return it;
    if (it.hardDeadline) return it;
    if (!SOFT_KINDS.has(it.kind)) return it;
    if (it.startMs == null) return it;
    // Nur Zukunft relativ zum Anker-Plan
    if (it.startMs < anchorPlanStart - 60_000) return it;
    // Bereits gestartet/fertig → nicht anfassen
    if (it.status === 'done' || it.status === 'in_progress') return it;
    if (it.actualStartMs != null) return it;

    shifted += 1;
    const startMs = it.startMs + opts.delayMs;
    const endMs =
      it.endMs != null ? it.endMs + opts.delayMs : it.endMs;
    return {
      ...it,
      startMs,
      endMs,
      status: it.status === 'planned' ? ('moved' as const) : it.status,
      notes: [
        it.notes,
        `Plan verschoben (${formatDelayLabel(opts.delayMs) ?? 'Verzug'})`,
      ]
        .filter(Boolean)
        .join(' · '),
      meta: {
        ...(it.meta ?? {}),
        planShiftDelayMs: opts.delayMs,
        planShiftFromId: opts.anchorItemId,
      },
    };
  });

  if (shifted) {
    store.replaceItems(dateKey, next);
    store.addChange(dateKey, {
      summary: `Tagesplan um ${formatDelayLabel(opts.delayMs) ?? 'Verzug'} nachgezogen`,
      reason:
        opts.reason ??
        `Ist-Abweichung bei „${anchor.title}" (${clockLabel(anchorPlanStart)} → Ist)`,
      significant: Math.abs(opts.delayMs) >= 10 * 60_000,
    });
  }
  return { shifted, delayMs: opts.delayMs };
}

/** Nach Nav-Start: Verzug gegenüber geplantem Abmarsch-Slot. */
export function applyNavStartActual(opts: {
  dateKey?: string;
  name: string;
  lat?: number | null;
  lng?: number | null;
  atMs?: number;
}): void {
  const dateKey = opts.dateKey ?? todayDateKey();
  const at = opts.atMs ?? Date.now();
  const store = useDayPlanStore.getState();
  const day = store.getDay(dateKey);

  // Geplanter Abmarsch / Nav-Slot zum Ziel (noch ohne Ist)
  const planned = day.items.find(
    (i) =>
      i.timed &&
      i.startMs != null &&
      i.actualStartMs == null &&
      i.status === 'planned' &&
      (i.kind === 'nav' ||
        i.kind === 'transit' ||
        i.kind === 'taxi' ||
        i.kind === 'buffer') &&
      (i.placeName === opts.name ||
        i.title.toLowerCase().includes(opts.name.toLowerCase()) ||
        /los|abmarsch|leave|aufbruch/i.test(i.title)) &&
      Math.abs(i.startMs - at) < 6 * 60 * 60_000,
  );

  if (planned?.startMs != null && planned.id) {
    const delayMs = at - planned.startMs;
    if (planned.actualStartMs == null) {
      store.markItemActual(dateKey, planned.id, {
        status: 'in_progress',
        actualStartMs: at,
      });
    }
    if (Math.abs(delayMs) >= 2 * 60_000) {
      propagatePlanDelay({
        dateKey,
        anchorItemId: planned.id,
        delayMs,
        reason: `Abmarsch Ist ${clockLabel(at)} (Plan ${clockLabel(planned.startMs)})`,
      });
    }
  }
}

export function applyNavArriveActual(opts: {
  dateKey?: string;
  name: string;
  lat?: number | null;
  lng?: number | null;
  atMs?: number;
}): void {
  const dateKey = opts.dateKey ?? todayDateKey();
  const at = opts.atMs ?? Date.now();
  const store = useDayPlanStore.getState();
  const day = store.getDay(dateKey);
  const stay = day.items.find(
    (i) =>
      (i.kind === 'activity' || i.kind === 'meal') &&
      (i.placeName === opts.name || i.title.includes(opts.name)) &&
      (i.status === 'in_progress' || i.status === 'planned'),
  );
  const plannedArrive = stay?.startMs ?? null;
  if (stay?.startMs != null && stay.actualStartMs != null) {
    const delayMs = stay.actualStartMs - stay.startMs;
    if (Math.abs(delayMs) >= 2 * 60_000) {
      propagatePlanDelay({
        dateKey,
        anchorItemId: stay.id,
        delayMs,
        reason: `Ankunft Ist ${clockLabel(stay.actualStartMs)} (Plan ${clockLabel(stay.startMs)})`,
      });
    }
  }
  recordVisitArrival({
    name: opts.name,
    lat: opts.lat,
    lng: opts.lng,
    atMs: at,
    source: 'nav',
    plannedArriveMs: plannedArrive,
  });
}

export function applyPlaceLeftActual(opts: { name: string; atMs?: number }): void {
  recordVisitDeparture({ name: opts.name, atMs: opts.atMs });
}

/** Effektive Anzeigezeiten: Ist bevorzugt. */
export function effectiveTimes(item: DayPlanItem): {
  startMs: number | null;
  endMs: number | null;
  isActual: boolean;
  delayMs: number | null;
} {
  const start =
    item.actualStartMs != null ? item.actualStartMs : item.startMs;
  const end = item.actualEndMs != null ? item.actualEndMs : item.endMs;
  const delayMs =
    item.actualStartMs != null && item.startMs != null
      ? item.actualStartMs - item.startMs
      : null;
  return {
    startMs: start ?? null,
    endMs: end ?? null,
    isActual: item.actualStartMs != null || item.actualEndMs != null,
    delayMs,
  };
}
