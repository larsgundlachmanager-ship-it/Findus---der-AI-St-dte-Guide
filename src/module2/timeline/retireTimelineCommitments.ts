/**
 * Timeline ist SSOT: gelöscht/erledigt → keine OS-Erinnerung, kein Task, kein Thread.
 * Keine Orts-Hardcodes — Hint/Stop kommen aus dem Plan.
 */

import type { FuturePlanStop } from './futurePlanState';
import { useFuturePlanStore } from './futurePlanState';
import { useShoppingTaskStore } from '../../store/useShoppingTaskStore';
import { useLogisticsTriggerStore } from '../../store/useLogisticsTriggerStore';
import { useSessionPlanStore } from '../../store/useSessionPlanStore';

const retiringIds = new Set<string>();
const clearingFlightIdents = new Set<string>();

export function isWakePlanStop(stop: {
  id: string;
  title?: string;
  emoji?: string;
}): boolean {
  return (
    stop.id.startsWith('wake_') ||
    /^wecker/i.test(stop.title ?? '') ||
    stop.emoji === '⏰'
  );
}

export function flightIdentFromStopId(id: string): string | null {
  if (!id.startsWith('ft:')) return null;
  const ident = id.split(':')[1]?.trim();
  return ident ? ident.toUpperCase() : null;
}

/**
 * Anreise-/Offen-Slots (ÖPNV-Beine, Taxi-Wahl, Hotel?) — Löschen darf den
 * Flug-Trip nicht mitreißen. Cascade nur bei Kern-Stops (Abflug/Gate/…).
 */
export function isFlightAccessOrOpenStopId(id: string): boolean {
  return /^ft:[^:]+:(leave|leg\d+|taxiopt|oepnvopt|xfer\w*|transit|access|hotel|car)$/i.test(
    id,
  );
}

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

function hintHitsText(hint: string, ...parts: Array<string | null | undefined>): boolean {
  const q = norm(hint);
  if (q.length < 2) return false;
  const hay = norm(parts.filter(Boolean).join(' '));
  if (!hay) return false;
  if (hay.includes(q) || q.includes(hay)) return true;
  const qTok = q.split(' ').filter((w) => w.length >= 4);
  return qTok.some((w) => hay.includes(w));
}

function allPlanStops(): FuturePlanStop[] {
  const store = useFuturePlanStore.getState();
  const seen = new Set<string>();
  const out: FuturePlanStop[] = [];
  const consider = (s: FuturePlanStop) => {
    if (seen.has(s.id)) return;
    seen.add(s.id);
    out.push(s);
  };
  for (const s of store.plan.stops) consider(s);
  for (const day of Object.values(store.plansByDay)) {
    for (const s of day.stops) consider(s);
  }
  return out;
}

async function cancelNotif(id: string): Promise<void> {
  try {
    const { cancelReminderById } = await import(
      '../../services/notifications/notificationService'
    );
    await cancelReminderById(id);
  } catch {
    /* soft */
  }
}

function cancelLogisticsForStop(stop: FuturePlanStop): string[] {
  const cancelled: string[] = [];
  try {
    const log = useLogisticsTriggerStore.getState();
    for (const e of log.events) {
      if (e.status !== 'active') continue;
      const metaStop =
        e.meta && typeof e.meta.stopId === 'string' ? e.meta.stopId : null;
      const timeHit =
        stop.plannedStartMs != null &&
        e.atMs != null &&
        Math.abs(e.atMs - stop.plannedStartMs) < 3 * 60_000;
      const kindHit =
        (isWakePlanStop(stop) && e.kind === 'alarm') ||
        (stop.transport === 'flight' && e.kind === 'flight') ||
        (stop.transport === 'transit' &&
          (e.kind === 'train' || e.kind === 'bus'));
      const hit =
        e.id === stop.id ||
        e.externalId === stop.id ||
        metaStop === stop.id ||
        e.id.includes(stop.id) ||
        (kindHit && timeHit) ||
        hintHitsText(stop.title, e.title, e.detail);
      if (!hit) continue;
      log.cancelEvent(e.id);
      cancelled.push(e.id);
      void cancelNotif(`logistics:${e.id}`);
    }
  } catch {
    /* soft */
  }
  return cancelled;
}

function completeShoppingForStop(stop: FuturePlanStop): string[] {
  const done: string[] = [];
  try {
    const shop = useShoppingTaskStore.getState();
    const geoId = stop.id.startsWith('geo_') ? stop.id.slice(4) : null;
    for (const t of shop.getOpenTasks()) {
      const hit =
        t.id === geoId ||
        t.id === stop.planTaskId ||
        stop.id === `wish_${t.id}` ||
        hintHitsText(t.itemLabel, stop.title, stop.notes) ||
        hintHitsText(stop.title, t.itemLabel);
      if (!hit) continue;
      shop.completeTask(t.id);
      done.push(t.id);
    }
  } catch {
    /* soft */
  }
  return done;
}

function closeThreadsForHint(hint: string): number {
  try {
    const { closeThreadsMatchingHint } = require('../../services/memory/conversationThreads') as {
      closeThreadsMatchingHint: (h: string) => number;
    };
    return closeThreadsMatchingHint(hint);
  } catch {
    return 0;
  }
}

