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
import { setWakeAlarmWithBridge } from '../alarms/nativeAlarmBridge';
import { buildWakeSuccessExtras } from '../alarms/wakeAlarmAdvisor';
import { hasClockHint } from '../alarms/wakeIntentDetect';

/** Alles, was „Wecker ist schon erledigt“ behauptet — ohne Native-Beweis = Lüge. */
const ALARM_CLAIM_RE =
  /\b(?:wecker\s+(?:ist\s+)?(?:gestellt|gesetzt|aktiv|steht)|ich\s+habe\s+(?:deinen\s+|den\s+)?wecker|hab(?:e|)\s+(?:den\s+)?wecker\s+gestellt|alles\s+klar[^.!]{0,48}wecker|aufsteh(?:-|\s)?wecker\s+(?:steht|gestellt)|ich\s+weck(?:e|)\s+dich|ich\s+werde\s+dich\s+weck|ich\s+erinnere\s+dich\s+(?:spätestens\s+)?um|erinner(?:e|)\s+dich\s+(?:spätestens\s+)?um|wecker\s+auf\s+\d)/iu;

const HONEST_NEED_TIME =
  'Sag mir die Uhrzeit — dann stelle ich den Wecker echt (Android + Timeline).';

const HONEST_STRIP =
  'Den Wecker habe ich noch nicht gestellt';

export function claimsAlarmSet(speech: string): boolean {
  return ALARM_CLAIM_RE.test(speech.replace(/\s+/g, ' ').trim());
}

