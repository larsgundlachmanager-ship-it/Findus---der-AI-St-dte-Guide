/**
 * Regen-Warnungen:
 * - Mit aktiver Standort-Live-Karte → Hinweis still auf derselben Karte (kein Extra-Push).
 * - Ohne Live-Karte → geplante Local Notifications (auch bei gesperrtem Handy).
 * Push nur exakt 30 Min und 5 Min vor Regenbeginn (kein Catch-up).
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
import { rainPushFireTimes } from './rainAlertLead';

export const RAIN_ALERT_CHANNEL_ID = 'findus-rain-alerts';
export const RAIN_ALERT_DATA_TYPE = 'rain_alert';
export { RAIN_PUSH_LEAD_MS, rainPushFireTimes } from './rainAlertLead';

const ID_30 = 'findus-rain-warn-30';
const ID_5 = 'findus-rain-warn-5';
const STORAGE_KEY = 'findus.rainAlert.schedule.v1';

type StoredSchedule = {
  rainAtMs: number;
  scheduled30AtMs: number | null;
  scheduled5AtMs: number | null;
  /** Regen lief über die Standort-Live-Karte, nicht als Push. */
  viaLiveCard?: boolean;
};

let channelReady = false;

async function ensureRainChannel(): Promise<void> {
  await configureNotificationHandler();
  if (Platform.OS !== 'android' || channelReady) return;
  await Notifications.setNotificationChannelAsync(RAIN_ALERT_CHANNEL_ID, {
    name: 'Regen-Warnungen',
    description: 'Warnung 30 und 5 Minuten vor Regen — auch bei gesperrtem Handy',
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

async function clearLiveRainHint(): Promise<void> {
  try {
    const loc = require('../locationService') as {
      updateLocationLiveNotification?: (o: {
        rainHint?: string | null;
      }) => Promise<void>;
    };
    await loc.updateLocationLiveNotification?.({ rainHint: null });
  } catch {
    /* soft */
  }
}

async function applyRainOnLiveCard(opts: {
  clock: string;
  kind: 'approaching' | 'soon';
}): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    const loc = require('../locationService') as {
      isLocationForegroundServiceActiveAsync?: () => Promise<boolean>;
      updateLocationLiveNotification?: (o: {
        rainHint?: string | null;
      }) => Promise<void>;
    };
    const active = (await loc.isLocationForegroundServiceActiveAsync?.()) === true;
    if (!active) return false;
    const hint =
      opts.kind === 'soon'
        ? `Gleich Regen (ab ca. ${opts.clock}). Kurz rein oder Schutz suchen.`
        : `Bald Regen (ab ca. ${opts.clock}). Rein gehen oder draußen bleiben?`;
    await loc.updateLocationLiveNotification?.({ rainHint: hint });
    return true;
  } catch {
    return false;
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
 * Plant/aktualisiert nur 30-Min- und 5-Min-Regenwarnungen.
 * Ohne nextRainAtMs → alles stornieren. Kein Catch-up-Sofortpush.
 */
export async function syncRainAlertNotifications(opts: {
  nextRainAtMs: number | null;
  rainStartsInMin?: number | null;
  summaryLine?: string | null;
}): Promise<{ ok: boolean; reason?: string }> {
  if (!remindersWanted()) {
    await cancelRainAlertNotifications();
    await clearLiveRainHint();
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
    await clearLiveRainHint();
    return { ok: true, reason: 'clear' };
  }

  const clock = clockLabel(rainAt);
  const minsLeft = Math.round((rainAt - now) / 60_000);
  const kind: 'approaching' | 'soon' = minsLeft <= 8 ? 'soon' : 'approaching';

  const onLive = await applyRainOnLiveCard({ clock, kind });
  if (onLive) {
    await cancelId(ID_30);
    await cancelId(ID_5);
    await writeStored({
      rainAtMs: rainAt,
      scheduled30AtMs: null,
      scheduled5AtMs: null,
      viaLiveCard: true,
    });
    return { ok: true, reason: 'live_card' };
  }

  await clearLiveRainHint();

  const prev = await readStored();
  if (
    prev &&
    !prev.viaLiveCard &&
    Math.abs(prev.rainAtMs - rainAt) < 2 * 60_000 &&
    (prev.scheduled30AtMs != null || prev.scheduled5AtMs != null)
  ) {
    return { ok: true, reason: 'unchanged' };
  }

  await cancelId(ID_30);
  await cancelId(ID_5);

  const { t30, t5 } = rainPushFireTimes(rainAt, now);

  let scheduled30AtMs: number | null = null;
  let scheduled5AtMs: number | null = null;

  if (t30 != null) {
    const ok = await scheduleAt({
      identifier: ID_30,
      dateMs: t30,
      title: 'Yorro — Regen',
      body: `Bald Regen (ab ca. ${clock}). Rein gehen oder draußen bleiben?`,
      kind: '30',
      rainAtMs: rainAt,
    });
    if (ok) scheduled30AtMs = t30;
  }

  if (t5 != null) {
    const ok = await scheduleAt({
      identifier: ID_5,
      dateMs: t5,
      title: 'Yorro — gleich Regen',
      body: `In wenigen Minuten wird's nass (ab ca. ${clock}).`,
      kind: '5',
      rainAtMs: rainAt,
    });
    if (ok) scheduled5AtMs = t5;
  }

  await writeStored({
    rainAtMs: rainAt,
    scheduled30AtMs,
    scheduled5AtMs,
    viaLiveCard: false,
  });

  return { ok: true };
}