/**
 * Native Alarm Service — 3-tier fallback (Android-first).
 *
 * 1) Expo IntentLauncher → android.intent.action.SET_ALARM (SKIP_UI)
 * 2) Kotlin FindusAlarm → AlarmClock + AlarmManager.setAlarmClock
 * 3) expo-notifications → lokale Wecker-Notification
 *
 * LLM darf Erfolg erst nach ok=true behaupten (background_tasks / Bridge).
 */

import { NativeModules, Platform } from 'react-native';
import { scheduleWakeAlarm } from './notifications/notificationService';
import { buildWakeConfirmSpeech, formatWakeClockDe } from './alarms/wakeConfirmSpeech';

export type NativeAlarmTier = 'intent_launcher' | 'kotlin' | 'notification';

export type SetNativeAlarmInput = {
  /** "HH:MM" oder "H:MM" */
  time: string;
  label?: string;
  /** Absolute ms — überschreibt time wenn gültig */
  wakeAtMs?: number;
};

export type SetNativeAlarmResult = {
  ok: boolean;
  tier?: NativeAlarmTier;
  hour?: number;
  minute?: number;
  wakeAtMs?: number;
  label?: string;
  reason?: string;
  detail?: string;
  /** Fertige Bestätigung / Fehlertext für TTS */
  speech: string;
};

type FindusAlarmNative = {
  setAlarm: (
    hour: number,
    minute: number,
    message: string,
  ) => Promise<{
    ok: boolean;
    status: string;
    detail?: string;
    triggerAtMs?: number;
    clockSynced?: boolean;
  }>;
  setAlarmClockIntent?: (
    hour: number,
    minute: number,
    message: string,
  ) => Promise<{
    ok: boolean;
    status: string;
    detail?: string;
    clockSynced?: boolean;
  }>;
};

const PERMISSION_SPEECH =
  'Ich darf gerade keine Wecker stellen, bitte checke meine Berechtigungen.';

