/**
 * Local scheduled push notifications (Expo Notifications).
 * Works when the app is backgrounded or the screen is locked.
 */

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { getCachedUserProfile } from '../userProfileService';
import type { LogisticsMode } from '../logistics/logisticsTriggerMath';
import {
  buildFlightReminderBody,
  buildLeaveReminderBody,
  cleanLeaveDestLabel,
  computeLeaveByMs,
  minutesUntilDepartureAtLeave,
  parseDepartureMsFromText,
} from './reminderMath';

export const DEPARTURE_CHANNEL_ID = 'findus-departure-reminders';
export const FLIGHT_CHANNEL_ID = 'findus-flight-reminders';
export const WAKE_CHANNEL_ID = 'findus-wake-alarms';
export const TIMER_CHANNEL_ID = 'findus-timers';
/** Proaktive Tipps (Regen, Termine, …) — Sound + Vibration. */
export const REMINDERS_CHANNEL_ID = 'findus-reminders';

let configured = false;
let androidChannelsReady = false;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function configureNotificationHandler(): Promise<void> {
  if (configured) return;
  configured = true;
  await ensureAndroidChannels();
}

async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android' || androidChannelsReady) return;
  const base = {
    vibrationPattern: [0, 250, 120, 250] as number[],
    lightColor: '#C4A35A',
    sound: 'default' as const,
    enableVibrate: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  };
  await Notifications.setNotificationChannelAsync(DEPARTURE_CHANNEL_ID, {
    name: 'ÖPNV-Erinnerungen',
    description: 'Aufbruch-Erinnerungen vor Bus/Bahn',
    importance: Notifications.AndroidImportance.HIGH,
    ...base,
  });
  await Notifications.setNotificationChannelAsync(FLIGHT_CHANNEL_ID, {
    name: 'Flug-Erinnerungen',
    description: 'Aufbruch-Erinnerungen vor dem Flug',
    importance: Notifications.AndroidImportance.HIGH,
    ...base,
  });
  await Notifications.setNotificationChannelAsync(WAKE_CHANNEL_ID, {
    name: 'Aufsteh-Wecker',
    description: 'Wecker zum Aufstehen vor Flug oder Termin',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 400, 200, 400, 200, 400],
    lightColor: '#C4A35A',
    sound: 'default',
    enableVibrate: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
  await Notifications.setNotificationChannelAsync(TIMER_CHANNEL_ID, {
    name: 'Timer',
    description: 'Countdown-Timer und Eieruhr',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 300, 150, 300, 150, 300],
    lightColor: '#C4A35A',
    sound: 'default',
    enableVibrate: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
  await Notifications.setNotificationChannelAsync(REMINDERS_CHANNEL_ID, {
    name: 'Findus Hinweise',
    description: 'Proaktive Tipps (Wetter, Termine, …) mit Ton und Vibration',
    importance: Notifications.AndroidImportance.HIGH,
    ...base,
  });
  androidChannelsReady = true;
}

export type NotificationPermissionResult = {
  granted: boolean;
  status: Notifications.PermissionStatus;
  canAskAgain: boolean;
};

export async function getNotificationPermission(): Promise<NotificationPermissionResult> {
  const cur = await Notifications.getPermissionsAsync();
  return {
    granted: cur.granted || cur.status === 'granted',
    status: cur.status,
    canAskAgain: cur.canAskAgain !== false,
  };
}

/**
 * Request OS permission for local notifications (Android 13+ / iOS).
 * Safe to call multiple times; no-ops when already granted.
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionResult> {
  await configureNotificationHandler();
  const existing = await getNotificationPermission();
  if (existing.granted) return existing;
  if (!existing.canAskAgain) return existing;

  const next = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
    },
  });
  return {
    granted: next.granted || next.status === 'granted',
    status: next.status,
    canAskAgain: next.canAskAgain !== false,
  };
}

/**
 * Request permission when profile wants reminders (onboarding / first route).
 */
export async function ensureNotificationPermissionForProfile(
  notificationsEnabled?: boolean,
): Promise<NotificationPermissionResult | null> {
  const enabled =
    notificationsEnabled ??
    getCachedUserProfile()?.notificationsEnabled !== false;
  if (!enabled) return null;
  return requestNotificationPermission();
}

export type ScheduleReminderResult =
  | { ok: true; notificationId: string; leaveByMs: number }
  | { ok: false; reason: 'permission' | 'too_soon' | 'disabled' | 'error'; error?: string };

function remindersWanted(): boolean {
  return getCachedUserProfile()?.notificationsEnabled !== false;
}

async function scheduleDateNotification(opts: {
  title: string;
  body: string;
  dateMs: number;
  channelId: string;
  data: Record<string, unknown>;
  identifier?: string;
}): Promise<string> {
  await configureNotificationHandler();
  const trigger: Notifications.NotificationTriggerInput = {
    type: Notifications.SchedulableTriggerInputTypes.DATE,
    date: new Date(opts.dateMs),
    channelId: opts.channelId,
  };
  return Notifications.scheduleNotificationAsync({
    identifier: opts.identifier,
    content: {
      title: opts.title,
      body: opts.body,
      sound: true,
      priority: Notifications.AndroidNotificationPriority.HIGH,
      data: opts.data,
      ...(Platform.OS === 'android' ? { channelId: opts.channelId } : null),
    },
    trigger,
  });
}

/**
 * Schedule leave-by reminder at T_dep − walkEta − safetyBuffer.
 * Mode steuert Copy (Fuß/Rad vs. ÖPNV) — kein Bus-Text bei Walk.
 */
export async function scheduleLeaveByReminder(opts: {
  departureMs: number;
  walkEtaMinutes: number;
  mode?: LogisticsMode | 'transit' | string | null;
  /** Zielname (Fuß/Rad) oder Linien-Label (Transit). */
  title?: string;
  line?: string;
  destName?: string;
  stationName?: string;
  safetyBufferMin?: number;
  /** Stable id so re-scheduling replaces the previous one. */
  reminderKey?: string;
}): Promise<ScheduleReminderResult> {
  if (!remindersWanted()) return { ok: false, reason: 'disabled' };

  const mode = opts.mode ?? 'generic';
  const isTransit =
    mode === 'bus' ||
    mode === 'train' ||
    mode === 'ferry' ||
    mode === 'transit';

  // Fuß/Rad: nur Reisezeit als „spätestens dahin“ — kein Extra-Bahnhofs-Puffer in der Copy
  const safetyForSchedule =
    mode === 'walk' ||
    mode === 'bike' ||
    mode === 'car' ||
    mode === 'taxi' ||
    mode === 'generic'
      ? Math.min(3, opts.safetyBufferMin ?? 2)
      : opts.safetyBufferMin;

  const leave = computeLeaveByMs({
    departureMs: opts.departureMs,
    walkEtaMinutes: opts.walkEtaMinutes,
    safetyBufferMin: safetyForSchedule,
  });
  if (!leave) return { ok: false, reason: 'too_soon' };

  const perm = await requestNotificationPermission();
  if (!perm.granted) return { ok: false, reason: 'permission' };

  const mins = isTransit
    ? minutesUntilDepartureAtLeave(opts.departureMs, leave.leaveByMs)
    : Math.max(1, Math.round(opts.walkEtaMinutes));

  const dest =
    cleanLeaveDestLabel(opts.destName) ||
    cleanLeaveDestLabel(opts.title) ||
    undefined;
  const body = buildLeaveReminderBody({
    mode,
    line: opts.line ?? (isTransit ? opts.title : undefined),
    destName: dest,
    stationName: isTransit ? opts.stationName : undefined,
    minutesUntilArrive: mins,
    // Kontext-Hints (bezahlt/Checkout) nie in voraus geplante Push-Bodies —
    // die sind beim Feuern oft falsch. Live nur in Voice/Checkpoint.
    contextHint: null,
  });

  const keyBase = opts.reminderKey ?? `${mode}:${dest ?? opts.line ?? 'x'}:${opts.departureMs}`;
  const identifier = isTransit ? `transit:${keyBase}` : `leave:${keyBase}`;

  try {
    if (opts.reminderKey) {
      await cancelReminderById(identifier);
      await cancelReminderById(`transit:${opts.reminderKey}`);
      await cancelReminderById(`leave:${opts.reminderKey}`);
    }
    const notificationId = await scheduleDateNotification({
      title: 'Findus — Zeit aufzubrechen',
      body,
      dateMs: leave.leaveByMs,
      channelId: DEPARTURE_CHANNEL_ID,
      identifier,
      data: {
        type: isTransit ? 'transit_departure' : 'leave_by',
        mode,
        line: opts.line ?? null,
        destName: dest ?? null,
        departureMs: opts.departureMs,
        stationName: opts.stationName ?? null,
      },
    });
    return { ok: true, notificationId, leaveByMs: leave.leaveByMs };
  } catch (err) {
    return {
      ok: false,
      reason: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * @deprecated Prefer scheduleLeaveByReminder — alias for transit callers.
 */
export async function scheduleTransitDepartureReminder(opts: {
  departureMs: number;
  walkEtaMinutes: number;
  line: string;
  stationName?: string;
  safetyBufferMin?: number;
  reminderKey?: string;
  mode?: LogisticsMode | 'transit' | string | null;
  destName?: string;
}): Promise<ScheduleReminderResult> {
  return scheduleLeaveByReminder({
    ...opts,
    mode: opts.mode ?? 'bus',
    title: opts.line,
    line: opts.line,
  });
}

/**
 * Schedule flight leave reminder (same leave-by math).
 */
export async function scheduleFlightDepartureReminder(opts: {
  departureMs: number;
  walkEtaMinutes: number;
  flightLabel: string;
  safetyBufferMin?: number;
  reminderKey?: string;
}): Promise<ScheduleReminderResult> {
  if (!remindersWanted()) return { ok: false, reason: 'disabled' };

  const leave = computeLeaveByMs({
    departureMs: opts.departureMs,
    walkEtaMinutes: opts.walkEtaMinutes,
    safetyBufferMin: opts.safetyBufferMin,
  });
  if (!leave) return { ok: false, reason: 'too_soon' };

  const perm = await requestNotificationPermission();
  if (!perm.granted) return { ok: false, reason: 'permission' };

  const mins = minutesUntilDepartureAtLeave(opts.departureMs, leave.leaveByMs);
  const body = buildFlightReminderBody({
    flightLabel: opts.flightLabel,
    minutesUntilDeparture: mins,
  });
  const identifier =
    opts.reminderKey != null
      ? `flight:${opts.reminderKey}`
      : `flight:${opts.flightLabel}:${opts.departureMs}`;

  try {
    if (opts.reminderKey) {
      await cancelReminderById(identifier);
    }
    const notificationId = await scheduleDateNotification({
      title: 'Findus — Flug-Erinnerung',
      body,
      dateMs: leave.leaveByMs,
      channelId: FLIGHT_CHANNEL_ID,
      identifier,
      data: {
        type: 'flight_departure',
        flightLabel: opts.flightLabel,
        departureMs: opts.departureMs,
      },
    });
    return { ok: true, notificationId, leaveByMs: leave.leaveByMs };
  } catch (err) {
    return {
      ok: false,
      reason: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Aufsteh-Wecker (früher als Leave-by): „Zeit aufzustehen“.
 */
export async function scheduleWakeAlarm(opts: {
  wakeAtMs: number;
  reasonLabel: string;
  leaveByMs?: number | null;
  reminderKey?: string;
}): Promise<ScheduleReminderResult> {
  if (!remindersWanted()) return { ok: false, reason: 'disabled' };
  const lead = opts.wakeAtMs - Date.now();
  if (lead < 30_000) return { ok: false, reason: 'too_soon' };

  const perm = await requestNotificationPermission();
  if (!perm.granted) return { ok: false, reason: 'permission' };

  const identifier =
    opts.reminderKey != null
      ? `wake:${opts.reminderKey}`
      : `wake:${opts.wakeAtMs}`;

  const leaveHint =
    opts.leaveByMs != null
      ? ` Losgehen spätestens gegen ${new Date(opts.leaveByMs).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr.`
      : '';

  try {
    await cancelReminderById(identifier);
    const notificationId = await scheduleDateNotification({
      title: 'Findus — Aufstehen',
      body: `Guten Morgen! Zeit aufzustehen für ${opts.reasonLabel}.${leaveHint}`,
      dateMs: opts.wakeAtMs,
      channelId: WAKE_CHANNEL_ID,
      identifier,
      data: {
        type: 'wake_alarm',
        reasonLabel: opts.reasonLabel,
        wakeAtMs: opts.wakeAtMs,
        leaveByMs: opts.leaveByMs ?? null,
      },
    });
    return { ok: true, notificationId, leaveByMs: opts.wakeAtMs };
  } catch (err) {
    return {
      ok: false,
      reason: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Countdown-Timer (Eieruhr). force=true bei explizitem User-Befehl.
 */
export async function scheduleCountdownTimer(opts: {
  endsAtMs: number;
  label: string;
  timerKey?: string;
  force?: boolean;
}): Promise<ScheduleReminderResult> {
  if (!opts.force && !remindersWanted()) {
    return { ok: false, reason: 'disabled' };
  }
  const lead = opts.endsAtMs - Date.now();
  if (lead < 3_000) return { ok: false, reason: 'too_soon' };

  const perm = await requestNotificationPermission();
  if (!perm.granted) return { ok: false, reason: 'permission' };

  const identifier =
    opts.timerKey != null ? opts.timerKey : `timer:${opts.endsAtMs}`;
  const label = (opts.label || 'Timer').trim();

  try {
    await cancelReminderById(identifier);
    const notificationId = await scheduleDateNotification({
      title: 'Findus — Timer',
      body:
        label !== 'Timer'
          ? `Zeit ist um — ${label}.`
          : 'Dein Timer ist durch.',
      dateMs: opts.endsAtMs,
      channelId: TIMER_CHANNEL_ID,
      identifier,
      data: {
        type: 'countdown_timer',
        label,
        endsAtMs: opts.endsAtMs,
      },
    });
    return { ok: true, notificationId, leaveByMs: opts.endsAtMs };
  } catch (err) {
    return {
      ok: false,
      reason: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Try to schedule a flight reminder from free-text memory / chat. */
export async function maybeScheduleFlightReminderFromText(opts: {
  text: string;
  flightLabel?: string;
  walkEtaMinutes?: number;
}): Promise<ScheduleReminderResult | null> {
  const departureMs = parseDepartureMsFromText(opts.text);
  if (departureMs == null) return null;
  return scheduleFlightDepartureReminder({
    departureMs,
    walkEtaMinutes: opts.walkEtaMinutes ?? 25,
    flightLabel: opts.flightLabel ?? 'Flug',
    reminderKey: `parsed:${departureMs}`,
  });
}

export async function cancelReminderById(identifier: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(identifier);
  } catch {
    /* already gone */
  }
}

export async function cancelAllFindusReminders(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

export async function getScheduledReminderIds(): Promise<string[]> {
  const list = await Notifications.getAllScheduledNotificationsAsync();
  return list.map((n) => n.identifier);
}

/**
 * Immediate test notification (verification / debug).
 * Fires after `delaySeconds` via TIME_INTERVAL trigger.
 */
export async function scheduleTestReminder(opts?: {
  delaySeconds?: number;
  body?: string;
}): Promise<ScheduleReminderResult> {
  const perm = await requestNotificationPermission();
  if (!perm.granted) return { ok: false, reason: 'permission' };

  const delay = Math.max(1, opts?.delaySeconds ?? 3);
  const leaveByMs = Date.now() + delay * 1000;
  try {
    await configureNotificationHandler();
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Findus — Test',
        body:
          opts?.body ??
          buildLeaveReminderBody({
            mode: 'walk',
            destName: 'Testziel',
            minutesUntilArrive: 12,
          }),
        sound: true,
        data: { type: 'test' },
        ...(Platform.OS === 'android'
          ? { channelId: DEPARTURE_CHANNEL_ID }
          : null),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: delay,
        channelId: DEPARTURE_CHANNEL_ID,
      },
    });
    return { ok: true, notificationId, leaveByMs };
  } catch (err) {
    return {
      ok: false,
      reason: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// Re-export parse helper for callers that only import this module.
export { parseDepartureMsFromText };
