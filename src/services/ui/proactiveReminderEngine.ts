/**
 * Proaktive Erinnerungen — alle ~15 Min evaluieren.
 * Voice: Flug · Reservierung · Leave-by (hohe Prio)
 * HUD: Sonnencreme · Wasser · Wetter · Tasks (niedrige Prio)
 * Push: Teaser (Lockscreen) → Tap spricht den vollen Hinweis
 */

import * as Notifications from 'expo-notifications';
import { Platform, Vibration } from 'react-native';
import {
  collectHudTipCandidates,
  HUD_ENGINE_INTERVAL_MS,
  type HudTipCandidate,
  type HudTipKind,
} from './proactiveHudEngine';
import { useFinnusStore } from '../../store/useFinnusStore';
import {
  configureNotificationHandler,
  REMINDERS_CHANNEL_ID,
  requestNotificationPermission,
} from '../notifications/notificationService';
import {
  buildHudTipFullLine,
  buildHudTipPushTeaser,
} from '../notifications/notificationTeaser';
import { RAIN_ALERT_DATA_TYPE } from '../notifications/rainAlertNotifications';
import { speakRuntimeText } from '../../runtime/speechModule';
import { getVoiceSettingsForTour } from '../ttsService';
import { isDeviceOffline } from '../navigation/networkState';
import { tickLogisticsTriggerEngine } from '../logistics/logisticsTriggerEngine';
import { allowProactiveReminder, allowCriticalProactiveVoice } from './nachtruhePolicy';

export const REMINDER_ENGINE_INTERVAL_MS = HUD_ENGINE_INTERVAL_MS;
export const REMINDER_PUSH_DATA_TYPE = 'proactive_reminder';

export type ReminderChannel = 'voice' | 'hud' | 'push';

const VOICE_KINDS = new Set<HudTipKind>([
  'session_deadline',
  'shopping_closing',
  'hotel_checkin',
]);

const HUD_ONLY_KINDS = new Set<HudTipKind>([
  'weather_summary',
  'open_task',
  'generic',
  'weather_rain',
  'hotel_breakfast',
  'wake_alarm',
]);

/** Soft channel — Hitze, Gepäck, Sunset, Schirm, Zeitlücke, Outfit-Tipps */
const NICE_PUSH_KINDS = new Set<HudTipKind>([
  'weather_heat',
  'weather_summary',
  'luggage_drop',
  'umbrella_day',
  'sunset_tip',
  'free_slot',
  'nice_tip',
]);

let lastTickMs = 0;
let lastVoiceTipId: string | null = null;
let lastPushTipId: string | null = null;
let tapListenerReady = false;
let pendingPushFullText: string | null = null;

function classifyChannel(tip: HudTipCandidate): ReminderChannel {
  if (tip.score >= 88 && VOICE_KINDS.has(tip.kind)) return 'voice';
  if (tip.score >= 82 && tip.kind === 'session_deadline') return 'voice';
  // Nice-to-know: Push ohne Vibration-Spam (Hitze / Tipps)
  if (NICE_PUSH_KINDS.has(tip.kind) && tip.score >= 60) return 'push';
  if (HUD_ONLY_KINDS.has(tip.kind) && tip.score < 75) return 'hud';
  if (tip.score >= 90) return 'push';
  return 'hud';
}

function pulsePushAttention(): void {
  try {
    if (Platform.OS === 'android') {
      Vibration.vibrate([0, 250, 120, 250]);
    }
  } catch {
    /* ignore */
  }
}

async function speakFullReminder(line: string): Promise<void> {
  const store = useFinnusStore.getState();
  if (store.isListening || store.isGenerating) return;
  try {
    const voice = await getVoiceSettingsForTour();
    store.addChatMessage({ role: 'assistant', content: line });
    await speakRuntimeText(
      line,
      { voiceId: voice.voiceId, speechRate: voice.speechRate },
      { deliveryKind: 'reminder' },
    );
  } catch (err) {
    if (__DEV__) console.warn('[reminder] speak after tap failed', err);
  }
}

/** Once: Tap auf Reminder-Push → voller Hinweis. */
export function bootstrapReminderPushTapHandler(): void {
  if (tapListenerReady) return;
  tapListenerReady = true;
  void (async () => {
    try {
      Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data as {
          type?: string;
          fullText?: string;
        };
        if (
          data?.type !== REMINDER_PUSH_DATA_TYPE &&
          data?.type !== RAIN_ALERT_DATA_TYPE
        ) {
          return;
        }
        const line =
          (typeof data.fullText === 'string' && data.fullText.trim()) ||
          pendingPushFullText;
        if (!line) return;
        pendingPushFullText = null;
        void speakFullReminder(line);
      });

      const last = await Notifications.getLastNotificationResponseAsync();
      const data = last?.notification.request.content.data as
        | { type?: string; fullText?: string }
        | undefined;
      if (
        data?.type === REMINDER_PUSH_DATA_TYPE ||
        data?.type === RAIN_ALERT_DATA_TYPE
      ) {
        if (data.fullText) {
          setTimeout(() => {
            void speakFullReminder(String(data.fullText));
          }, 700);
        }
      }
    } catch (err) {
      if (__DEV__) console.warn('[reminder] tap listener failed', err);
    }
  })();
}

// Early wiring so cold-start taps work even before first tick
bootstrapReminderPushTapHandler();