function parseTimeParts(
  input: SetNativeAlarmInput,
): { hour: number; minute: number; wakeAtMs: number } | null {
  if (
    typeof input.wakeAtMs === 'number' &&
    Number.isFinite(input.wakeAtMs) &&
    input.wakeAtMs > Date.now() + 15_000
  ) {
    const d = new Date(input.wakeAtMs);
    return {
      hour: d.getHours(),
      minute: d.getMinutes(),
      wakeAtMs: input.wakeAtMs,
    };
  }

  const raw = String(input.time ?? '').trim();
  const m = raw.match(/^(\d{1,2})[:.](\d{2})$/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  const d = new Date();
  d.setSeconds(0, 0);
  d.setHours(hour, minute, 0, 0);
  if (d.getTime() < Date.now() + 15_000) {
    d.setDate(d.getDate() + 1);
  }
  return { hour, minute, wakeAtMs: d.getTime() };
}

function formatClock(hour: number, minute: number): string {
  return `${hour}:${minute.toString().padStart(2, '0')} Uhr`;
}

function successSpeech(wakeAtMs: number, _tier: NativeAlarmTier): string {
  return buildWakeConfirmSpeech({ wakeAtMs, ok: true });
}

function nativeModule(): FindusAlarmNative | null {
  const m = NativeModules.FindusAlarm as FindusAlarmNative | undefined;
  return m?.setAlarm ? m : null;
}

/** Expo IntentLauncher → SET_ALARM nur an echte Uhr-Apps (nie Sleep-as-Android). */
async function tryIntentLauncher(
  hour: number,
  minute: number,
  label: string,
  opts?: { skipUi?: boolean },
): Promise<{ ok: boolean; detail?: string; viaIntent?: boolean }> {
  if (Platform.OS !== 'android') {
    return { ok: false, detail: 'ios_unsupported' };
  }
  const skipUi = opts?.skipUi !== false;
  const extra = {
    'android.intent.extra.alarm.HOUR': Math.floor(hour),
    'android.intent.extra.alarm.MINUTES': Math.floor(minute),
    'android.intent.extra.alarm.MESSAGE': label,
    'android.intent.extra.alarm.SKIP_UI': skipUi === true,
    'android.intent.extra.alarm.VIBRATE': true,
  };

  // Explizit — sonst greift oft com.urbandroid.sleep (Chooser/Sleep statt Google Clock).
  const targets: Array<{ packageName: string; className: string }> = [
    {
      packageName: 'com.google.android.deskclock',
      className: 'com.android.deskclock.HandleSetApiCalls',
    },
    {
      packageName: 'com.google.android.deskclock',
      className: 'com.android.deskclock.HandleApiCalls',
    },
    {
      packageName: 'com.android.deskclock',
      className: 'com.android.deskclock.HandleSetApiCalls',
    },
    {
      packageName: 'com.sec.android.app.clockpackage',
      className: 'com.sec.android.app.clockpackage.alarm.activity.AlarmCheckDialogActivity',
    },
  ];

  const IntentLauncher = await import('expo-intent-launcher');
  let lastDetail = 'no_clock_target';
  for (const target of targets) {
    try {
      await IntentLauncher.startActivityAsync('android.intent.action.SET_ALARM', {
        packageName: target.packageName,
        className: target.className,
        category: 'android.intent.category.DEFAULT',
        extra,
      });
      return {
        ok: true,
        viaIntent: true,
        detail: `intent_launcher_${target.packageName.split('.').pop()}_skipUi=${skipUi}`,
      };
    } catch (err) {
      lastDetail =
        err instanceof Error ? err.message : String(err ?? 'intent_failed');
      console.warn(
        '[alarmService] IntentLauncher target failed:',
        target.className,
        lastDetail,
      );
    }
  }
  return { ok: false, detail: lastDetail };
}

/** Kotlin: nur AlarmManager (kein Clock-Listeneintrag). */
async function tryKotlinAlarmManager(
  hour: number,
  minute: number,
  label: string,
): Promise<{ ok: boolean; detail?: string; status?: string }> {
  if (Platform.OS !== 'android') {
    return { ok: false, detail: 'ios_unsupported' };
  }
  const mod = nativeModule();
  if (!mod) {
    return { ok: false, detail: 'native_module_missing' };
  }

  try {
    const res = await mod.setAlarm(hour, minute, label);
    if (res?.ok) {
      return {
        ok: true,
        detail: res.detail,
        status: res.status || 'alarm_manager',
      };
    }
  } catch (err) {
    console.warn('[alarmService] Kotlin setAlarm failed:', err);
  }

  return { ok: false, detail: 'kotlin_failed' };
}

/** Kotlin: Google Clock HandleSetApiCalls (braucht sichtbare Activity). */
async function tryKotlinClockIntent(
  hour: number,
  minute: number,
  label: string,
): Promise<{ ok: boolean; detail?: string }> {
  if (Platform.OS !== 'android') {
    return { ok: false, detail: 'ios_unsupported' };
  }
  const mod = nativeModule();
  if (!mod || typeof mod.setAlarmClockIntent !== 'function') {
    return { ok: false, detail: 'clock_intent_missing' };
  }
  try {
    const clockRes = await mod.setAlarmClockIntent(hour, minute, label);
    if (clockRes?.ok) {
      return { ok: true, detail: clockRes.detail || 'alarm_clock' };
    }
    return { ok: false, detail: clockRes?.detail || 'clock_intent_failed' };
  } catch (err) {
    const detail =
      err instanceof Error ? err.message : String(err ?? 'clock_intent_error');
    console.warn('[alarmService] setAlarmClockIntent failed:', detail);
    return { ok: false, detail };
  }
}

/** Versuch 3: In-App Local Notification */
async function tryLocalNotification(
  wakeAtMs: number,
  label: string,
): Promise<{ ok: boolean; detail?: string; reason?: string }> {
  try {
    const notif = await scheduleWakeAlarm({
      wakeAtMs,
      reasonLabel: label,
      reminderKey: `native_alarm:${wakeAtMs}`,
      // Expliziter User-Befehl — nicht von Reminder-Pref blockieren
      force: true,
    });
    if (notif.ok) {
      return { ok: true, detail: 'local_notification' };
    }
    return {
      ok: false,
      reason: notif.reason,
      detail: notif.error || notif.reason,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err ?? 'notif_error');
    return { ok: false, reason: 'error', detail };
  }
}

/**
 * Stellt einen echten Native-Wecker.
 * Android: Kotlin FindusAlarm (Google Clock startActivity + AlarmManager).
 * Kein expo-intent-launcher — der wartet auf Activity-Result und kann hängen.
 * iOS: Mitteilung. LLM darf Erfolg erst nach ok=true behaupten.
 */
export async function setNativeAlarm(
  input: SetNativeAlarmInput,
): Promise<SetNativeAlarmResult> {
  const parts = parseTimeParts(input);
  if (!parts) {
    return {
      ok: false,
      reason: 'bad_time',
      speech: 'Die Uhrzeit für den Wecker ist ungültig.',
    };
  }

  const label = (input.label || 'Yorro').trim().slice(0, 60) || 'Yorro';
  const { hour, minute, wakeAtMs } = parts;

  // iOS: nur Notification-Pfad
  if (Platform.OS !== 'android') {
    const notif = await tryLocalNotification(wakeAtMs, label);
    if (notif.ok) {
      return {
        ok: true,
        tier: 'notification',
        hour,
        minute,
        wakeAtMs,
        label,
        speech: successSpeech(wakeAtMs, 'notification'),
      };
    }
    return {
      ok: false,
      reason: notif.reason || 'permission',
      detail: notif.detail,
      speech: PERMISSION_SPEECH,
    };
  }

  // Primär: derselbe SET_ALARM-Befehl wie Gemini/ADB (HandleSetApiCalls → Clock-Liste)
  console.warn(
    '[alarmService] setNativeAlarm android',
    hour,
    minute,
    'mod=',
    !!nativeModule(),
  );

  const clockOnly = await tryKotlinClockIntent(hour, minute, label);
  if (clockOnly.ok) {
    // Backup Statusleisten-Wecker — Clock-Eintrag ist schon da
    await tryKotlinAlarmManager(hour, minute, label);
    return {
      ok: true,
      tier: 'kotlin',
      hour,
      minute,
      wakeAtMs,
      label,
      detail: clockOnly.detail,
      speech: successSpeech(wakeAtMs, 'kotlin'),
    };
  }

  // Fallback: setAlarm (Clock + AlarmManager kombiniert)
  const mod = nativeModule();
  if (mod) {
    try {
      const res = await mod.setAlarm(hour, minute, label);
      console.warn('[alarmService] setAlarm result', res);
      if (res?.ok && res.clockSynced === true) {
        return {
          ok: true,
          tier: 'kotlin',
          hour,
          minute,
          wakeAtMs,
          label,
          detail: res.detail,
          speech: successSpeech(wakeAtMs, 'kotlin'),
        };
      }
      if (res?.ok) {
        return {
          ok: true,
          tier: 'kotlin',
          hour,
          minute,
          wakeAtMs,
          label,
          detail: `${res.detail || 'alarm_manager'} + clock_app_not_synced`,
          speech: `Interner Wecker um ${formatWakeClockDe(wakeAtMs)} steht — in der Uhr-App konnte ich ihn nicht eintragen.`,
        };
      }
    } catch (err) {
      console.warn('[alarmService] setAlarm failed:', err);
    }
  }

  const t3 = await tryLocalNotification(wakeAtMs, label);
  if (t3.ok) {
    return {
      ok: true,
      tier: 'notification',
      hour,
      minute,
      wakeAtMs,
      label,
      detail: t3.detail,
      speech: successSpeech(wakeAtMs, 'notification'),
    };
  }

  return {
    ok: false,
    reason: t3.reason || clockOnly.detail || 'permission',
    detail: [clockOnly.detail, t3.detail].filter(Boolean).join(' | '),
    speech: PERMISSION_SPEECH,
  };
}

/** Alias für Orchestrator / background_tasks */
export async function executeSetNativeAlarmTask(task: {
  time?: string;
  label?: string;
  wakeAtMs?: number;
  dateIso?: string;
}): Promise<SetNativeAlarmResult> {
  const wakeAtMs =
    typeof task.wakeAtMs === 'number'
      ? task.wakeAtMs
      : task.dateIso
        ? Date.parse(task.dateIso)
        : undefined;
  return setNativeAlarm({
    time: task.time ?? '',
    label: task.label,
    wakeAtMs: Number.isFinite(wakeAtMs) ? wakeAtMs : undefined,
  });
}

export const NATIVE_ALARM_PERMISSION_SPEECH = PERMISSION_SPEECH;
