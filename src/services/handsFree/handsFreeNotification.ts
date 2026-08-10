/**
 * Persistente Hands-free-Notification: „Sprechen“ auch bei gesperrtem Display.
 */

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import {
  configureNotificationHandler,
  requestNotificationPermission,
} from '../notifications/notificationService';
import {
  getHandsFreePrefsSync,
  loadHandsFreePrefs,
} from './handsFreePrefs';

export const HANDSFREE_CHANNEL_ID = 'findus-handsfree';
export const HANDSFREE_CATEGORY = 'findus_handsfree';
export const HANDSFREE_ACTION_SPEAK = 'FINDUS_SPEAK';
export const HANDSFREE_NOTIF_ID = 'findus-handsfree-ready';

let categoryReady = false;

async function ensureChannelAndCategory(): Promise<void> {
  await configureNotificationHandler();
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(HANDSFREE_CHANNEL_ID, {
      name: 'Findus Hands-free',
      description: 'Schnell sprechen — auch bei gesperrtem Display',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 120],
      lightColor: '#C4A35A',
      sound: undefined,
      enableVibrate: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }
  if (!categoryReady) {
    await Notifications.setNotificationCategoryAsync(HANDSFREE_CATEGORY, [
      {
        identifier: HANDSFREE_ACTION_SPEAK,
        buttonTitle: 'Sprechen',
        options: {
          opensAppToForeground: true,
        },
      },
    ]);
    categoryReady = true;
  }
}

export async function syncHandsFreeListenNotification(): Promise<void> {
  await loadHandsFreePrefs();
  const prefs = getHandsFreePrefsSync();
  await ensureChannelAndCategory();

  try {
    await Notifications.dismissNotificationAsync(HANDSFREE_NOTIF_ID);
  } catch {
    /* soft */
  }

  if (!prefs.stickyListenNotification) return;

  const perm = await requestNotificationPermission();
  if (!perm.granted) return;

  await Notifications.scheduleNotificationAsync({
    identifier: HANDSFREE_NOTIF_ID,
    content: {
      title: 'Findus bereit',
      body: '„Sprechen“ tippen — Mikro startet hands-free.',
      sticky: Platform.OS === 'android',
      autoDismiss: false,
      categoryIdentifier: HANDSFREE_CATEGORY,
      data: { kind: 'handsfree_ready', action: 'speak' },
      ...(Platform.OS === 'android'
        ? { channelId: HANDSFREE_CHANNEL_ID }
        : {}),
    },
    trigger: null,
  });
}

export async function clearHandsFreeListenNotification(): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(HANDSFREE_NOTIF_ID);
  } catch {
    /* soft */
  }
}

export function isHandsFreeSpeakResponse(
  response: Notifications.NotificationResponse,
): boolean {
  const action = response.actionIdentifier;
  if (action === HANDSFREE_ACTION_SPEAK) return true;
  const data = response.notification.request.content.data as
    | { kind?: string; action?: string }
    | undefined;
  if (data?.kind === 'handsfree_ready') return true;
  return false;
}
