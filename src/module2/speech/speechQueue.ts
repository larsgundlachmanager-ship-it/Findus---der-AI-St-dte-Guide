/**
 * Modul-2 Speech Queue — streng sequentiell, nie parallel:
 * Bridging komplett → dann Main → dann Deep Research.
 * Ein Job = ein TTS-Durchlauf; nächster Job erst nach hörbarem Idle.
 */

import { playSentenceChunks, interruptAudioPipeline } from '../../runtime/audioPipeline';
import { sentencesFromFullText } from '../../services/ai/sentenceStream';
import {
  getActiveTtsSessionCount,
  isAudiblyPlaying,
} from '../../services/AudioVoiceService';
import { useFinnusStore } from '../../store/useFinnusStore';
import { resetFusedTurnSpeech } from './fusedTurnSpeech';

export type SpeechJobKind = 'bridging' | 'main' | 'deep_research';

type SpeechJob = {
  id: string;
  kind: SpeechJobKind;
  /** Volltext — ein Durchlauf, keine Chunk-Parallelität */
  text: string;
  turnId: string;
  /** Mic hat Bridge schon gesprochen — Queue wartet nur auf Idle */
  alreadySpoken?: boolean;
};

type Listener = (evt: {
  type: 'start' | 'chunk' | 'end' | 'flush';
  job?: SpeechJob;
}) => void;

let queue: SpeechJob[] = [];
let playing = false;
let mainActiveOrPending = false;
let abortedTurnId: string | null = null;
let jobSeq = 0;
/** Aktuell laufender Job — Main startet nie, solange Bridging hier steht. */
let currentJob: SpeechJob | null = null;
const listeners = new Set<Listener>();

function emit(evt: Parameters<Listener>[0]): void {
  listeners.forEach((l) => {
    try {
      l(evt);
    } catch {
      /* soft */
    }
  });
}

export function subscribeSpeechQueue(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function idleWaitMsForSpokenBridge(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(28_000, Math.max(8_000, Math.round((words / 2.2) * 1000) + 5_000));
}

export function hasBridgingJob(): boolean {
  return (
    currentJob?.kind === 'bridging' ||
    queue.some((j) => j.kind === 'bridging')
  );
}

/**
 * Bridge komplett zu Ende — Hauptantwort hängt danach an, ohne sich gegenseitig
 * abzuschneiden. Pump darf derweil schon Sätze sammeln.
 */
export async function waitForBridgingToFinish(
  timeoutMs = 28_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!hasBridgingJob()) {
      await waitUntilSpeechIdle(80);
      return;
    }
    await sleep(40);
  }
  await waitUntilSpeechIdle(80);
}

/**
 * Wartet bis wirklich nichts mehr spricht (Sessions + Audible-Flag).
 * Verhindert, dass Main startet während Bridging noch ausklingt.
 * Nicht auf isPlayingAudio warten — das Flag ist UI und wird beim Enqueue
 * schon gesetzt, sonst hängt jeder Job am Timeout (600ms–8s „lädt“).
 */
async function waitUntilSpeechIdle(timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // Kurz settle nach Job-Ende
  await sleep(40);
  while (Date.now() < deadline) {
    const sessions = getActiveTtsSessionCount();
    const audible = isAudiblyPlaying();
    if (sessions <= 0 && !audible) return;
    await sleep(50);
  }
}

export function enqueueSpeech(opts: {
  kind: SpeechJobKind;
  text: string;
  turnId: string;
  /** Bridge schon via Mic/contextualBridge gesprochen */
  alreadySpoken?: boolean;
}): string {
  const id = `sq_${++jobSeq}`;
  let text = (opts.text ?? '').replace(/\s+/g, ' ').trim();
  if (!text) {
    if (opts.kind !== 'main') return id;
    text =
      'Dazu hab ich gerade nichts Greifbares. Sag nochmal, worum es geht.';
  }

  try {
    const { isReisebueroOverlayOpen } = require('../../reisebuero/store') as {
      isReisebueroOverlayOpen: () => boolean;
    };
    if (isReisebueroOverlayOpen() && opts.kind === 'bridging') {
      return id;
    }
  } catch {
    /* soft */
  }

  // Bridging nach Main derselben Turn ist sinnlos — Main hat Vorrang in der Queue-Logik
  if (
    opts.kind === 'bridging' &&
    (queue.some((j) => j.kind === 'main' && j.turnId === opts.turnId) ||
      (currentJob?.kind === 'main' && currentJob.turnId === opts.turnId))
  ) {
    return id;
  }

  if (opts.kind === 'main') {
    mainActiveOrPending = true;
  }

  // Mood-Bridge: blau halten bis TTS hörbar (kein Idle-Flash nach Generating)
  try {
    const st = useFinnusStore.getState();
    if (!st.isAudiblySpeaking) {
      st.setIsPlayingAudio(true);
    }
  } catch {
    /* soft */
  }

  // Bridge + Hauptantwort: immer dieselbe TTS-Session (nicht erst wenn schon live).
  // Sonst: Pitch/M5 startet Jobs nacheinander mit Idle-Warte → Pausen zwischen Sätzen.
  if (
    (opts.kind === 'bridging' || opts.kind === 'main') &&
    opts.alreadySpoken !== true
  ) {
    try {
      const fused = require('./fusedTurnSpeech') as {
        fusedEnqueue: (o: {
          kind: 'bridging' | 'main';
          text: string;
          turnId: string;
        }) => Promise<boolean>;
        isFusedTurnLive: () => boolean;
      };
      void fused.fusedEnqueue({
        kind: opts.kind,
        text,
        turnId: opts.turnId,
      });
      if (opts.kind === 'main') mainActiveOrPending = true;
      return id;
    } catch {
      /* fall through — alte Zwei-Job-Queue */
    }
  }

  queue.push({
    id,
    kind: opts.kind,
    text,
    turnId: opts.turnId,
    alreadySpoken: opts.alreadySpoken === true,
  });
  void drain();
  return id;
}

