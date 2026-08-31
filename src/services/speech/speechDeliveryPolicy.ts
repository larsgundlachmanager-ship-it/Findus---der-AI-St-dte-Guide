/**
 * Speech delivery policy — no pocket-speaker when locked without headset.
 *
 * unlocked              → speak
 * locked + BT/headset   → speak
 * locked + phone speaker → vibrate + notification + queue text
 *   · open app within 1 min → speak pending
 *   · tap notification (anytime) → speak pending
 */

import { AppState, type AppStateStatus, Platform, Vibration } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { SpeakVoiceOptions } from '../AudioVoiceService';
import { canSpeakAloudNow } from './deviceAudioRoute';
import {
  notifyPendingSpeech,
  SPEECH_ALERT_DATA_TYPE,
} from '../notifications/speechAlertNotifications';
import { buildSpeechPushTeaser } from '../notifications/notificationTeaser';
import {
  getAudioOutputMode,
  wantsSpokenAudio,
} from '../userProfileService';
import { useFinnusStore } from '../../store/useFinnusStore';
export type SpeechDeliveryKind = 'assistant' | 'nav' | 'reminder';

export type PendingSpeechItem = {
  id: string;
  text: string;
  voiceOptions?: SpeakVoiceOptions;
  kind: SpeechDeliveryKind;
  queuedAtMs: number;
  summary: string;
};

const AUTO_RESUME_MS = 60_000;

let pending: PendingSpeechItem | null = null;
let flushInFlight = false;
let bootstrapped = false;
let speakImpl: ((
  text: string,
  voice?: SpeakVoiceOptions,
) => Promise<void>) | null = null;

const listeners = new Set<(item: PendingSpeechItem | null) => void>();

function summarizeForNotification(
  text: string,
  kind: SpeechDeliveryKind,
): string {
  return buildSpeechPushTeaser(text, kind).body;
}

function notifyListeners(): void {
  for (const l of listeners) {
    try {
      l(pending);
    } catch {
      /* ignore */
    }
  }
}

export function getPendingSpeech(): PendingSpeechItem | null {
  return pending;
}

export function subscribePendingSpeech(
  listener: (item: PendingSpeechItem | null) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Register real TTS (avoids circular import with AudioVoiceService). */
export function registerSpeechFlushHandler(
  fn: (text: string, voice?: SpeakVoiceOptions) => Promise<void>,
): void {
  speakImpl = fn;
}

async function vibrateForAttention(kind: SpeechDeliveryKind): Promise<void> {
  try {
    if (Platform.OS === 'android') {
      Vibration.vibrate(
        kind === 'nav' ? [0, 180, 80, 180, 80, 220] : [0, 220, 100, 220],
      );
    } else {
      await Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Warning,
      );
      if (kind === 'nav') {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * If speaking aloud is OK → return true (caller speaks).
 * Else queue + vibrate + notify → return false.
 * mute / text_only → skip TTS; Untertitel 1:1 setzen.
 */
export async function requestSpeechDelivery(opts: {
  text: string;
  voiceOptions?: SpeakVoiceOptions;
  kind?: SpeechDeliveryKind;
}): Promise<boolean> {
  const text = opts.text.trim();
  if (!text) return false;

  const kind = opts.kind ?? 'assistant';

  try {
    const { isReisebueroOverlayOpen } = require('../../reisebuero/store') as {
      isReisebueroOverlayOpen: () => boolean;
    };
    if (isReisebueroOverlayOpen() && kind !== 'assistant') {
      return false;
    }
  } catch {
    /* soft */
  }

  // Profile: Stumm / Nur Text — kein TTS; Untertitel = derselbe Text
  if (!wantsSpokenAudio()) {
    try {
      useFinnusStore.getState().setSubtitleText(text);
    } catch {
      /* store ggf. noch nicht bereit */
    }
    if (__DEV__) {
      const mode = getAudioOutputMode();
      console.log(
        `[speechPolicy] skipped TTS (${mode}, ${kind}): ${text.slice(0, 60)}`,
      );
    }
    return false;
  }

  let allow = true;
  try {
    allow = await canSpeakAloudNow();
  } catch {
    allow = AppState.currentState === 'active';
  }

  if (allow) return true;

  const id = `speech-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const summary = summarizeForNotification(text, kind);
  pending = {
    id,
    text,
    voiceOptions: opts.voiceOptions,
    kind,
    queuedAtMs: Date.now(),
    summary,
  };
  notifyListeners();

  await vibrateForAttention(kind);
  const teaser = buildSpeechPushTeaser(text, kind);
  void notifyPendingSpeech({
    id,
    title: teaser.title,
    body: teaser.body,
    fullText: text,
    kind,
  });

  if (__DEV__) {
    console.log(
      `[speechPolicy] deferred (${kind}): ${summary.slice(0, 60)}`,
    );
  }

  return false;
}

/**
 * Speak queued text if any. Clears queue after successful start.
 * @param force ignore 1-minute window (notification tap)
 */
export async function flushPendingSpeech(opts?: {
  force?: boolean;
}): Promise<boolean> {
  const item = pending;
  if (!item || flushInFlight) return false;

  if (!opts?.force) {
    const age = Date.now() - item.queuedAtMs;
    if (age > AUTO_RESUME_MS) {
      if (__DEV__) {
        console.log('[speechPolicy] pending older than 1 min — wait for tap');
      }
      return false;
    }
  }

  // Only speak if aloud is now allowed (unlocked or BT)
  if (!wantsSpokenAudio()) return false;

  let allow = true;
  try {
    allow = await canSpeakAloudNow();
  } catch {
    allow = AppState.currentState === 'active';
  }
  if (!allow) return false;

  if (!speakImpl) {
    if (__DEV__) console.warn('[speechPolicy] no flush handler registered');
    return false;
  }

  flushInFlight = true;
  pending = null;
  notifyListeners();
  try {
    await speakImpl(item.text, item.voiceOptions);
    return true;
  } catch (err) {
    console.warn('[speechPolicy] flush speak failed:', err);
    return false;
  } finally {
    flushInFlight = false;
  }
}

function onAppState(next: AppStateStatus): void {
  if (next !== 'active') return;
  void flushPendingSpeech({ force: false });
}

/**
 * Call once from App bootstrap: AppState + notification response.
 */
export function bootstrapSpeechDeliveryPolicy(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  AppState.addEventListener('change', onAppState);

  void (async () => {
    try {
      const Notifications = await import('expo-notifications');
      Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data as {
          type?: string;
          pendingSpeechId?: string;
        };
        if (data?.type !== SPEECH_ALERT_DATA_TYPE) return;
        void flushPendingSpeech({ force: true });
      });

      // Cold start from notification tap
      const last = await Notifications.getLastNotificationResponseAsync();
      const data = last?.notification.request.content.data as
        | { type?: string }
        | undefined;
      if (data?.type === SPEECH_ALERT_DATA_TYPE) {
        // Slight delay so TTS engine is ready
        setTimeout(() => {
          void flushPendingSpeech({ force: true });
        }, 600);
      }
    } catch (err) {
      if (__DEV__) console.warn('[speechPolicy] notif listener failed:', err);
    }
  })();
}
