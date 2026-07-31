/**
 * Proactive Speech Queue — Budget + Bündelung (kein Spam).
 */

import { useFinnusStore } from '../../store/useFinnusStore';
import {
  getModule2SpeechEndedAtMs,
  isModule2Busy,
} from '../navigation/modulePriorityPolicy';
import type { QuickAction } from '../../types/concierge';
import { wrapPlainAsConcierge } from '../concierge/parseConciergeResponse';
import { toConciergeCardState } from '../concierge/presentConcierge';
import { getVoiceSettingsForTour, speakAssistantText } from '../ttsService';
import { MODULE5_AFTER_M2_MS } from './module5Priority';

export type ProactiveSpeechKind =
  | 'flight'
  | 'weather'
  | 'transit'
  | 'plan'
  | 'other';

type QueueItem = {
  id: string;
  kind: ProactiveSpeechKind;
  speech: string;
  actions?: QuickAction[];
  atMs: number;
  priority: number;
};

/** Max. 1 proaktive Ausgabe pro diesem Fenster */
export const PROACTIVE_SPEECH_BUDGET_MS = 3 * 60_000;

const queue: QueueItem[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let lastSpokenAtMs = 0;
let speaking = false;

function priorityFor(kind: ProactiveSpeechKind): number {
  switch (kind) {
    case 'weather':
      return 90;
    case 'flight':
      return 80;
    case 'transit':
      return 70;
    case 'plan':
      return 50;
    default:
      return 40;
  }
}

/**
 * Intelligenter Summarizer: mehrere Events → ein Satz.
 */
export function summarizeProactiveBatch(items: QueueItem[]): string {
  if (items.length === 1) return items[0]!.speech.trim();

  const byKind = new Map<ProactiveSpeechKind, string>();
  for (const it of items) {
    if (!byKind.has(it.kind)) byKind.set(it.kind, it.speech.trim());
  }

  const flight = byKind.get('flight');
  const weather = byKind.get('weather');
  const transit = byKind.get('transit');
  const plan = byKind.get('plan');
  const other = byKind.get('other');

  const parts: string[] = [];
  if (flight && weather) {
    parts.push(
      `${stripTrailingDot(flight)}, aber wir müssen jetzt los — ${stripTrailingDot(weather).toLowerCase()}`,
    );
  } else {
    if (flight) parts.push(stripTrailingDot(flight));
    if (weather) parts.push(stripTrailingDot(weather));
  }
  if (transit) parts.push(stripTrailingDot(transit));
  if (plan) parts.push(stripTrailingDot(plan));
  if (other) parts.push(stripTrailingDot(other));

  if (parts.length === 1) return `${parts[0]}.`;
  if (parts.length === 2) return `${parts[0]} — und ${lcFirst(parts[1])}.`;
  return `${parts.slice(0, -1).join('. ')}. Außerdem: ${lcFirst(parts[parts.length - 1]!)}.`;
}

function stripTrailingDot(s: string): string {
  return s.replace(/[.!\s]+$/g, '').trim();
}

function lcFirst(s: string): string {
  if (!s) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function canSpeakNow(now = Date.now()): { ok: boolean; waitMs: number } {
  if (speaking) return { ok: false, waitMs: 1500 };
  if (isModule2Busy()) return { ok: false, waitMs: 2000 };
  const store = useFinnusStore.getState();
  if (store.isPlayingAudio || store.isListening) {
    return { ok: false, waitMs: 2000 };
  }
  const ended = getModule2SpeechEndedAtMs();
  if (ended != null && now - ended < MODULE5_AFTER_M2_MS) {
    return { ok: false, waitMs: MODULE5_AFTER_M2_MS - (now - ended) };
  }
  if (lastSpokenAtMs && now - lastSpokenAtMs < PROACTIVE_SPEECH_BUDGET_MS) {
    return {
      ok: false,
      waitMs: PROACTIVE_SPEECH_BUDGET_MS - (now - lastSpokenAtMs),
    };
  }
  return { ok: true, waitMs: 0 };
}

async function flushQueue(): Promise<void> {
  flushTimer = null;
  if (!queue.length || speaking) {
    scheduleFlush(1500);
    return;
  }
  const gate = canSpeakNow();
  if (!gate.ok) {
    scheduleFlush(Math.max(800, Math.min(gate.waitMs, 15_000)));
    return;
  }

  // Alles, was gerade wartet, in einem Batch bündeln
  const batch = queue.splice(0, queue.length);
  batch.sort((a, b) => b.priority - a.priority);
  const speech = summarizeProactiveBatch(batch);
  const actions = batch.flatMap((b) => b.actions ?? []).slice(0, 4);

  speaking = true;
  lastSpokenAtMs = Date.now();
  try {
    const voice = await getVoiceSettingsForTour();
    useFinnusStore.getState().addChatMessage({
      role: 'assistant',
      content: speech,
    });
    if (actions.length) {
      useFinnusStore.getState().setActiveConciergeCard(
        toConciergeCardState(
          wrapPlainAsConcierge(speech, {
            cardTitle: 'Hinweis',
            visualBullets: batch.map((b) => b.kind),
            quickActions: actions,
          }),
        ),
      );
    }
    await speakAssistantText(speech, {
      voiceId: voice.voiceId,
      speechRate: voice.speechRate,
    });
  } catch (err) {
    if (__DEV__) console.warn('[proactiveQueue] speak failed', err);
  } finally {
    speaking = false;
    if (queue.length) scheduleFlush(PROACTIVE_SPEECH_BUDGET_MS);
  }
}

function scheduleFlush(ms: number): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    void flushQueue();
  }, ms);
}

/**
 * Proaktive Warnung einreihen (statt direkt TTS).
 */
export function enqueueProactiveSpeech(opts: {
  kind: ProactiveSpeechKind;
  speech: string;
  actions?: QuickAction[];
  id?: string;
}): void {
  const speech = opts.speech.trim();
  if (!speech) return;

  // Dedup gleiche kind+ähnlicher Text
  const id = opts.id ?? `${opts.kind}:${speech.slice(0, 48)}`;
  const existing = queue.findIndex((q) => q.id === id || q.kind === opts.kind);
  const item: QueueItem = {
    id,
    kind: opts.kind,
    speech,
    actions: opts.actions,
    atMs: Date.now(),
    priority: priorityFor(opts.kind),
  };
  if (existing >= 0) {
    // Neuere Version ersetzt (z. B. aktualisierte Verspätung)
    queue[existing] = item;
  } else {
    queue.push(item);
  }

  const gate = canSpeakNow();
  scheduleFlush(gate.ok ? 400 : Math.max(600, Math.min(gate.waitMs, 10_000)));
}

export function getProactiveQueueLength(): number {
  return queue.length;
}
