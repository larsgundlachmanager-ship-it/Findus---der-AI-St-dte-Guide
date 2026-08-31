/**
 * Immediate local notifications when Yorro wants to speak but phone is locked
 * without headset (no pocket speaker). Short teaser + sound/vibrate → tap for full TTS.
 */

import { Platform, Vibration } from 'react-native';
import * as Notifications from 'expo-notifications';
import {
  configureNotificationHandler,
  requestNotificationPermission,
} from './notificationService';
import { buildSpeechPushTeaser } from './notificationTeaser';

export const SPEECH_ALERT_CHANNEL_ID = 'findus-speech-alerts-v2';
export const SPEECH_ALERT_DATA_TYPE = 'pending_speech';

let channelReady = false;

async function ensureSpeechChannel(): Promise<void> {
  await configureNotificationHandler();
  if (Platform.OS !== 'android' || channelReady) return;
  await Notifications.setNotificationChannelAsync(SPEECH_ALERT_CHANNEL_ID, {
    name: 'Yorro Hinweise',
    description: 'Kurzinfo wenn Yorro etwas sagen möchte — mit Ton und Vibration',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 220, 100, 220],
    lightColor: '#C4A35A',
    sound: 'default',
    enableVibrate: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
  channelReady = true;
}

function pulseAttention(): void {
  try {
    if (Platform.OS === 'android') {
      Vibration.vibrate([0, 220, 100, 220]);
    }
  } catch {
    /* ignore */
  }
}

export async function notifyPendingSpeech(opts: {
  id: string;
  title?: string;
  body?: string;
  /** Full speech text — used to build teaser when title/body omitted */
  fullText?: string;
  kind?: 'assistant' | 'nav' | 'reminder';
}): Promise<string | null> {
  try {
    await ensureSpeechChannel();
    const perm = await requestNotificationPermission();
    if (!perm.granted) return null;

    const teaser =
      opts.title && opts.body
        ? { title: opts.title, body: opts.body }
        : buildSpeechPushTeaser(
            opts.fullText ?? opts.body ?? '',
            opts.kind ?? 'assistant',
          );

    // Replace previous speech alert so only latest tip remains
    const identifier = 'findus-pending-speech';
    try {
      await Notifications.cancelScheduledNotificationAsync(identifier);
    } catch {
      /* ignore */
    }
    try {
      await Notifications.dismissNotificationAsync(identifier);
    } catch {
      /* ignore */
    }

    pulseAttention();

    const id = await Notifications.scheduleNotificationAsync({
      identifier,
      content: {
        title: teaser.title,
        body: teaser.body,
        sound: true,
        priority: Notifications.AndroidNotificationPriority.HIGH,
        data: {
          type: SPEECH_ALERT_DATA_TYPE,
          pendingSpeechId: opts.id,
        },
        ...(Platform.OS === 'android'
          ? { channelId: SPEECH_ALERT_CHANNEL_ID }
          : null),
      },
      trigger: null, // immediate
    });
    return id;
  } catch (err) {
    console.warn('[speechAlert] notify failed:', err);
    return null;
  }
}
