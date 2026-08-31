/**
 * Offene Planungs-Wünsche / Choice-Karten verwerfen,
 * wenn der Kalender länger als 30 Min geschlossen war
 * oder 30 Min keine Interaktion (auch bei offenem Kalender).
 * Vergangene offene Slots werden ebenfalls entfernt.
 */

import { useFuturePlanStore } from '../timeline/futurePlanState';
import { usePlanCalendarUiStore } from '../timeline/planCalendarUiStore';
import { usePlanSessionStore } from './planSessionState';
import { todayDateKey } from '../../utils/dateKeys';

export const STALE_PLAN_CLOSED_MS = 30 * 60_000;

function isStaleOpenStop(
  s: { id: string; kind?: string; status?: string; plannedStartMs?: number | null },
  nowMs: number,
): boolean {
  if (s.kind === 'wish') return true;
  if (s.id.startsWith('choice_')) return true;
  if (s.id.startsWith('wish_')) return true;
  if (s.status === 'pending_change' && s.plannedStartMs != null) {
    if (s.plannedStartMs < nowMs - 5 * 60_000) return true;
  }
  return false;
}

export function purgeStaleOpenPlans(reason = 'calendar_closed_30m'): {
  removed: number;
} {
  const store = useFuturePlanStore.getState();
  const nowMs = Date.now();
  const today = todayDateKey();
  let removed = 0;

  const purgeDay = (dayKey: string, stops: typeof store.plan.stops) => {
    if (dayKey < today) {
      const openOnly = stops.filter((s) => isStaleOpenStop(s, nowMs));
      removed += openOnly.length;
      return stops.filter((s) => !isStaleOpenStop(s, nowMs));
    }
    const keep = stops.filter((s) => {
      if (!isStaleOpenStop(s, nowMs)) return true;
      removed += 1;
      return false;
    });
    return keep;
  };

  const cur = store.plan;
  const nextStops = purgeDay(cur.dayKey, cur.stops);
  if (removed > 0 || nextStops.length !== cur.stops.length) {
    store.setPlan({
      ...cur,
      stops: nextStops,
      updatedAtMs: Date.now(),
    });
  }

  for (const [dayKey, plan] of Object.entries(store.plansByDay)) {
    if (dayKey === cur.dayKey) continue;
    const kept = purgeDay(dayKey, plan.stops);
    if (kept.length !== plan.stops.length) {
      useFuturePlanStore.getState().setPlan({
        ...plan,
        stops: kept,
        updatedAtMs: Date.now(),
      });
    }
  }

  if (removed > 0 && __DEV__) {
    console.log(`[planning] purged ${removed} stale open items (${reason})`);
  }
  try {
    usePlanCalendarUiStore.getState().clearPendingChoice();
    usePlanCalendarUiStore.getState().clearShortAnswers();
    usePlanCalendarUiStore.getState().clearMirroredActions();
  } catch {
    /* soft */
  }
  try {
    const sess = usePlanSessionStore.getState();
    if (sess.waitingConfirm) sess.resolveConfirm(false);
    if (sess.waitingLocation) sess.resolveLocation('');
    if (sess.waitingConflict) sess.resolveConflict(false);
    sess.reset();
  } catch {
    /* soft */
  }
  return { removed };
}

/** Aufruf wenn Kalender geschlossen wird oder beim Re-Open-Check. */
export function noteCalendarHidden(): void {
  usePlanCalendarUiStore.getState().markCalendarHidden();
}

export function noteCalendarShown(): void {
  const ui = usePlanCalendarUiStore.getState();
  const hiddenAt = ui.calendarHiddenAtMs;
  ui.clearCalendarHidden();
  ui.touchPlanInteraction();
  if (hiddenAt != null && Date.now() - hiddenAt >= STALE_PLAN_CLOSED_MS) {
    purgeStaleOpenPlans('reopen_after_30m');
  }
}

/** Periodischer Check (HomeScreen / Tick) — auch ohne Re-Open, auch bei offenem Kalender. */
export function maybePurgeStalePlansWhileHidden(): void {
  const ui = usePlanCalendarUiStore.getState();
  const now = Date.now();
  const last = ui.lastPlanInteractionAtMs ?? ui.requestedDayAtMs ?? 0;
  const idleMs = last > 0 ? now - last : STALE_PLAN_CLOSED_MS + 1;

  if (ui.calendarVisible) {
    if (idleMs >= STALE_PLAN_CLOSED_MS) {
      purgeStaleOpenPlans('idle_30m_open');
      ui.touchPlanInteraction();
    }
    return;
  }

  const hiddenAt = ui.calendarHiddenAtMs;
  if (hiddenAt == null) return;
  if (now - hiddenAt < STALE_PLAN_CLOSED_MS) return;
  purgeStaleOpenPlans('hidden_30m_tick');
  ui.clearCalendarHidden();
}