/** Soft: „ich wecke dich morgen um 8“ ohne hartes „gestellt“. */
export function impliesWakePromise(speech: string): boolean {
  const t = speech.replace(/\s+/g, ' ').trim();
  if (claimsAlarmSet(t)) return true;
  return /\b(?:ich\s+weck|werde\s+dich\s+weck|wecke\s+dich|erinnere\s+dich\s+um|stell(?:e|)\s+(?:dir\s+)?(?:den\s+)?wecker)\b/iu.test(
    t,
  );
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

function promoteWakeActionsToTasks(
  response: GeminiConciergeResponse,
): BackgroundTask[] {
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

/**
 * Zeit aus Speech/User-Text ziehen → Task (Recovery wenn LLM nur redet).
 */
async function recoverWakeTaskFromText(
  speech: string,
  userText?: string,
): Promise<BackgroundTask | null> {
  try {
    const { resolveDateTimeMs } = await import('../time/temporalGerman');
    const blob = `${userText || ''} ${speech}`.replace(/\s+/g, ' ').trim();
    if (!hasClockHint(blob)) return null;
    const ms = resolveDateTimeMs({ text: blob, defaultHour: 8 });
    if (ms == null || ms < Date.now() + 20_000) {
      // Fallback: erste Uhrzeit im Blob
      const m =
        blob.match(/\b(\d{1,2})[:.](\d{2})\b/) ||
        blob.match(/\b(?:um\s+)?(\d{1,2})(?::(\d{2}))?\s*(?:uhr)?\b/i);
      if (!m) return null;
      const h = Number(m[1]);
      const min = Number(m[2] ?? 0);
      if (h < 0 || h > 23 || min < 0 || min > 59) return null;
      const d = new Date();
      d.setSeconds(0, 0);
      d.setHours(h, min, 0, 0);
      if (d.getTime() < Date.now() + 2 * 60_000) d.setDate(d.getDate() + 1);
      return {
        type: 'SET_NATIVE_ALARM',
        wakeAtMs: d.getTime(),
        time: `${h}:${String(min).padStart(2, '0')}`,
        label: 'Aufstehen',
      };
    }
    const d = new Date(ms);
    return {
      type: 'SET_NATIVE_ALARM',
      wakeAtMs: ms,
      time: `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`,
      label: 'Aufstehen',
    };
  } catch {
    return null;
  }
}

function stripAlarmClaims(speech: string, replacement: string): string {
  let t = speech.replace(/\s+/g, ' ').trim();
  // Ganze Sätze mit Fake-Weck-Promise raus / ersetzen
  t = t
    .replace(
      /[^.!?]*(?:ich\s+habe\s+(?:deinen\s+|den\s+)?wecker|wecker\s+(?:ist\s+)?(?:gestellt|gesetzt)|ich\s+weck(?:e|)\s+dich|ich\s+werde\s+dich\s+weck|ich\s+erinnere\s+dich\s+(?:spätestens\s+)?um)[^.!?]*[.!?]?/giu,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || t.length < 12) return replacement;
  if (impliesWakePromise(t) || claimsAlarmSet(t)) {
    return `${replacement}. ${t}`.replace(/\s+/g, ' ').trim();
  }
  return `${replacement} — ${t}`.replace(/\s+/g, ' ').trim();
}

export type BackgroundTaskRunResult = {
  response: GeminiConciergeResponse;
  alarmResults: SetNativeAlarmResult[];
  changed: boolean;
};

/**
 * Führt background_tasks aus und koppelt speechText an das echte Ergebnis.
 * Fake-Claims ohne Task → Zeit aus Text/User retten und stellen, sonst ehrlich strippen.
 */
export async function applyBackgroundTasks(
  response: GeminiConciergeResponse,
  opts?: { userText?: string },
): Promise<BackgroundTaskRunResult> {
  const explicit = response.backgroundTasks ?? [];
  let promoted =
    explicit.length === 0 ? promoteWakeActionsToTasks(response) : [];

  // LLM behauptet Erfolg / Weck-Versprechen ohne Task → Recovery
  const promised =
    claimsAlarmSet(response.speechText) ||
    impliesWakePromise(response.speechText);
  if (explicit.length === 0 && promoted.length === 0 && promised) {
    const recovered = await recoverWakeTaskFromText(
      response.speechText,
      opts?.userText,
    );
    if (recovered) promoted = [recovered];
  }

  const alarmTasks = [...explicit, ...promoted].filter(
    (t) => t.type === 'SET_NATIVE_ALARM',
  );

  if (alarmTasks.length === 0) {
    if (!promised) {
      return { response, alarmResults: [], changed: false };
    }
    // Keine Zeit rekonstruierbar → nie Fake stehen lassen
    const honest = hasClockHint(`${opts?.userText || ''} ${response.speechText}`)
      ? stripAlarmClaims(response.speechText, HONEST_STRIP)
      : stripAlarmClaims(response.speechText, HONEST_NEED_TIME);
    const retryActions: QuickAction[] = [];
    // Wenn User-Zeit klar war aber Recovery scheiterte — Button mit Prompt
    if (opts?.userText && hasClockHint(opts.userText)) {
      retryActions.push({
        type: 'SET_WAKE_ALARM',
        label: 'Wecker jetzt stellen',
        payload: { textPrompt: opts.userText },
      });
    } else {
      retryActions.push({
        type: 'SHOW_MORE',
        label: 'Wecker um 7 Uhr',
        payload: { textPrompt: 'Wecke mich um 7 Uhr' },
      });
      retryActions.push({
        type: 'SHOW_MORE',
        label: 'Wecker um 8 Uhr',
        payload: { textPrompt: 'Wecke mich um 8 Uhr' },
      });
    }
    return {
      response: {
        ...response,
        speechText: honest,
        visualBullets: ['Wecker noch nicht gestellt', 'Uhrzeit tippen oder sagen'],
        quickActions: [...retryActions, ...response.quickActions].slice(0, 4),
        backgroundTasks: [],
      },
      alarmResults: [],
      changed: true,
    };
  }

  const alarmResults: SetNativeAlarmResult[] = [];
  let speech = response.speechText;
  let bullets = [...(response.visualBullets ?? [])];
  let actions = [...response.quickActions];
  let changed = false;
  const consumedWakeActions = promoted.length > 0;

  for (const task of alarmTasks) {
    const wakeAtMs =
      typeof task.wakeAtMs === 'number'
        ? task.wakeAtMs
        : task.dateIso
          ? Date.parse(task.dateIso)
          : undefined;

    // Bridge = Native + Timeline + zeitliche Trigger (SSOT)
    let result: SetNativeAlarmResult;
    if (wakeAtMs != null && Number.isFinite(wakeAtMs)) {
      const bridged = await setWakeAlarmWithBridge({
        wakeAtMs,
        reasonLabel: task.label || 'Aufstehen',
        preferNative: true,
      });
      if (bridged.needsChoice && bridged.existingWakeAtMs != null) {
        const { formatClockDe } = await import('../alarms/wakeAlarmAdvisor');
        const oldC = formatClockDe(bridged.existingWakeAtMs);
        const newC = formatClockDe(wakeAtMs);
        return {
          response: {
            ...response,
            speechText:
              bridged.message ||
              `Schon ein Wecker um ${oldC}. Neu wäre ${newC}.`,
            visualBullets: [`Bestehend ${oldC}`, `Neu ${newC}`],
            backgroundTasks: [],
            quickActions: [
              {
                type: 'SET_WAKE_ALARM',
                label: 'Aktualisieren',
                payload: {
                  dateIso: new Date(wakeAtMs).toISOString(),
                  timeLabel: newC,
                  destName: task.label || 'Aufstehen',
                  wakeMode: 'replace',
                  replaceWakeAtMs: bridged.existingWakeAtMs,
                },
              },
              {
                type: 'SET_WAKE_ALARM',
                label: 'Zweiten stellen',
                payload: {
                  dateIso: new Date(wakeAtMs).toISOString(),
                  timeLabel: newC,
                  destName: task.label || 'Aufstehen',
                  wakeMode: 'add',
                },
              },
            ],
          },
          alarmResults: [],
          changed: true,
        };
      }
      result = {
        ok: bridged.ok,
        wakeAtMs: bridged.wakeAtMs,
        label: task.label,
        reason: bridged.reason,
        speech:
          bridged.message ||
          (bridged.ok
            ? `Ich habe deinen Wecker gestellt.`
            : NATIVE_ALARM_PERMISSION_SPEECH),
        tier:
          bridged.channel === 'native'
            ? 'kotlin'
            : bridged.channel === 'notification'
              ? 'notification'
              : undefined,
      };
    } else {
      result = await executeSetNativeAlarmTask({
        time: task.time,
        label: task.label,
        dateIso: task.dateIso,
        wakeAtMs: task.wakeAtMs,
      });
      if (result.ok && result.wakeAtMs != null) {
        try {
          const { recordWakeOnTimeline } = await import(
            '../alarms/nativeAlarmBridge'
          );
          recordWakeOnTimeline({
            wakeAtMs: result.wakeAtMs,
            reasonLabel: result.label || task.label || 'Wecker',
            channel: result.tier === 'notification' ? 'notification' : 'native',
          });
        } catch {
          /* soft */
        }
      }
    }

    alarmResults.push(result);
    changed = true;

    if (result.ok && result.wakeAtMs != null) {
      speech = result.speech;
      const extras = buildWakeSuccessExtras({
        wakeAtMs: result.wakeAtMs,
        reasonLabel: task.label || 'Aufstehen',
      });
      bullets = extras.bullets;
      actions = consumedWakeActions
        ? [
            ...extras.quickActions,
            ...response.quickActions.filter((a) => a.type !== 'SET_WAKE_ALARM'),
          ].slice(0, 4)
        : [...extras.quickActions, ...response.quickActions].slice(0, 4);
    } else {
      speech = result.speech || NATIVE_ALARM_PERMISSION_SPEECH;
      bullets = ['Wecker nicht gestellt'];
      actions = [
        {
          type: 'SET_WAKE_ALARM' as const,
          label: 'Nochmal versuchen',
          payload: {
            dateIso: task.dateIso,
            timeLabel: task.time,
            destName: task.label || 'Aufstehen',
            textPrompt: opts?.userText,
          },
        },
        ...response.quickActions.filter((a) => a.type !== 'SET_WAKE_ALARM'),
      ].slice(0, 4);
    }
  }

  return {
    response: {
      ...response,
      speechText: speech,
      visualBullets: bullets.slice(0, 3),
      backgroundTasks: [],
      quickActions: actions,
    },
    alarmResults,
    changed,
  };
}
