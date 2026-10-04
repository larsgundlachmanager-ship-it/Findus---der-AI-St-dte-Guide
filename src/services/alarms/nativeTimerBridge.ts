/**
 * Native Küchen-Timer — Android Clock SET_TIMER + AlarmManager (Hintergrund/Display-aus).
 */

import { NativeModules, Platform } from 'react-native';

export type NativeTimerResult = {
  ok: boolean;
  channel: 'native' | 'failed';
  endsAtMs?: number;
  requestCode?: number;
  reason?: string;
  detail?: string;
};

type FindusTimerNative = {
  setTimer: (
    lengthSec: number,
    message: string,
  ) => Promise<{
    ok: boolean;
    status?: string;
    detail?: string;
    triggerAtMs?: number;
    requestCode?: number;
    clockSynced?: boolean;
  }>;
  cancelTimerAt?: (triggerAtMs: number) => Promise<boolean>;
};

function nativeModule(): FindusTimerNative | null {
  if (Platform.OS !== 'android') return null;
  const m = NativeModules.FindusAlarm as FindusTimerNative | undefined;
  return m?.setTimer ? m : null;
}

export async function setNativeKitchenTimer(opts: {
  durationMs: number;
  label: string;
}): Promise<NativeTimerResult> {
  const mod = nativeModule();
  if (!mod) {
    return {
      ok: false,
      channel: 'failed',
      reason: Platform.OS === 'ios' ? 'ios_unsupported' : 'native_module_missing',
    };
  }
  const lengthSec = Math.max(
    5,
    Math.min(12 * 60 * 60, Math.round(opts.durationMs / 1000)),
  );
  const label = (opts.label || 'Timer').trim().slice(0, 60) || 'Timer';
  try {
    const res = await mod.setTimer(lengthSec, label);
    if (res?.ok) {
      return {
        ok: true,
        channel: 'native',
        endsAtMs:
          typeof res.triggerAtMs === 'number' && Number.isFinite(res.triggerAtMs)
            ? res.triggerAtMs
            : Date.now() + lengthSec * 1000,
        requestCode: res.requestCode,
        detail: res.detail || res.status,
      };
    }
    return {
      ok: false,
      channel: 'failed',
      reason: res?.status || 'no_handler',
      detail: res?.detail,
    };
  } catch (err) {
    return {
      ok: false,
      channel: 'failed',
      reason: 'error',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function cancelNativeKitchenTimer(
  endsAtMs: number,
): Promise<boolean> {
  const mod = nativeModule();
  if (!mod?.cancelTimerAt) return false;
  try {
    await mod.cancelTimerAt(endsAtMs);
    return true;
  } catch {
    return false;
  }
}
