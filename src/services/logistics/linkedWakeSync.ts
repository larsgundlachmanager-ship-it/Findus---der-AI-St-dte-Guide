/**
 * Verknüpften Wecker an neuen Leave-by anpassen (Verspätung / Ausfall → später schlafen).
 * Native Bridge kann Wecker ändern (replace).
 */

import { useLogisticsTriggerStore } from '../../store/useLogisticsTriggerStore';

function metaNum(
  meta: Record<string, string | number | boolean | null> | undefined,
  key: string,
): number | null {
  const v = meta?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function metaStr(
  meta: Record<string, string | number | boolean | null> | undefined,
  key: string,
): string | null {
  const v = meta?.[key];
  return typeof v === 'string' && v.trim() ? v : null;
}

/**
 * Leave-by hat sich geändert → Wecker um denselben Prep-Abstand nachziehen.
 * @returns neuer wakeAtMs oder null
 */
export async function syncLinkedWakeToLeaveBy(opts: {
  eventId: string;
  newLeaveByMs: number;
  /** Optional: morgen erklären (Ausfall über Nacht) */
  morningNote?: string | null;
}): Promise<{ adjusted: boolean; wakeAtMs: number | null }> {
  const event = useLogisticsTriggerStore
    .getState()
    .events.find((e) => e.id === opts.eventId);
  if (!event) return { adjusted: false, wakeAtMs: null };

  const linkedWake = metaNum(event.meta, 'linkedWakeAtMs');
  const oldLeave = metaNum(event.meta, 'leaveByMs');
  if (
    linkedWake == null ||
    oldLeave == null ||
    !Number.isFinite(opts.newLeaveByMs)
  ) {
    return { adjusted: false, wakeAtMs: null };
  }

  const prepMs = Math.max(5 * 60_000, oldLeave - linkedWake);
  const newWake = opts.newLeaveByMs - prepMs;
  if (newWake < Date.now() + 60_000) {
    return { adjusted: false, wakeAtMs: null };
  }
  if (Math.abs(newWake - linkedWake) < 90_000) {
    return { adjusted: false, wakeAtMs: linkedWake };
  }

  const reason =
    metaStr(event.meta, 'wakeReason') || `Aufstehen für ${event.title}`;

  try {
    const { setWakeAlarmWithBridge } = await import(
      '../alarms/nativeAlarmBridge'
    );
    await setWakeAlarmWithBridge({
      wakeAtMs: newWake,
      reasonLabel: reason,
      leaveByMs: opts.newLeaveByMs,
      reminderKey: `wake_linked:${event.id}`,
      preferNative: true,
      wakeMode: 'replace',
    });
    const { registerWakeRhythm } = await import('./logisticsTriggerEngine');
    registerWakeRhythm({
      wakeAtMs: newWake,
      reasonLabel: reason,
      leaveByMs: opts.newLeaveByMs,
      linkedEventId: event.id,
    });

    useLogisticsTriggerStore.getState().upsertEvent({
      id: event.id,
      kind: event.kind,
      title: event.title,
      detail: event.detail,
      atMs: event.atMs,
      lat: event.lat,
      lng: event.lng,
      status: 'active',
      externalId: event.externalId,
      meta: {
        ...(event.meta ?? {}),
        linkedWakeAtMs: newWake,
        leaveByMs: opts.newLeaveByMs,
        ...(opts.morningNote
          ? { pendingWakeMorningNote: opts.morningNote }
          : {}),
      },
    });

    if (opts.morningNote) {
      try {
        const { scheduleNiceInfoPushAt } = await import(
          '../notifications/niceInfoNotifications'
        );
        void scheduleNiceInfoPushAt({
          fireAtMs: newWake + 45_000,
          title: 'Yorro · Bahn angepasst',
          body: opts.morningNote,
          dataKey: `wake-morning-${event.id}-${Math.floor(newWake / 60_000)}`,
        });
      } catch {
        /* soft */
      }
    }

    return { adjusted: true, wakeAtMs: newWake };
  } catch (err) {
    console.warn('[linkedWakeSync] failed', err);
    return { adjusted: false, wakeAtMs: null };
  }
}

/** Fester Termin in Timeline (Prio 1–2) nach Leave-by → Wecker nicht still nach hinten schieben ohne Bescheid. */
export function hasHardAppointmentAfter(leaveByMs: number): boolean {
  try {
    const { useFuturePlanStore } = require('../../module2/timeline/futurePlanState') as {
      useFuturePlanStore: {
        getState: () => {
          plan: {
            stops: Array<{
              id: string;
              plannedStartMs?: number | null;
              planPriority?: number | null;
              hardAnchor?: boolean;
              kind?: string;
            }>;
          };
        };
      };
    };
    const stops = useFuturePlanStore.getState().plan.stops;
    return stops.some(
      (s) =>
        !s.id.startsWith('wake_') &&
        s.kind !== 'nav_leg' &&
        s.plannedStartMs != null &&
        s.plannedStartMs > leaveByMs &&
        s.plannedStartMs < leaveByMs + 6 * 60 * 60_000 &&
        ((s.planPriority != null && s.planPriority <= 2) || s.hardAnchor),
    );
  } catch {
    return false;
  }
}