async function silenceWake(wakeAtMs: number): Promise<void> {
  try {
    const { silenceWakeSideEffects } = await import(
      '../../services/alarms/nativeAlarmBridge'
    );
    await silenceWakeSideEffects(wakeAtMs);
  } catch {
    /* soft */
  }
}

function dropFlightWatch(ident: string): void {
  try {
    const { removeFlightWatchByIdent } = require('../../services/flights/flightWatchStore') as {
      removeFlightWatchByIdent: (id: string) => boolean;
    };
    removeFlightWatchByIdent(ident);
  } catch {
    /* soft */
  }
}

function dropSessionPlanIfOrphan(): void {
  try {
    const session = useSessionPlanStore.getState();
    const plan = session.getActivePlan();
    if (!plan) return;
    const live = useFuturePlanStore.getState().plan.stops.filter(
      (s) => s.status !== 'done' && s.kind !== 'nav_leg',
    );
    const undone = plan.stops.filter((s) => !s.done);
    if (!undone.length) {
      session.clearPlan();
      return;
    }
    const still =
      live.length > 0 &&
      undone.some((u) =>
        live.some(
          (s) =>
            s.id === u.id || hintHitsText(u.label, s.title, s.notes),
        ),
      );
    if (!still) session.clearPlan();
  } catch {
    /* soft */
  }
}

/**
 * Side-effects eines gelöschten Timeline-Stops killen.
 * Nicht wieder removePlanStop für denselben Stop — Caller hat ihn schon entfernt.
 */
export function retireCommitmentsForStop(stop: FuturePlanStop): void {
  if (!stop?.id || retiringIds.has(stop.id)) return;
  retiringIds.add(stop.id);
  try {
    const logistics = cancelLogisticsForStop(stop);
    const shop = completeShoppingForStop(stop);
    const threads = stop.title ? closeThreadsForHint(stop.title) : 0;
    void cancelNotif(`wake:${stop.plannedStartMs ?? ''}`);
    void cancelNotif(`transit:${stop.id}`);
    void cancelNotif(`leave:${stop.id}`);
    void cancelNotif(`logistics:${stop.id}`);

    if (isWakePlanStop(stop) && stop.plannedStartMs != null) {
      void silenceWake(stop.plannedStartMs);
    }

    const ident = flightIdentFromStopId(stop.id);
    if (
      ident &&
      !isFlightAccessOrOpenStopId(stop.id) &&
      !clearingFlightIdents.has(ident)
    ) {
      clearingFlightIdents.add(ident);
      try {
        dropFlightWatch(ident);
        const siblings = allPlanStops().filter(
          (s) => s.id !== stop.id && s.id.startsWith(`ft:${ident}:`),
        );
        for (const s of siblings) {
          try {
            useFuturePlanStore.getState().removeStop(s.id);
          } catch {
            /* soft */
          }
          retireCommitmentsForStop(s);
        }
      } finally {
        clearingFlightIdents.delete(ident);
      }
    }

    if (stop.groupId === 'live_journey' || stop.transport === 'transit') {
      try {
        const { clearCatchMyBusReminder } = require('../../services/transit/catchMyBusReminder') as {
          clearCatchMyBusReminder: () => void;
        };
        clearCatchMyBusReminder();
      } catch {
        /* soft */
      }
    }

    dropSessionPlanIfOrphan();
  } finally {
    retiringIds.delete(stop.id);
  }
}

export function retireCommitmentsForStops(stops: FuturePlanStop[]): void {
  for (const s of stops) retireCommitmentsForStop(s);
}

/** Voice: Task erledigt / gefunden → Task tot + Geo-Stop tot + Thread tot. */
export function retireCommitmentsForHint(hint: string): {
  tasks: number;
  stops: number;
  threads: number;
} {
  const q = hint.replace(/\s+/g, ' ').trim();
  let tasks = 0;
  let stops = 0;
  const threads = q.length >= 2 ? closeThreadsForHint(q) : 0;
  try {
    const shop = useShoppingTaskStore.getState();
    const open = shop.getOpenTasks();
    const matches = q.length < 2
      ? open.slice(0, 1)
      : open.filter(
          (t) =>
            hintHitsText(q, t.itemLabel) || hintHitsText(t.itemLabel, q),
        );
    for (const t of matches) {
      shop.completeTask(t.id);
      tasks += 1;
      const linked = allPlanStops().filter(
        (s) =>
          s.id === `geo_${t.id}` ||
          s.id === `wish_${t.id}` ||
          s.planTaskId === t.id ||
          hintHitsText(t.itemLabel, s.title, s.notes),
      );
      for (const s of linked) {
        try {
          const { removePlanStop } = require('./planLiveEdits') as {
            removePlanStop: (id: string, opts?: { gapFill?: boolean }) => boolean;
          };
          if (removePlanStop(s.id, { gapFill: false })) stops += 1;
        } catch {
          try {
            useFuturePlanStore.getState().removeStop(s.id);
            retireCommitmentsForStop(s);
            stops += 1;
          } catch {
            /* soft */
          }
        }
      }
    }
  } catch {
    /* soft */
  }
  return { tasks, stops, threads };
}

export function retireForegroundTopic(): boolean {
  try {
    const { closeForegroundThread } = require('../../services/memory/conversationThreads') as {
      closeForegroundThread: (reason?: string) => boolean;
    };
    const ok = closeForegroundThread('user_retired');
    return ok;
  } catch {
    return false;
  }
}
