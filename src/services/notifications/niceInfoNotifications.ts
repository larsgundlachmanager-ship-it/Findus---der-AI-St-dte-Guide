/**
 * Nice-to-know Push — niedrige Priorität (Gleis, Hitze/Sonnencreme, Tipps).
 * Nicht für Leave-by / Regen-akut / Wecker.
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import {
  configureNotificationHandler,
  requestNotificationPermission,
} from './notificationService';

export const NICE_INFO_CHANNEL_ID = 'findus-nice-info';
export const NICE_INFO_DATA_TYPE = 'nice_info';

const recentKeys = new Map<string, number>();
const DEDUPE_MS = 45 * 60_000;

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(NICE_INFO_CHANNEL_ID, {
    name: 'Yorro Tipps',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 120],
    lightColor: '#4A90A4',
  });
}

/**
 * Sanfte Push-Info (Lockscreen). Kein Vibrieren-Spam, Default-Importance.
 */
export async function scheduleNiceInfoPush(opts: {
  title: string;
  body: string;
  dataKey: string;
}): Promise<{ ok: boolean }> {
  const now = Date.now();
  const last = recentKeys.get(opts.dataKey);
  if (last != null && now - last < DEDUPE_MS) {
    return { ok: false };
  }
  recentKeys.set(opts.dataKey, now);

  try {
    await configureNotificationHandler();
    const perm = await requestNotificationPermission();
    if (!perm) return { ok: false };
    await ensureChannel();

    await Notifications.scheduleNotificationAsync({
      content: {
        title: opts.title.slice(0, 60),
        body: opts.body.slice(0, 160),
        data: { type: NICE_INFO_DATA_TYPE, key: opts.dataKey },
        ...(Platform.OS === 'android'
          ? { channelId: NICE_INFO_CHANNEL_ID }
          : {}),
        sound: false,
      },
      trigger: null,
    });
    return { ok: true };
  } catch (err) {
    console.warn('[niceInfoPush] failed', err);
    return { ok: false };
  }
}

/**
 * Nice-Info zu festem Zeitpunkt (z. B. Morgen 8 Uhr Flugtag).
 */
export async function scheduleNiceInfoPushAt(opts: {
  title: string;
  body: string;
  dataKey: string;
  fireAtMs: number;
}): Promise<{ ok: boolean; notificationId?: string }> {
  if (opts.fireAtMs < Date.now() + 30_000) {
    const r = await scheduleNiceInfoPush(opts);
    return { ok: r.ok };
  }

  try {
    await configureNotificationHandler();
    const perm = await requestNotificationPermission();
    if (!perm) return { ok: false };
    await ensureChannel();

    const last = recentKeys.get(`sched:${opts.dataKey}`);
    if (last != null && last === opts.fireAtMs) {
      return { ok: false };
    }
    recentKeys.set(`sched:${opts.dataKey}`, opts.fireAtMs);

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: opts.title.slice(0, 60),
        body: opts.body.slice(0, 160),
        data: { type: NICE_INFO_DATA_TYPE, key: opts.dataKey },
        ...(Platform.OS === 'android'
          ? { channelId: NICE_INFO_CHANNEL_ID }
          : {}),
        sound: false,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(opts.fireAtMs),
      },
    });
    return { ok: true, notificationId: id };
  } catch (err) {
    console.warn('[niceInfoPushAt] failed', err);
    return { ok: false };
  }
}