/**
 * Strikte Reihenfolge: erst alle Bridging, dann Main, dann Deep.
 * Nie Main wählen solange Bridging in Queue oder gerade spielt.
 */
function peekPlayable(): SpeechJob | null {
  if (currentJob?.kind === 'bridging') {
    // Sollte nicht vorkommen (peek nur wenn idle) — Absicherung
    return null;
  }

  const bridging = queue.find((j) => j.kind === 'bridging');
  if (bridging) return bridging;

  const main = queue.find((j) => j.kind === 'main');
  if (main) return main;

  // Flag ohne Main in der Queue freigeben — sonst hängen Deep-Jobs ewig
  if (mainActiveOrPending) {
    mainActiveOrPending = false;
  }
  return queue.find((j) => j.kind === 'deep_research') ?? null;
}

async function drain(): Promise<void> {
  if (playing) return;
  playing = true;
  try {
    while (queue.length > 0) {
      const next = peekPlayable();
      if (!next) break;

      queue = queue.filter((j) => j.id !== next.id);
      if (abortedTurnId && next.turnId === abortedTurnId) {
        if (next.kind === 'main') {
          mainActiveOrPending = queue.some((j) => j.kind === 'main');
        }
        continue;
      }

      // Vor Start: Rest-Audio vom vorherigen Job. Laufende Cover-Bridge nicht abwürgen.
      // alreadySpoken = Live-Pump läuft schon — nicht auf Idle warten (sonst 8s-Loch).
      if (!next.alreadySpoken) {
        await waitUntilSpeechIdle(600);
        if (
          getActiveTtsSessionCount() <= 0 &&
          !isAudiblyPlaying() &&
          useFinnusStore.getState().isPlayingAudio
        ) {
          useFinnusStore.getState().setIsPlayingAudio(false);
        }
      }
      if (abortedTurnId && next.turnId === abortedTurnId) continue;

      currentJob = next;
      emit({ type: 'start', job: next });

      try {
        if (next.alreadySpoken) {
          // Mic/Bridge-Pfad hat TTS schon — Idle bis die Einleitung wirklich fertig ist
          await waitUntilSpeechIdle(
            next.kind === 'bridging'
              ? idleWaitMsForSpokenBridge(next.text)
              : 8_000,
          );
        } else {
          let skipSecondSession = false;
          try {
            const { isFusedTurnLive } = require('./fusedTurnSpeech') as {
              isFusedTurnLive: () => boolean;
            };
            skipSecondSession =
              isFusedTurnLive() &&
              (next.kind === 'bridging' || next.kind === 'main');
          } catch {
            /* soft */
          }
          if (!skipSecondSession) {
            // Phrase-Stream (First-Hook ≤100 + Prefetch) — keine 600er-Blöcke
            await playSentenceChunks(
              sentencesFromFullText(next.text),
              undefined,
              { priority: 'question' },
            );
          }
        }
      } catch {
        /* soft — nächster Job trotzdem */
      }

      emit({ type: 'end', job: next });
      currentJob = null;

      if (next.kind === 'main') {
        mainActiveOrPending = queue.some((j) => j.kind === 'main');
      }

      // Nach Bridging: nur Mikro-Settle, dann Main. Lange Idle-Pause = hörbare Lücke.
      await waitUntilSpeechIdle(
        next.alreadySpoken && next.kind === 'bridging'
          ? idleWaitMsForSpokenBridge(next.text)
          : next.kind === 'bridging' && queue.some((j) => j.kind === 'main')
            ? 80
            : 350,
      );
      // Keine Extra-Pause zwischen Jobs — Fusion hängt in derselben Session.
    }
  } finally {
    currentJob = null;
    playing = false;
    if (queue.length > 0) void drain();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Barge-in: hart abbrechen + Rest verwerfen */
export async function bargeInFlush(turnId?: string): Promise<void> {
  abortedTurnId = turnId ?? 'all';
  queue = [];
  mainActiveOrPending = false;
  currentJob = null;
  try {
    resetFusedTurnSpeech();
  } catch {
    /* soft */
  }
  emit({ type: 'flush' });
  await interruptAudioPipeline();
  setTimeout(() => {
    if (abortedTurnId === (turnId ?? 'all')) abortedTurnId = null;
  }, 50);
}

/**
 * User tippt/drückt irgendwas → Stimme sofort weg (TTS + Queue).
 * Am Anfang jedes onPress: `void stopVoiceOnUserTap()` oder `await`.
 */
export async function stopVoiceOnUserTap(): Promise<void> {
  try {
    const { stopSpeaking } = require('../../services/ttsService') as {
      stopSpeaking: () => Promise<void>;
    };
    await stopSpeaking();
  } catch {
    /* soft */
  }
  try {
    await bargeInFlush('all');
  } catch {
    /* soft */
  }
}

export function markMainSpeechComplete(): void {
  mainActiveOrPending = queue.some((j) => j.kind === 'main');
}

export function getSpeechQueueDebug(): {
  length: number;
  playing: boolean;
  mainActiveOrPending: boolean;
  currentKind: SpeechJobKind | null;
} {
  return {
    length: queue.length,
    playing,
    mainActiveOrPending,
    currentKind: currentJob?.kind ?? null,
  };
}

/** true = TTS/Queue aktiv — Maps darf Speech nicht killen. */
export function isSpeechActive(): boolean {
  return playing || mainActiveOrPending || queue.length > 0;
}
