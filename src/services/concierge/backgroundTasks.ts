/**
 * Background Tasks aus LLM-JSON — vor TTS ausführen.
 * Erfolg/Misserfolg steuert die gesprochene Bestätigung (kein Fake-„Wecker gestellt“).
 */

import type {
  BackgroundTask,
  GeminiConciergeResponse,
  QuickAction,
} from '../../types/concierge';
import {
  executeSetNativeAlarmTask,
  NATIVE_ALARM_PERMISSION_SPEECH,
  type SetNativeAlarmResult,
} from '../alarmService';
import { recordWakeOnTimeline } from '../alarms/nativeAlarmBridge';

const ALARM_CLAIM_RE =
  /\b(wecker\s+(?:ist\s+)?(?:gestellt|gesetzt|aktiv)|ich\s+habe\s+den\s+wecker|hab(?:e|)\s+den\s+wecker\s+gestellt|alles\s+klar[^.!]{0,40}wecker|aufsteh(?:-|\s)?wecker\s+(?:steht|gestellt))\b/iu;

export function claimsAlarmSet(speech: string): boolean {
  return ALARM_CLAIM_RE.test(speech.replace(/\s+/g, ' ').trim());
}

function normalizeBackgroundTask(raw: unknown): BackgroundTask | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const typeRaw = String(o.type ?? '')
    .toUpperCase()
    .replace(/\s+/g, '_');
  if (
    typeRaw !== 'SET_NATIVE_ALARM' &&
    typeRaw !== 'SET_WAKE_ALARM' &&
    typeRaw !== 'NATIVE_ALARM'
  ) {
    return null;
  }
  const time =
    o.time != null
      ? String(o.time).trim()
      : o.timeLabel != null
        ? String(o.timeLabel).replace(/\s*uhr\s*$/i, '').trim()
        : undefined;
  const label =
    o.label != null
      ? String(o.label).trim()
      : o.destName != null
        ? String(o.destName).trim()
        : o.message != null
          ? String(o.message).trim()
          : undefined;
  const dateIso = o.dateIso != null ? String(o.dateIso) : undefined;
  const wakeAtMs =
    typeof o.wakeAtMs === 'number' && Number.isFinite(o.wakeAtMs)
      ? o.wakeAtMs
      : undefined;
  if (!time && !dateIso && wakeAtMs == null) return null;
  return {
    type: 'SET_NATIVE_ALARM',
    time: time || undefined,
    label: label || undefined,
    dateIso,
    wakeAtMs,
  };
}

export function parseBackgroundTasks(raw: unknown): BackgroundTask[] {
  if (!Array.isArray(raw)) return [];
  const out: BackgroundTask[] = [];
  for (const item of raw) {
    const n = normalizeBackgroundTask(item);
    if (n) out.push(n);
  }
  return out.slice(0, 4);
}

/** LLM behauptet „gestellt“ + SET_WAKE_ALARM-Button mit Zeit → als Native-Task ausführen. */
function promoteWakeActionsToTasks(
  response: GeminiConciergeResponse,
): BackgroundTask[] {
  if (!claimsAlarmSet(response.speechText)) return [];
  const out: BackgroundTask[] = [];
  for (const a of response.quickActions as QuickAction[]) {
    if (a.type !== 'SET_WAKE_ALARM') continue;
    const dateIso = a.payload.dateIso;
    const timeLabel = a.payload.timeLabel
      ?.replace(/\s*uhr\s*$/i, '')
      .trim();
    if (!dateIso && !timeLabel) continue;
    out.push({
      type: 'SET_NATIVE_ALARM',
      dateIso,
      time: timeLabel,
      label: a.payload.destName || a.label,
    });
  }
  return out;
}

export type BackgroundTaskRunResult = {
  response: GeminiConciergeResponse;
  alarmResults: SetNativeAlarmResult[];
  changed: boolean;
};

/**
 * Führt background_tasks aus und koppelt speechText an das echte Ergebnis.
 * Ohne Tasks: Speech unverändert (z. B. Clock-Intent hat Native schon gesetzt).
 */
export async function applyBackgroundTasks(
  response: GeminiConciergeResponse,
): Promise<BackgroundTaskRunResult> {
  const explicit = response.backgroundTasks ?? [];
  const promoted =
    explicit.length === 0 ? promoteWakeActionsToTasks(response) : [];
  const alarmTasks = [...explicit, ...promoted].filter(
    (t) => t.type === 'SET_NATIVE_ALARM',
  );

  if (alarmTasks.length === 0) {
    return { response, alarmResults: [], changed: false };
  }

  const alarmResults: SetNativeAlarmResult[] = [];
  let speech = response.speechText;
  let changed = false;
  const consumedWakeActions = promoted.length > 0;

  for (const task of alarmTasks) {
    const result = await executeSetNativeAlarmTask({
      time: task.time,
      label: task.label,
      dateIso: task.dateIso,
      wakeAtMs: task.wakeAtMs,
    });
    alarmResults.push(result);

    if (result.ok && result.wakeAtMs != null) {
      try {
        recordWakeOnTimeline({
          wakeAtMs: result.wakeAtMs,
          reasonLabel: result.label || task.label || 'Wecker',
          channel: result.tier === 'notification' ? 'notification' : 'native',
        });
      } catch {
        /* soft */
      }
    }

    speech = result.ok
      ? result.speech
      : result.speech || NATIVE_ALARM_PERMISSION_SPEECH;
    changed = true;
  }

  return {
    response: {
      ...response,
      speechText: speech,
      backgroundTasks: [],
      quickActions: consumedWakeActions
        ? response.quickActions.filter((a) => a.type !== 'SET_WAKE_ALARM')
        : response.quickActions,
    },
    alarmResults,
    changed,
  };
}
