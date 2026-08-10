/**
 * Native Alarm Bridge — Android AlarmManager.setAlarmClock (interner Systemwecker).
 * Fallback: Expo Local Notification.
 */

import { NativeModules, Platform } from 'react-native';
import { scheduleWakeAlarm } from '../notifications/notificationService';
import { dateKeyFromMs } from '../../utils/dateKeys';
import {
  useFuturePlanStore,
  type FuturePlanStop,
} from '../../module2/timeline/futurePlanState';

export type NativeAlarmResult = {
  ok: boolean;
  channel: 'native' | 'notification' | 'failed';
  wakeAtMs?: number;
  reason?: string;
  message?: string;
  /** true = User soll wählen: ersetzen vs. zweiten */
  needsChoice?: boolean;
  existingWakeAtMs?: number;
};

type NativeAlarmModule = {
  setAlarm: (
    hour: number,
    minute: number,
    message: string,
  ) => Promise<{
    ok: boolean;
    status: string;
    detail?: string;
    triggerAtMs?: number;
    requestCode?: number;
  }>;
  cancelAlarmAt?: (triggerAtMs: number) => Promise<boolean>;
};

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function wireWakeRhythm(opts: {
  wakeAtMs: number;
  reasonLabel: string;
  leaveByMs?: number | null;
}): void {
  try {
    const { registerWakeRhythm } = require('../logistics/logisticsTriggerEngine') as {
      registerWakeRhythm: (i: {
        wakeAtMs: number;
        reasonLabel: string;
        leaveByMs?: number | null;
      }) => void;
    };
    registerWakeRhythm({
      wakeAtMs: opts.wakeAtMs,
      reasonLabel: opts.reasonLabel,
      leaveByMs: opts.leaveByMs ?? null,
    });
  } catch {
    /* soft */
  }
}

function nativeModule(): NativeAlarmModule | null {
  const m = NativeModules.FindusAlarm as NativeAlarmModule | undefined;
  return m?.setAlarm ? m : null;
}

/** Offene Wecker-Stops am Tag (Timeline). */
export function listWakeStopsForDay(dayKey: string): FuturePlanStop[] {
  const plan = useFuturePlanStore.getState().getPlanForDay(dayKey);
  return (plan.stops ?? []).filter(
    (s) =>
      s.status !== 'done' &&
      (s.id.startsWith('wake_') ||
        /^wecker/i.test(s.title) ||
        s.emoji === '⏰'),
  );
}

export function findExistingWakeSameDay(wakeAtMs: number): FuturePlanStop | null {
  const dayKey = dateKeyFromMs(wakeAtMs);
  const wakes = listWakeStopsForDay(dayKey)
    .filter((s) => s.plannedStartMs != null)
    .sort((a, b) => (a.plannedStartMs ?? 0) - (b.plannedStartMs ?? 0));
  return wakes[0] ?? null;
}

function failMessage(reason?: string, detail?: string): string {
  switch (reason) {
    case 'permission':
      return 'Ich brauche Mitteilungen- und Alarm-Erlaubnis, sonst kann ich dich nicht wecken.';
    case 'disabled':
      return 'Mitteilungen sind in Findus aus — deshalb kann ich keinen Wecker stellen.';
    case 'too_soon':
      return 'Das ist zu knapp — nimm eine etwas spätere Zeit.';
    case 'ios_unsupported':
      return 'Auf dem iPhone nur Findus-Mitteilung — Mitteilungen bitte erlauben.';
    case 'no_handler':
      return 'Wecker ging nicht — erlaube unter Einstellungen → Apps → Findus → Alarme & Erinnerungen.';
    case 'bad_time':
      return 'Die Uhrzeit ist ungültig.';
    case 'error':
      return detail
        ? `Wecker ging schief: ${detail}`
        : 'Wecker lässt sich gerade nicht stellen.';
    default:
      return detail?.trim()
        ? `Wecker nicht gestellt: ${detail}`
        : 'Wecker lässt sich gerade nicht stellen.';
  }
}

function speechForNativeStatus(
  status: string | undefined,
  clock: string,
): string {
  switch (status) {
    case 'set_silent':
      return `Wecker auf ${clock} gestellt.`;
    case 'alarm_manager':
      return `Wecker auf ${clock} gestellt.`;
    default:
      return `Wecker auf ${clock} gestellt.`;
  }
}

