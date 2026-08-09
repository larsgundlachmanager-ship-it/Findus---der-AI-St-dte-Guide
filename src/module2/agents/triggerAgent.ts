import type { Module2Agent } from './types';
import { setWakeAlarmWithBridge } from '../../services/alarms/nativeAlarmBridge';
import {
  parseTimerDurationMs,
  startFindusTimer,
} from '../../services/alarms/timerService';
import {
  useFuturePlanStore,
} from '../timeline/futurePlanState';
import { todayDateKey } from '../../utils/dateKeys';

function parseReminder(text: string): {
  label: string;
  atMs: number | null;
  isWake: boolean;
  durationMs: number | null;
} {
  const durationMs = parseTimerDurationMs(text);
  const isPowerNap = /powernap|power\s*nap|nickerchen|kurzschlaf|power\s*napp/i.test(
    text,
  );
  const time =
    text.match(/\b(?:um\s*)?(\d{1,2})[:.](\d{2})\b/) ||
    text.match(/\b(?:um\s*)?(\d{1,2})\s*uhr\b/i);
  let atMs: number | null = null;
  if (time) {
    const h = Number(time[1]);
    const m = time[2] != null ? Number(time[2]) : 0;
    const d = new Date();
    d.setSeconds(0, 0);
    d.setHours(h, m, 0, 0);
    if (d.getTime() < Date.now() - 30_000) d.setDate(d.getDate() + 1);
    atMs = d.getTime();
  }
  const isWake =
    /\b(weck|wecker|aufweck|wecke)\w*\b/i.test(text) || isPowerNap;
  let label = isWake ? 'Aufstehen' : 'Erinnerung';
  if (isPowerNap) label = 'Powernap';
  else if (/zähne|zaehne|putzen/i.test(text)) label = 'Zähne putzen';
  else if (/medikament|tablette/i.test(text)) label = 'Medikament';
  else if (!isWake) {
    const m = text.match(/erinner\w*\s+(?:mich\s+)?(?:an\s+|zum\s+)?(.+)/i);
    if (m?.[1]) {
      label =
        m[1]
          .replace(/\bum\s+\d.*/, '')
          .trim()
          .slice(0, 40) || label;
    }
  }

  // Dauer ohne feste Uhrzeit → Timer/Wecker relativ
  if (atMs == null && durationMs != null) {
    atMs = Date.now() + durationMs;
  }

  return { label, atMs, isWake, durationMs };
}

function recordActivityOnTimeline(opts: {
  title: string;
  startMs: number;
  endMs: number;
  emoji?: string;
}): void {
  const dayKey = todayDateKey();
  useFuturePlanStore.getState().ensureDay(dayKey);
  useFuturePlanStore.getState().upsertStopOnDay(dayKey, {
    id: `activity_${opts.startMs}`,
    title: opts.title,
    plannedStartMs: opts.startMs,
    plannedEndMs: opts.endMs,
    bufferMin: 0,
    transport: 'unknown',
    kind: 'stop',
    status: 'trigger_active',
    hardAnchor: true,
    emoji: opts.emoji ?? '⏱️',
    notes: 'zeitlicher Trigger / Aktivität',
  });
}

