/**
 * Travel alerts (delay, gate, boarding, train arriving).
 * High-importance local push with sound + vibrate.
 * Tap → speak fullText (survives app-kill via notification data).
 */

import { AppState, Platform, Vibration } from 'react-native';
import * as Notifications from 'expo-notifications';
import {
  configureNotificationHandler,
  requestNotificationPermission,
} from './notificationService';
import { buildTravelPushTeaser } from './notificationTeaser';
import { speakRuntimeText } from '../../runtime/speechModule';
import { getVoiceSettingsForTour } from '../ttsService';
import { useFinnusStore } from '../../store/useFinnusStore';

export const TRAVEL_ALERT_CHANNEL_ID = 'findus-travel-alerts-v1';
export const TRAVEL_ALERT_DATA_TYPE = 'travel_alert';

export type TravelAlertKind =
  | 'delay'
  | 'gate'
  | 'boarding'
  | 'cancel'
  | 'train'
  | 'flight';

let channelReady = false;
let tapListenerReady = false;
let lastSpokenNotifId: string | null = null;

async function ensureTravelChannel(): Promise<void> {
  await configureNotificationHandler();
  if (Platform.OS !== 'android' || channelReady) return;
  await Notifications.setNotificationChannelAsync(TRAVEL_ALERT_CHANNEL_ID, {
    name: 'Reise-Alerts',
    description: 'Verspätung, Gate, Boarding, Zug — mit Ton und Vibration',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 280, 120, 280, 120, 400],
    lightColor: '#C4A35A',
    sound: 'default',
    enableVibrate: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
  channelReady = true;
}

function pulseTravelAttention(): void {
  try {
    if (Platform.OS === 'android') {
      Vibration.vibrate([0, 280, 120, 280, 120, 400]);
    }
  } catch {
    /* ignore */
  }
}

async function speakTravelFullText(line: string): Promise<void> {
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
    if (__DEV__) console.warn('[travelAlert] speak after tap failed', err);
  }
}

function markBoardingAnnounced(ident: string | undefined): void {
  const id = (ident || '').trim();
  if (!id) return;
  void import('../flights/flightWatchStore')
    .then(({ findFlightWatchByIdent, persistFlightWatchesNow }) => {
      const watch = findFlightWatchByIdent(id);
      if (!watch) return;
      watch.announcedBoarding = true;
      persistFlightWatchesNow();
    })
    .catch(() => {
      /* store optional in tests */
    });
}

function travelAlertFromResponse(
  response: Notifications.NotificationResponse,
): { id: string; line: string; kind?: string; ident?: string } | null {
  const data = response.notification.request.content.data as {
    type?: string;
    fullText?: string;
    kind?: string;
    ident?: string;
  };
  if (data?.type !== TRAVEL_ALERT_DATA_TYPE) return null;
  const line = typeof data.fullText === 'string' ? data.fullText.trim() : '';
  if (!line) return null;
  return {
    id: response.notification.request.identifier,
    line,
    kind: data.kind,
    ident: data.ident,
  };
}

function speakTravelAlertResponse(
  response: Notifications.NotificationResponse,
): void {
  const hit = travelAlertFromResponse(response);
  if (!hit) return;
  if (lastSpokenNotifId === hit.id) return;
  lastSpokenNotifId = hit.id;
  if (hit.kind === 'boarding') markBoardingAnnounced(hit.ident);
  void speakTravelFullText(hit.line);
  void Notifications.clearLastNotificationResponseAsync?.().catch(() => {
    /* expo-notifications optional */
  });
}

/** Once: tap (and received boarding) — cold start included. */
export function bootstrapTravelAlertTapHandler(): void {
  if (tapListenerReady) return;
  tapListenerReady = true;
  void (async () => {
    try {
      Notifications.addNotificationResponseReceivedListener((response) => {
        speakTravelAlertResponse(response);
      });

      Notifications.addNotificationReceivedListener((notification) => {
        const data = notification.request.content.data as {
          type?: string;
          kind?: string;
          ident?: string;
        };
        if (data?.type !== TRAVEL_ALERT_DATA_TYPE) return;
        if (data.kind === 'boarding') markBoardingAnnounced(data.ident);
      });

      const last = await Notifications.getLastNotificationResponseAsync();
      if (last) speakTravelAlertResponse(last);
    } catch (err) {
      if (__DEV__) console.warn('[travelAlert] tap listener failed', err);
    }
  })();
}

bootstrapTravelAlertTapHandler();

export async function cancelTravelAlert(id: string): Promise<void> {
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

export async function notifyTravelAlert(opts: {
  id: string;
  kind: TravelAlertKind;
  title: string;
  body: string;
  fullText: string;
  ident?: string;
}): Promise<string | null> {
  bootstrapTravelAlertTapHandler();
  try {
    await ensureTravelChannel();
    const perm = await requestNotificationPermission();
    if (!perm.granted) return null;

    const teaser = buildTravelPushTeaser({
      kind: opts.kind,
      title: opts.title,
      body: opts.body,
    });

    await cancelTravelAlert(opts.id);
    pulseTravelAttention();

    return await Notifications.scheduleNotificationAsync({
      identifier: opts.id,
      content: {
        title: teaser.title,
        body: teaser.body,
        sound: true,
        priority: Notifications.AndroidNotificationPriority.HIGH,
        data: {
          type: TRAVEL_ALERT_DATA_TYPE,
          kind: opts.kind,
          fullText: opts.fullText,
          ident: opts.ident ?? '',
        },
        ...(Platform.OS === 'android'
          ? { channelId: TRAVEL_ALERT_CHANNEL_ID }
          : null),
      },
      trigger: null,
    });
  } catch (err) {
    console.warn('[travelAlert] notify failed', err);
    return null;
  }
}

/**
 * Fire at a wall-clock time (boarding window, train −60s).
 * Past / imminent → immediate notify instead.
 */
export async function scheduleTravelAlertAt(opts: {
  id: string;
  kind: TravelAlertKind;
  title: string;
  body: string;
  fullText: string;
  fireAtMs: number;
  ident?: string;
}): Promise<string | null> {
  bootstrapTravelAlertTapHandler();
  const fireAt = opts.fireAtMs;
  if (!Number.isFinite(fireAt)) return null;
  if (fireAt <= Date.now() + 15_000) {
    return notifyTravelAlert(opts);
  }
  try {
    await ensureTravelChannel();
    const perm = await requestNotificationPermission();
    if (!perm.granted) return null;

    const teaser = buildTravelPushTeaser({
      kind: opts.kind,
      title: opts.title,
      body: opts.body,
    });

    await cancelTravelAlert(opts.id);

    return await Notifications.scheduleNotificationAsync({
      identifier: opts.id,
      content: {
        title: teaser.title,
        body: teaser.body,
        sound: true,
        priority: Notifications.AndroidNotificationPriority.HIGH,
        data: {
          type: TRAVEL_ALERT_DATA_TYPE,
          kind: opts.kind,
          fullText: opts.fullText,
          ident: opts.ident ?? '',
        },
        ...(Platform.OS === 'android'
          ? { channelId: TRAVEL_ALERT_CHANNEL_ID }
          : null),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(fireAt),
        channelId: TRAVEL_ALERT_CHANNEL_ID,
      },
    });
  } catch (err) {
    console.warn('[travelAlert] schedule failed', err);
    return null;
  }
}

export function appIsForeground(): boolean {
  return AppState.currentState === 'active';
}
