/**
 * Zeit-Aufgaben (Anruf, Medikament, „um 14 Uhr …“).
 * Harter Local-Push mit Ton + Vibration. Tap spricht fullText.
 */

import { Platform, Vibration } from 'react-native';
import * as Notifications from 'expo-notifications';
import {
  configureNotificationHandler,
  requestNotificationPermission,
} from './notificationService';
import { speakRuntimeText } from '../../runtime/speechModule';
import { getVoiceSettingsForTour } from '../ttsService';
import { useFinnusStore } from '../../store/useFinnusStore';
import {
  buildTaskReminderSpeech,
  extractTaskReminderPhrase,
  formatReminderClock,
} from './taskReminderCopy';

export const TASK_REMINDER_CHANNEL_ID = 'findus-task-reminders-v1';
export const TASK_REMINDER_DATA_TYPE = 'task_reminder';

let channelReady = false;
let tapListenerReady = false;
let lastSpokenNotifId: string | null = null;

async function ensureTaskChannel(): Promise<void> {
  await configureNotificationHandler();
  if (Platform.OS !== 'android' || channelReady) return;
  await Notifications.setNotificationChannelAsync(TASK_REMINDER_CHANNEL_ID, {
    name: 'Aufgaben-Erinnerungen',
    description: 'Anruf, To-do, Uhrzeit — mit Ton und Vibration',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 280, 120, 280, 120, 400],
    lightColor: '#C4A35A',
    sound: 'default',
    enableVibrate: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
  channelReady = true;
}

function pulseTaskAttention(): void {
  try {
    if (Platform.OS === 'android') {
      Vibration.vibrate([0, 280, 120, 280, 120, 400]);
    }
  } catch {
    /* ignore */
  }
}

function clipLockscreen(s: string, max = 96): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

async function speakTaskFullText(line: string): Promise<void> {
  const text = line.replace(/\s+/g, ' ').trim();
  if (!text) return;
  const store = useFinnusStore.getState();
  if (store.isListening || store.isGenerating) return;
  try {
    const voice = await getVoiceSettingsForTour();
    store.addChatMessage({ role: 'assistant', content: text });
    await speakRuntimeText(
      text,
      { voiceId: voice.voiceId, speechRate: voice.speechRate },
      { deliveryKind: 'reminder' },
    );
  } catch (err) {
    if (__DEV__) console.warn('[taskReminder] speak after tap failed', err);
  }
}

function taskFromResponse(
  response: Notifications.NotificationResponse,
): { id: string; line: string } | null {
  const data = response.notification.request.content.data as {
    type?: string;
    fullText?: string;
  };
  if (data?.type !== TASK_REMINDER_DATA_TYPE) return null;
  const line = typeof data.fullText === 'string' ? data.fullText.trim() : '';
  if (!line) return null;
  return { id: response.notification.request.identifier, line };
}

function speakTaskFromResponse(
  response: Notifications.NotificationResponse,
): void {
  const hit = taskFromResponse(response);
  if (!hit) return;
  if (lastSpokenNotifId === hit.id) return;
  lastSpokenNotifId = hit.id;
  void speakTaskFullText(hit.line);
  void Notifications.clearLastNotificationResponseAsync?.().catch(() => {
    /* optional */
  });
}

export function bootstrapTaskReminderTapHandler(): void {
  if (tapListenerReady) return;
  tapListenerReady = true;
  void (async () => {
    try {
      Notifications.addNotificationResponseReceivedListener((response) => {
        speakTaskFromResponse(response);
      });
      const last = await Notifications.getLastNotificationResponseAsync();
      if (last) speakTaskFromResponse(last);
    } catch (err) {
      if (__DEV__) console.warn('[taskReminder] tap listener failed', err);
    }
  })();
}

bootstrapTaskReminderTapHandler();

export async function cancelTaskReminder(id: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    /* ignore */
  }
  try {
    await Notifications.dismissNotificationAsync(id);
  } catch {
    /* ignore */
  }
}

export async function scheduleTaskReminderAt(opts: {
  id: string;
  fireAtMs: number;
  task: string;
  userText?: string | null;
}): Promise<string | null> {
  bootstrapTaskReminderTapHandler();
  const fireAt = opts.fireAtMs;
  if (!Number.isFinite(fireAt) || fireAt <= Date.now() + 3_000) return null;

  const task = extractTaskReminderPhrase(
    opts.userText || '',
    opts.task,
  );
  const fullText = buildTaskReminderSpeech({ task, fireAtMs: fireAt });
  const clock = formatReminderClock(fireAt);
  const title = `Yorro · ${clock}`;
  const body = clipLockscreen(task);

  try {
    await ensureTaskChannel();
    const perm = await requestNotificationPermission();
    if (!perm.granted) return null;

    await cancelTaskReminder(opts.id);

    const imminent = fireAt <= Date.now() + 15_000;
    if (imminent) pulseTaskAttention();
    return await Notifications.scheduleNotificationAsync({
      identifier: opts.id,
      content: {
        title,
        body,
        sound: true,
        priority: Notifications.AndroidNotificationPriority.HIGH,
        data: {
          type: TASK_REMINDER_DATA_TYPE,
          fullText,
          task,
        },
        ...(Platform.OS === 'android'
          ? { channelId: TASK_REMINDER_CHANNEL_ID }
          : null),
      },
      trigger: imminent
        ? null
        : {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: new Date(fireAt),
            channelId: TASK_REMINDER_CHANNEL_ID,
          },
    });
  } catch (err) {
    console.warn('[taskReminder] schedule failed', err);
    return null;
  }
}