export function recordWakeOnTimeline(opts: {
  wakeAtMs: number;
  reasonLabel: string;
  channel: 'native' | 'notification';
  /** Alten Wecker-Stop am selben Tag ersetzen */
  replaceStopId?: string | null;
}): void {
  const dayKey = dateKeyFromMs(opts.wakeAtMs);
  const stopId = `wake_${opts.wakeAtMs}`;
  if (opts.replaceStopId) {
    useFuturePlanStore.getState().ensureDay(dayKey);
    useFuturePlanStore.getState().removeStop(opts.replaceStopId);
  }
  const stop: FuturePlanStop = {
    id: stopId,
    title: `Wecker — ${opts.reasonLabel.trim() || 'Aufstehen'}`,
    plannedStartMs: opts.wakeAtMs,
    plannedEndMs: null,
    bufferMin: 0,
    transport: 'unknown',
    hardAnchor: true,
    kind: 'stop',
    status: 'trigger_active',
    emoji: '⏰',
    notes:
      opts.channel === 'native'
        ? 'Android-Systemwecker · in Timeline'
        : 'Findus-Mitteilung · in Timeline',
    planPriority: 2,
  };
  // Sicherstellen: Stop landet auf dem Wecker-Tag und UI zeigt denselben Tag
  useFuturePlanStore.getState().ensureDay(dayKey);
  useFuturePlanStore.getState().upsertStop(stop);
  try {
    const {
      requestOpenPlanCalendar,
      requestPlanScroll,
    } = require('../../module2/timeline/planCalendarUiStore') as {
      requestOpenPlanCalendar: () => void;
      requestPlanScroll: (t: { kind: 'stop'; stopId: string }) => void;
    };
    const { markFresh } = require('../../module2/timeline/planLiveEdits') as {
      markFresh: (ids: string[]) => void;
    };
    requestOpenPlanCalendar();
    markFresh([stopId]);
    requestPlanScroll({ kind: 'stop', stopId });
  } catch {
    /* soft */
  }
}

export async function cancelNativeWakeAt(wakeAtMs: number): Promise<void> {
  const mod = nativeModule();
  if (!mod?.cancelAlarmAt) return;
  try {
    await mod.cancelAlarmAt(wakeAtMs);
  } catch {
    /* soft */
  }
}

export async function openNativeAlarmClock(opts: {
  wakeAtMs: number;
  message: string;
}): Promise<{
  opened: boolean;
  silent?: boolean;
  status?: string;
  reason?: string;
  detail?: string;
  tier?: string;
}> {
  if (Platform.OS !== 'android') {
    return { opened: false, reason: 'ios_unsupported' };
  }
  if (!Number.isFinite(opts.wakeAtMs) || opts.wakeAtMs < Date.now() + 20_000) {
    return { opened: false, reason: 'too_soon' };
  }

  const { setNativeAlarm } = await import('../alarmService');
  const d = new Date(opts.wakeAtMs);
  const result = await setNativeAlarm({
    wakeAtMs: opts.wakeAtMs,
    time: `${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`,
    label: (opts.message || 'Findus').slice(0, 60),
  });

  if (result.ok && result.tier !== 'notification') {
    return {
      opened: true,
      silent: true,
      status: result.tier === 'intent_launcher' ? 'set_silent' : 'alarm_manager',
      detail: result.detail,
      tier: result.tier,
    };
  }

  // Notification-Tier zählt hier als „nicht native geöffnet“ — Bridge nutzt eigenen Notif-Pfad
  if (result.ok && result.tier === 'notification') {
    return {
      opened: false,
      reason: 'notification_only',
      detail: result.detail,
      tier: 'notification',
    };
  }

  return {
    opened: false,
    reason: result.reason || 'error',
    detail: result.detail || result.speech,
    tier: result.tier,
  };
}

/**
 * @param wakeMode 'add' = zweiten Wecker; 'replace' = bestehenden ersetzen;
 *   undefined = bei Konflikt Choice zurückgeben (needsChoice)
 */