async function pushReminder(tip: HudTipCandidate): Promise<void> {
  if (lastPushTipId === tip.id) return;
  lastPushTipId = tip.id;
  bootstrapReminderPushTapHandler();
  try {
    // Nice-to-know (Hitze etc.) → sanfter Channel, kein Vibrieren
    if (NICE_PUSH_KINDS.has(tip.kind)) {
      const { scheduleNiceInfoPush } = await import(
        '../notifications/niceInfoNotifications'
      );
      const teaser = buildHudTipPushTeaser(tip);
      await scheduleNiceInfoPush({
        title: teaser.title,
        body: teaser.body,
        dataKey: tip.id,
      });
      return;
    }

    await configureNotificationHandler();
    const perm = await requestNotificationPermission();
    if (!perm.granted) return;

    const teaser = buildHudTipPushTeaser(tip);
    const fullText = buildHudTipFullLine(tip);
    pendingPushFullText = fullText;
    pulsePushAttention();

    await Notifications.scheduleNotificationAsync({
      content: {
        title: teaser.title,
        body: teaser.body,
        sound: true,
        priority: Notifications.AndroidNotificationPriority.HIGH,
        data: {
          type: REMINDER_PUSH_DATA_TYPE,
          kind: tip.kind,
          tipId: tip.id,
          fullText,
        },
        ...(Platform.OS === 'android'
          ? { channelId: REMINDERS_CHANNEL_ID }
          : null),
      },
      trigger: null,
    });
  } catch (err) {
    if (__DEV__) console.warn('[reminder] push failed', err);
  }
}

async function voiceReminder(tip: HudTipCandidate): Promise<void> {
  if (lastVoiceTipId === tip.id) return;
  const store = useFinnusStore.getState();
  if (store.isPlayingAudio || store.isListening || store.isGenerating) return;
  if (store.activeConciergeCard) return;
  // Planung/Kalender aktiv → kein Random-Speak
  try {
    const { isPlanningModuleActive } = require('../../module2/planning/planSessionState') as {
      isPlanningModuleActive: () => boolean;
    };
    const { usePlanCalendarUiStore } = require('../../module2/timeline/planCalendarUiStore') as {
      usePlanCalendarUiStore: { getState: () => { calendarVisible: boolean } };
    };
    if (
      isPlanningModuleActive() ||
      usePlanCalendarUiStore.getState().calendarVisible
    ) {
      return;
    }
  } catch {
    /* soft */
  }

  lastVoiceTipId = tip.id;
  const line = buildHudTipFullLine(tip);
  try {
    const voice = await getVoiceSettingsForTour();
    await speakRuntimeText(
      line,
      { voiceId: voice.voiceId, speechRate: voice.speechRate },
      { deliveryKind: 'reminder' },
    );
  } catch (err) {
    if (__DEV__) console.warn('[reminder] voice failed', err);
  }
}

export type ReminderEvaluation = {
  hudTips: HudTipCandidate[];
  voiceTip: HudTipCandidate | null;
  pushTip: HudTipCandidate | null;
};

/**
 * Alle 15 Min (oder force) — sammelt, priorisiert, feuert Voice/Push.
 */
export async function tickProactiveReminderEngine(opts?: {
  force?: boolean;
  lat?: number | null;
  lng?: number | null;
}): Promise<ReminderEvaluation> {
  const now = Date.now();
  if (
    !opts?.force &&
    lastTickMs > 0 &&
    now - lastTickMs < REMINDER_ENGINE_INTERVAL_MS
  ) {
    return { hudTips: [], voiceTip: null, pushTip: null };
  }
  lastTickMs = now;

  // Progressive logistics checkpoints (ICE/Bus/Flug/Zeit/Geo)
  void tickLogisticsTriggerEngine({ force: opts?.force, nowMs: now });

  // Nice-Info-Szenarien (Gepäck-Morgen, Schirm, Sunset, …) — soft Push, Dedup intern
  try {
    const { tickNiceInfoScenarios } = require('./niceInfoScenarios') as {
      tickNiceInfoScenarios: (opts?: {
        nowMs?: number;
      }) => Promise<{ pushed: number }>;
    };
    void tickNiceInfoScenarios({ nowMs: now });
  } catch {
    /* soft */
  }

  const store = useFinnusStore.getState();
  const tips = collectHudTipCandidates({
    nowMs: now,
    lat: opts?.lat ?? store.lastGpsLat,
    lng: opts?.lng ?? store.lastGpsLng,
  })
    .filter((t) =>
      allowProactiveReminder({ kind: t.kind, score: t.score, nowMs: now }),
    )
    .sort((a, b) => b.score - a.score);

  let voiceTip: HudTipCandidate | null = null;
  let pushTip: HudTipCandidate | null = null;

  const offline = await isDeviceOffline();

  for (const tip of tips) {
    const channel = classifyChannel(tip);
    const voiceOk = allowCriticalProactiveVoice({
      kind: tip.kind,
      score: tip.score,
      nowMs: now,
    });
    if (channel === 'voice' && !voiceTip && !offline && voiceOk) {
      voiceTip = tip;
      await voiceReminder(tip);
    } else if (channel === 'push' && !pushTip) {
      // Push in Nachtruhe nur bei kritischen Tips (bereits gefiltert)
      pushTip = tip;
      await pushReminder(tip);
    }
  }

  return {
    hudTips: tips.slice(0, 6),
    voiceTip,
    pushTip,
  };
}

/** HUD-Live-Chips — mehrere relevante Zeilen. */
export function getLiveHudReminderLines(): string[] {
  return collectHudTipCandidates()
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((t) => t.text);
}
