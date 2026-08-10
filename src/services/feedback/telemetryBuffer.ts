/**
 * Rolling 10-minute telemetry buffer for beta feedback uploads.
 * Captures LLM I/O, UI states, recent user actions, and Judge corrections.
 */

import type {
  FeedbackTelemetrySnapshot,
  JudgeOutputSnapshot,
  JudgeTelemetryEvent,
  QuickActionLite,
} from '../../types/feedback';
import { useFinnusStore } from '../../store/useFinnusStore';
import {
  clearExecutionTracking,
  snapshotExecutionTracking,
} from './executionTracking';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_ITEMS_PER_BUCKET = 40;
const MAX_TEXT_LEN = 2_000;
const MAX_JUDGE_EVENTS = 20;
const MAX_SPEECH_SNAPSHOT = 800;

type Timestamped<T> = { atMs: number; value: T };

const buckets = {
  llm_prompts: [] as Timestamped<string>[],
  llm_responses: [] as Timestamped<string>[],
  ui_states: [] as Timestamped<string>[],
  last_actions: [] as Timestamped<string>[],
};

let judgePasses: JudgeTelemetryEvent[] = [];

let storeUnsub: (() => void) | null = null;
let lastUiFingerprint = '';

function trimText(value: string): string {
  const t = value.trim();
  if (t.length <= MAX_TEXT_LEN) return t;
  return `${t.slice(0, MAX_TEXT_LEN)}…`;
}

function prune(nowMs = Date.now()): void {
  const cutoff = nowMs - WINDOW_MS;
  for (const key of Object.keys(buckets) as Array<keyof typeof buckets>) {
    buckets[key] = buckets[key].filter((e) => e.atMs >= cutoff);
    if (buckets[key].length > MAX_ITEMS_PER_BUCKET) {
      buckets[key] = buckets[key].slice(-MAX_ITEMS_PER_BUCKET);
    }
  }
  judgePasses = judgePasses
    .filter((e) => e.atMs >= cutoff)
    .slice(-MAX_JUDGE_EVENTS);
}

function push(
  bucket: keyof typeof buckets,
  value: string,
  atMs = Date.now(),
): void {
  const text = trimText(value);
  if (!text) return;
  buckets[bucket].push({ atMs, value: text });
  prune(atMs);
}

export function recordLlmPrompt(prompt: string): void {
  push('llm_prompts', prompt);
}

export function recordLlmResponse(response: string): void {
  push('llm_responses', response);
}

export function recordUiState(state: string): void {
  push('ui_states', state);
}

export function recordLastAction(action: string): void {
  push('last_actions', action);
}

function compactJudgeOutput(raw: JudgeOutputSnapshot): JudgeOutputSnapshot {
  return {
    speechText: trimText(raw.speechText).slice(0, MAX_SPEECH_SNAPSHOT),
    cardTitle: raw.cardTitle
      ? trimText(raw.cardTitle).slice(0, 80)
      : undefined,
    visualBullets: (raw.visualBullets ?? []).slice(0, 3).map((b) =>
      trimText(b).slice(0, 120),
    ),
    quickActions: (raw.quickActions ?? []).slice(0, 4).map(
      (a): QuickActionLite => ({
        type: a.type,
        label: trimText(a.label).slice(0, 20),
        payload: {
          targetPoiId: a.payload?.targetPoiId,
          phoneNumber: a.payload?.phoneNumber,
          url: a.payload?.url
            ? trimText(String(a.payload.url)).slice(0, 200)
            : undefined,
          textPrompt: a.payload?.textPrompt
            ? trimText(String(a.payload.textPrompt)).slice(0, 120)
            : undefined,
          destName: a.payload?.destName
            ? trimText(String(a.payload.destName)).slice(0, 80)
            : undefined,
          destLat: a.payload?.destLat,
          destLng: a.payload?.destLng,
          destination: a.payload?.destination
            ? trimText(String(a.payload.destination)).slice(0, 80)
            : undefined,
        },
      }),
    ),
  };
}

/**
 * Law- & Action-Button-Judge → Telemetrie (telemetry_10min).
 * Jeder Durchlauf wird geloggt — auch ohne Korrektur.
 */