export async function setWakeAlarmWithBridge(opts: {
  wakeAtMs: number;
  reasonLabel: string;
  leaveByMs?: number | null;
  reminderKey?: string;
  preferNative?: boolean;
  wakeMode?: 'add' | 'replace';
  replaceWakeAtMs?: number | null;
}): Promise<NativeAlarmResult> {
  const preferNative = opts.preferNative !== false;
  const label = opts.reasonLabel.trim() || 'deinen Termin';
  const clock = formatClock(opts.wakeAtMs);

  if (!Number.isFinite(opts.wakeAtMs) || opts.wakeAtMs < Date.now() + 20_000) {
    return {
      ok: false,
      channel: 'failed',
      reason: 'too_soon',
      message: failMessage('too_soon'),
    };
  }

  const existing = findExistingWakeSameDay(opts.wakeAtMs);
  const existingMs = existing?.plannedStartMs ?? null;
  const sameTime =
    existingMs != null &&
    Math.abs(existingMs - opts.wakeAtMs) < 2 * 60_000;

  if (existing && existingMs != null && !opts.wakeMode && !sameTime) {
    const oldClock = formatClock(existingMs);
    return {
      ok: false,
      channel: 'failed',
      needsChoice: true,
      existingWakeAtMs: existingMs,
      wakeAtMs: opts.wakeAtMs,
      message: `Schon ein Wecker um ${oldClock}. Neu wäre ${clock}.`,
    };
  }

  if (sameTime && existing) {
    return {
      ok: true,
      channel: 'native',
      wakeAtMs: opts.wakeAtMs,
      message: `Wecker auf ${clock} steht schon.`,
    };
  }

  let replaceStopId: string | null = null;
  if (opts.wakeMode === 'replace' && existing) {
    replaceStopId = existing.id;
    if (existingMs != null) {
      await cancelNativeWakeAt(existingMs);
    }
  } else if (opts.replaceWakeAtMs != null) {
    await cancelNativeWakeAt(opts.replaceWakeAtMs);
    const dayKey = dateKeyFromMs(opts.replaceWakeAtMs);
    const old = listWakeStopsForDay(dayKey).find(
      (s) => s.plannedStartMs === opts.replaceWakeAtMs,
    );
    replaceStopId = old?.id ?? null;
  }

  if (preferNative && Platform.OS === 'android') {
    const { setNativeAlarm } = await import('../alarmService');
    const d = new Date(opts.wakeAtMs);
    const native = await setNativeAlarm({
      wakeAtMs: opts.wakeAtMs,
      time: `${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`,
      label: `Findus — ${label}`,
    });

    if (native.ok) {
      const channel =
        native.tier === 'notification' ? 'notification' : 'native';
      recordWakeOnTimeline({
        wakeAtMs: opts.wakeAtMs,
        reasonLabel: label,
        channel,
        replaceStopId,
      });
      wireWakeRhythm({
        wakeAtMs: opts.wakeAtMs,
        reasonLabel: label,
        leaveByMs: opts.leaveByMs,
      });
      return {
        ok: true,
        channel,
        wakeAtMs: opts.wakeAtMs,
        message:
          native.speech ||
          (channel === 'notification'
            ? `Wecker auf ${clock} gestellt (Findus-Mitteilung).`
            : speechForNativeStatus(
                native.tier === 'intent_launcher'
                  ? 'set_silent'
                  : 'alarm_manager',
                clock,
              )),
      };
    }

    return {
      ok: false,
      channel: 'failed',
      reason: native.reason || 'error',
      message: native.speech || failMessage(native.reason, native.detail),
    };
  }

  const notif = await scheduleWakeAlarm({
    wakeAtMs: opts.wakeAtMs,
    reasonLabel: label,
    leaveByMs: opts.leaveByMs ?? null,
    reminderKey: opts.reminderKey,
  });

  if (!notif.ok) {
    return {
      ok: false,
      channel: 'failed',
      reason: notif.reason,
      message: failMessage(notif.reason, notif.error),
    };
  }

  recordWakeOnTimeline({
    wakeAtMs: opts.wakeAtMs,
    reasonLabel: label,
    channel: 'notification',
    replaceStopId,
  });
  wireWakeRhythm({
    wakeAtMs: opts.wakeAtMs,
    reasonLabel: label,
    leaveByMs: opts.leaveByMs,
  });

  return {
    ok: true,
    channel: 'notification',
    wakeAtMs: opts.wakeAtMs,
    message:
      Platform.OS === 'ios'
        ? `Wecker auf ${clock} gestellt (Mitteilung).`
        : `Wecker auf ${clock} gestellt.`,
  };
}

/** Offenen Wecker löschen (Timeline + Native + Notification + Logistics). */
export async function cancelWakeAlarmWithBridge(opts: {
  wakeAtMs: number;
}): Promise<NativeAlarmResult> {
  const wakeAtMs = opts.wakeAtMs;
  if (!Number.isFinite(wakeAtMs)) {
    return {
      ok: false,
      channel: 'failed',
      reason: 'too_soon',
      message: 'Welchen Wecker soll ich löschen?',
    };
  }
  const clock = formatClock(wakeAtMs);
  const dayKey = dateKeyFromMs(wakeAtMs);
  const stop =
    listWakeStopsForDay(dayKey).find(
      (s) =>
        s.plannedStartMs != null &&
        Math.abs(s.plannedStartMs - wakeAtMs) < 2 * 60_000,
    ) ?? findExistingWakeSameDay(wakeAtMs);

  await cancelNativeWakeAt(wakeAtMs);
  try {
    const { cancelReminderById } = await import(
      '../notifications/notificationService'
    );
    await cancelReminderById(`wake:${wakeAtMs}`);
  } catch {
    /* soft */
  }
  try {
    const { useLogisticsTriggerStore } = require('../../store/useLogisticsTriggerStore') as {
      useLogisticsTriggerStore: {
        getState: () => {
          cancelEvent: (id: string) => void;
          events: Array<{ id: string; kind: string; atMs: number | null }>;
        };
      };
    };
    const log = useLogisticsTriggerStore.getState();
    for (const e of log.events) {
      if (
        e.kind === 'alarm' &&
        e.atMs != null &&
        Math.abs(e.atMs - wakeAtMs) < 2 * 60_000
      ) {
        log.cancelEvent(e.id);
      }
    }
  } catch {
    /* soft */
  }
  if (stop) {
    try {
      useFuturePlanStore.getState().removeStop(stop.id);
    } catch {
      /* soft */
    }
  }

  return {
    ok: true,
    channel: 'native',
    wakeAtMs,
    message: `Wecker um ${clock} ist gelöscht.`,
  };
}
