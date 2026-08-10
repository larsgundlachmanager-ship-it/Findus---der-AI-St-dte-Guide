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
  }>;
  setAlarmClockIntent?: (
    hour: number,
    minute: number,
    message: string,
  ) => Promise<{
    ok: boolean;
    status: string;
    detail?: string;
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

function successSpeech(hour: number, minute: number, tier: NativeAlarmTier): string {
  const clock = formatClock(hour, minute);
  if (tier === 'notification') {
    return `Alles klar, Wecker ist für ${clock} gestellt (Findus-Mitteilung).`;
  }
  return `Alles klar, Wecker ist für ${clock} gestellt!`;
}

function nativeModule(): FindusAlarmNative | null {
  const m = NativeModules.FindusAlarm as FindusAlarmNative | undefined;
  return m?.setAlarm ? m : null;
}

/** Versuch 1: Expo IntentLauncher → SET_ALARM + SKIP_UI */
async function tryIntentLauncher(
  hour: number,
  minute: number,
  label: string,
): Promise<{ ok: boolean; detail?: string }> {
  if (Platform.OS !== 'android') {
    return { ok: false, detail: 'ios_unsupported' };
  }
  try {
    const IntentLauncher = await import('expo-intent-launcher');
    await IntentLauncher.startActivityAsync('android.intent.action.SET_ALARM', {
      extra: {
        'android.intent.extra.alarm.HOUR': hour,
        'android.intent.extra.alarm.MINUTES': minute,
        'android.intent.extra.alarm.MESSAGE': label,
        'android.intent.extra.alarm.SKIP_UI': true,
        'android.intent.extra.alarm.VIBRATE': true,
      },
    });
    return { ok: true, detail: 'intent_launcher_skip_ui' };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err ?? 'intent_failed');
    console.warn('[alarmService] IntentLauncher failed:', detail);
    return { ok: false, detail };
  }
}

/** Versuch 2: Kotlin AlarmClock (+ AlarmManager Fallback im Modul) */
async function tryKotlinModule(
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

  // Zuerst expliziter AlarmClock-Intent (SKIP_UI)
  if (typeof mod.setAlarmClockIntent === 'function') {
    try {
      const clockRes = await mod.setAlarmClockIntent(hour, minute, label);
      if (clockRes?.ok) {
        return {
          ok: true,
          detail: clockRes.detail,
          status: clockRes.status || 'alarm_clock',
        };
      }
    } catch (err) {
      console.warn('[alarmService] setAlarmClockIntent failed:', err);
    }
  }

  // Hardcore: AlarmManager.setAlarmClock (+ optional Clock-Sync)
  try {
    const res = await mod.setAlarm(hour, minute, label);
    if (res?.ok) {
      return {
        ok: true,
        detail: res.detail,
        status: res.status || 'alarm_manager',
      };
    }
    return {
      ok: false,
      detail: res?.detail || res?.status || 'kotlin_failed',
      status: res?.status,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err ?? 'kotlin_error');
    console.warn('[alarmService] Kotlin setAlarm failed:', detail);
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
 * Stellt einen echten Native-Wecker mit 3-stufiger Fallback-Kette.
 * Erfolg → speech bestätigt; Misserfolg → Berechtigungs-Hinweis.
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

  const label = (input.label || 'Findus').trim().slice(0, 60) || 'Findus';
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
        speech: successSpeech(hour, minute, 'notification'),
      };
    }
    return {
      ok: false,
      reason: notif.reason || 'permission',
      detail: notif.detail,
      speech: PERMISSION_SPEECH,
    };
  }

  // Tier 1 — IntentLauncher (SET_ALARM + SKIP_UI)
  const t1 = await tryIntentLauncher(hour, minute, label);
  if (t1.ok) {
    return {
      ok: true,
      tier: 'intent_launcher',
      hour,
      minute,
      wakeAtMs,
      label,
      detail: t1.detail,
      speech: successSpeech(hour, minute, 'intent_launcher'),
    };
  }

  // Tier 2 — Kotlin AlarmClock / AlarmManager
  const t2 = await tryKotlinModule(hour, minute, label);
  if (t2.ok) {
    return {
      ok: true,
      tier: 'kotlin',
      hour,
      minute,
      wakeAtMs,
      label,
      detail: t2.detail,
      speech: successSpeech(hour, minute, 'kotlin'),
    };
  }

  // Tier 3 — Local Notification
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
      speech: successSpeech(hour, minute, 'notification'),
    };
  }

  return {
    ok: false,
    reason: t3.reason || t2.detail || t1.detail || 'permission',
    detail: [t1.detail, t2.detail, t3.detail].filter(Boolean).join(' | '),
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