export function recordJudgePass(event: {
  judge_executed: boolean;
  judge_corrections_made: string[];
  raw_pass2_output: JudgeOutputSnapshot;
  repaired_output: JudgeOutputSnapshot;
  user_text_preview?: string;
  skipped?: boolean;
  skip_reason?: string;
  llm_repaired?: boolean;
  atMs?: number;
}): void {
  const atMs = event.atMs ?? Date.now();
  const entry: JudgeTelemetryEvent = {
    atMs,
    judge_executed: event.judge_executed,
    judge_corrections_made: [...new Set(event.judge_corrections_made)].slice(
      0,
      24,
    ),
    raw_pass2_output: compactJudgeOutput(event.raw_pass2_output),
    repaired_output: compactJudgeOutput(event.repaired_output),
    user_text_preview: event.user_text_preview
      ? trimText(event.user_text_preview).slice(0, 240)
      : undefined,
    skipped: event.skipped,
    skip_reason: event.skip_reason,
    llm_repaired: event.llm_repaired,
  };
  judgePasses.push(entry);
  prune(atMs);

  const corr =
    entry.judge_corrections_made.length > 0
      ? entry.judge_corrections_made.join(',')
      : 'none';
  recordLastAction(
    `judge:${entry.judge_executed ? 'run' : 'skip'}:${corr}`,
  );

  if (__DEV__ && entry.judge_corrections_made.length > 0) {
    console.log(
      '[telemetry] judge corrections',
      entry.judge_corrections_made.join(' | '),
    );
  }
}

export function snapshotTelemetry(): FeedbackTelemetrySnapshot {
  prune();
  const pick = (key: keyof typeof buckets) =>
    buckets[key].map((e) => e.value);

  const exec = snapshotExecutionTracking();
  return {
    llm_prompts: pick('llm_prompts'),
    llm_responses: pick('llm_responses'),
    ui_states: pick('ui_states'),
    last_actions: pick('last_actions'),
    user_speech_exact: exec.user_speech_exact,
    findus_speech_exact: exec.findus_speech_exact,
    findus_actions_triggered: exec.findus_actions_triggered,
    nav_execution_tracking: exec.nav_execution_tracking,
    judge_passes: [...judgePasses],
  };
}

export function clearTelemetryBuffer(): void {
  for (const key of Object.keys(buckets) as Array<keyof typeof buckets>) {
    buckets[key] = [];
  }
  judgePasses = [];
  clearExecutionTracking();
}

function buildUiFingerprint(): string {
  const s = useFinnusStore.getState();
  return [
    `screen=${s.navActive ? 'nav' : 'home'}`,
    `gps=${s.gpsStatus}`,
    `poi=${s.currentPoiId ?? 'none'}`,
    `gen=${s.isGenerating}`,
    `listen=${s.isListening}`,
    `tts=${s.isPlayingAudio}`,
    `presence=${s.findusPresence}`,
    `card=${s.activeConciergeCard?.cardTitle ?? 'none'}`,
  ].join('|');
}

/** Subscribe to key store transitions for ui_states + last_actions. */
export function initFeedbackTelemetry(): () => void {
  if (storeUnsub) return storeUnsub;

  lastUiFingerprint = buildUiFingerprint();
  recordUiState(lastUiFingerprint);

  storeUnsub = useFinnusStore.subscribe((state, prev) => {
    const fp = buildUiFingerprint();
    if (fp !== lastUiFingerprint) {
      lastUiFingerprint = fp;
      recordUiState(fp);
    }

    if (state.isListening && !prev.isListening) {
      recordLastAction('mic_press_start');
    }
    if (!state.isListening && prev.isListening) {
      recordLastAction('mic_press_end');
    }
    if (state.navActive && !prev.navActive) {
      recordLastAction('nav_start');
    }
    if (!state.navActive && prev.navActive) {
      recordLastAction('nav_stop');
    }
    if (state.activeConciergeCard?.cardTitle !== prev.activeConciergeCard?.cardTitle) {
      const title = state.activeConciergeCard?.cardTitle;
      if (title) recordLastAction(`card:${title}`);
    }
  });

  return storeUnsub;
}