export const triggerAgent: Module2Agent = {
  id: 'trigger',
  intents: ['trigger'],
  async run({ task }) {
    const { label, atMs, isWake, durationMs } = parseReminder(
      task.rewrittenText,
    );
    const when =
      atMs != null
        ? new Date(atMs).toLocaleTimeString('de-DE', {
            hour: '2-digit',
            minute: '2-digit',
          })
        : null;

    // Powernap / relative Dauer → Timer + Timeline-Block
    if (
      durationMs != null &&
      (/powernap|power\s*nap|nickerchen|timer|eieruhr/i.test(
        task.rewrittenText,
      ) ||
        (!/\b\d{1,2}[:.]\d{2}\b|\b\d{1,2}\s*uhr\b/i.test(task.rewrittenText) &&
          durationMs > 0))
    ) {
      const started = await startFindusTimer({
        durationMs,
        label,
      });
      if (started.ok && started.endsAtMs) {
        const startMs = Date.now();
        recordActivityOnTimeline({
          title: label,
          startMs,
          endMs: started.endsAtMs,
          emoji: '😴',
        });
      }
      return {
        agent: 'trigger',
        ok: started.ok,
        draftText: [
          'FAKTEN Trigger:',
          `Aktion: ${label}`,
          `Dauer: ${Math.round(durationMs / 60_000)} Min`,
          started.ok ? 'Timer aktiv + Timeline eingetragen' : 'Timer fehlgeschlagen',
          'FLOW: Bridge fortsetzen → knappe Bestätigung, kein zweites „ich verstehe Timer“.',
        ].join('\n'),
        bullets: [],
        buttons: [],
        meta: { label, durationMs, endsAtMs: started.endsAtMs },
        error: started.ok
          ? undefined
          : { code: 'timer', message: started.speech },
      };
    }

    if (atMs == null) {
      return {
        agent: 'trigger',
        ok: true,
        draftText: [
          'FAKTEN Trigger:',
          `Label: ${label}`,
          'Status: Uhrzeit fehlt',
          'FLOW: eine gezielte Rückfrage zur Uhrzeit — Wortlaut frei.',
        ].join('\n'),
        bullets: [],
        buttons: [],
        meta: { label, atMs: null },
      };
    }

    const result = await setWakeAlarmWithBridge({
      wakeAtMs: atMs,
      reasonLabel: label,
      reminderKey: `${label}:${atMs}`,
      preferNative: true,
    });

    if (result.needsChoice && result.existingWakeAtMs != null && when) {
      const oldWhen = new Date(result.existingWakeAtMs).toLocaleTimeString(
        'de-DE',
        { hour: '2-digit', minute: '2-digit' },
      );
      return {
        agent: 'trigger',
        ok: true,
        draftText: [
          'FAKTEN Trigger:',
          `Bestehend: ${oldWhen}`,
          `Neu: ${when}`,
          'FLOW: Konflikt — ersetzen oder zweiten stellen (Buttons).',
        ].join('\n'),
        bullets: [],
        buttons: [
          {
            id: 'wake_replace',
            label: 'Aktualisieren',
            payload: {
              kind: 'ui',
              action: 'set_wake_alarm',
              data: {
                dateIso: new Date(atMs).toISOString(),
                destName: label,
                wakeMode: 'replace',
                replaceWakeAtMs: result.existingWakeAtMs,
              },
            },
          },
          {
            id: 'wake_add',
            label: 'Zweiten stellen',
            payload: {
              kind: 'ui',
              action: 'set_wake_alarm',
              data: {
                dateIso: new Date(atMs).toISOString(),
                destName: label,
                wakeMode: 'add',
              },
            },
          },
        ],
        meta: { label, atMs, needsChoice: true },
      };
    }

    return {
      agent: 'trigger',
      ok: result.ok,
      draftText: [
        'FAKTEN Trigger:',
        `Label: ${label}`,
        `Zeit: ${when}`,
        result.ok ? 'Wecker aktiv + Timeline' : 'Wecker fehlgeschlagen',
        'FLOW: knappe Bestätigung auf Bridge aufbauend.',
      ].join('\n'),
      bullets: [],
      buttons: result.ok
        ? []
        : [
            {
              id: 'set_wake',
              label: isWake ? `⏰ Nochmal ${when}` : `⏰ ${when}`,
              payload: {
                kind: 'ui',
                action: 'set_wake_alarm',
                data: {
                  dateIso: new Date(atMs).toISOString(),
                  destName: label,
                },
              },
            },
          ],
      meta: { label, atMs, channel: result.channel },
      error: result.ok
        ? undefined
        : { code: 'wake_alarm', message: result.message ?? 'fail' },
    };
  },
};
