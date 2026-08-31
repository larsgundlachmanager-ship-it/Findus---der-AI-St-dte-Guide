/**
 * Regen-Warnungen als geplante Local Notifications.
 * Feuern auch bei gesperrtem Handy / geschlossener App (OS-Scheduler).
 */

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  configureNotificationHandler,
  REMINDERS_CHANNEL_ID,
  requestNotificationPermission,
} from './notificationService';
import { getCachedUserProfile } from '../userProfileService';
import { earliestProactiveRainWarnAtMs } from '../weather/rainWarnSessionGate';

export const RAIN_ALERT_CHANNEL_ID = 'findus-rain-alerts';
export const RAIN_ALERT_DATA_TYPE = 'rain_alert';

const ID_30 = 'findus-rain-warn-30';
const ID_5 = 'findus-rain-warn-5';
const STORAGE_KEY = 'findus.rainAlert.schedule.v1';

type StoredSchedule = {
  rainAtMs: number;
  scheduled30AtMs: number | null;
  scheduled5AtMs: number | null;
};

let channelReady = false;

async function ensureRainChannel(): Promise<void> {
  await configureNotificationHandler();
  if (Platform.OS !== 'android' || channelReady) return;
  await Notifications.setNotificationChannelAsync(RAIN_ALERT_CHANNEL_ID, {
    name: 'Regen-Warnungen',
    description: 'Warnung ~30 und ~5 Minuten vor Regen — auch bei gesperrtem Handy',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 280, 120, 280],
    lightColor: '#C4A35A',
    sound: 'default',
    enableVibrate: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
  channelReady = true;
}

function remindersWanted(): boolean {
  try {
    const { isProactiveAlertEnabled } = require('./proactiveAlerts') as {
      isProactiveAlertEnabled: (k: 'weather') => boolean;
    };
    return isProactiveAlertEnabled('weather');
  } catch {
    return getCachedUserProfile()?.notificationsEnabled !== false;
  }
}

function channelId(): string {
  return Platform.OS === 'android' ? RAIN_ALERT_CHANNEL_ID : REMINDERS_CHANNEL_ID;
}

async function cancelId(id: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    /* gone */
  }
}

export async function cancelRainAlertNotifications(): Promise<void> {
  await cancelId(ID_30);
  await cancelId(ID_5);
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    /* soft */
  }
}

async function readStored(): Promise<StoredSchedule | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredSchedule;
  } catch {
    return null;
  }
}

async function writeStored(s: StoredSchedule): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* soft */
  }
}

async function scheduleAt(opts: {
  identifier: string;
  dateMs: number;
  title: string;
  body: string;
  kind: '30' | '5';
  rainAtMs: number;
}): Promise<boolean> {
  const now = Date.now();
  const earliest = earliestProactiveRainWarnAtMs(now);
  // Mindestens ~2 s in der Zukunft (OS-Trigger), nicht vor der Start-Ruhe
  const when = Math.max(opts.dateMs, now + 2_000, earliest);
  if (when >= opts.rainAtMs - 30_000) return false;
  if (when - now > 7 * 24 * 60 * 60_000) return false;

  const ch = channelId();
  const trigger: Notifications.NotificationTriggerInput = {
    type: Notifications.SchedulableTriggerInputTypes.DATE,
    date: new Date(when),
    channelId: ch,
  };

  await Notifications.scheduleNotificationAsync({
    identifier: opts.identifier,
    content: {
      title: opts.title,
      body: opts.body,
      sound: true,
      priority: Notifications.AndroidNotificationPriority.HIGH,
      data: {
        type: RAIN_ALERT_DATA_TYPE,
        kind: opts.kind,
        rainAtMs: opts.rainAtMs,
        fullText:
          opts.kind === '5'
            ? `Gleich wird's nass — Regen in wenigen Minuten. Wenn du noch draußen bist, such dir kurz was Trockenes.`
            : `In etwa einer halben Stunde sieht's nach Regen aus. Café oder Indoor, oder ist dir Regen egal?`,
      },
      ...(Platform.OS === 'android' ? { channelId: ch } : null),
    },
    trigger,
  });
  return true;
}

function clockLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Plant/aktualisiert 30-Min- und 5-Min-Regenwarnungen.
 * Ohne nextRainAtMs → alles stornieren.
 */
export async function syncRainAlertNotifications(opts: {
  nextRainAtMs: number | null;
  /** Optional: Minutely-Schätzung */
  rainStartsInMin?: number | null;
  summaryLine?: string | null;
}): Promise<{ ok: boolean; reason?: string }> {
  if (!remindersWanted()) {
    await cancelRainAlertNotifications();
    return { ok: false, reason: 'disabled' };
  }

  await ensureRainChannel();
  const perm = await requestNotificationPermission();
  if (!perm.granted) {
    return { ok: false, reason: 'permission' };
  }

  const now = Date.now();
  let rainAt =
    opts.nextRainAtMs != null && opts.nextRainAtMs > now
      ? opts.nextRainAtMs
      : null;

  // Minutely schärfer als hourly
  if (
    opts.rainStartsInMin != null &&
    opts.rainStartsInMin >= 0 &&
    opts.rainStartsInMin <= 120
  ) {
    const fromMinutely = now + opts.rainStartsInMin * 60_000;
    if (rainAt == null || fromMinutely < rainAt) rainAt = fromMinutely;
  }

  if (rainAt == null || rainAt - now > 12 * 60 * 60_000) {
    await cancelRainAlertNotifications();
    return { ok: true, reason: 'clear' };
  }

  const prev = await readStored();
  // Gleicher Regen ±2 Min → nicht unnötig neu planen
  if (
    prev &&
    Math.abs(prev.rainAtMs - rainAt) < 2 * 60_000 &&
    prev.scheduled30AtMs != null &&
    prev.scheduled5AtMs != null
  ) {
    return { ok: true, reason: 'unchanged' };
  }

  await cancelId(ID_30);
  await cancelId(ID_5);

  const clock = clockLabel(rainAt);
  const t30 = rainAt - 30 * 60_000;
  const t5 = rainAt - 5 * 60_000;

  let scheduled30AtMs: number | null = null;
  let scheduled5AtMs: number | null = null;

  // 30-Min-Warnung: nur wenn noch ≥6 Min bis Regen (sonst direkt 5-Min)
  if (rainAt - now > 6 * 60_000) {
    const fire30 = t30 > now + 3_000 ? t30 : now + 3_000;
    // Nur planen wenn Fire-Zeit noch vor dem 5-Min-Punkt liegt
    if (fire30 < t5 - 60_000 || rainAt - now > 32 * 60_000) {
      const ok = await scheduleAt({
        identifier: ID_30,
        dateMs: fire30,
        title: 'Yorro — Regen',
        body: `Bald Regen (ab ca. ${clock}). Rein gehen oder draußen bleiben?`,
        kind: '30',
        rainAtMs: rainAt,
      });
      if (ok) scheduled30AtMs = fire30;
    }
  }

  if (rainAt - now > 90_000) {
    const fire5 = t5 > now + 2_000 ? t5 : now + 2_000;
    const ok = await scheduleAt({
      identifier: ID_5,
      dateMs: fire5,
      title: 'Yorro — gleich Regen',
      body: `In wenigen Minuten wird's nass (ab ca. ${clock}).`,
      kind: '5',
      rainAtMs: rainAt,
    });
    if (ok) scheduled5AtMs = fire5;
  }

  await writeStored({
    rainAtMs: rainAt,
    scheduled30AtMs,
    scheduled5AtMs,
  });

  return { ok: true };
}
