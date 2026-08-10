/**
 * Modul-2 Speech Queue — streng sequentiell, nie parallel:
 * Bridging komplett → dann Main → dann Deep Research.
 * Ein Job = ein TTS-Durchlauf; nächster Job erst nach hörbarem Idle.
 */

import { playSentenceChunks, interruptAudioPipeline } from '../../runtime/audioPipeline';
import { chunkTextForTts } from './ttsChunker';
import {
  getActiveTtsSessionCount,
  isAudiblyPlaying,
} from '../../services/AudioVoiceService';
import { useFinnusStore } from '../../store/useFinnusStore';

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

/**
 * Wartet bis wirklich nichts mehr spricht (Sessions + Audible-Flag).
 * Verhindert, dass Main startet während Bridging noch ausklingt.
 */
async function waitUntilSpeechIdle(timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // Kurz settle nach Job-Ende
  await sleep(40);
  while (Date.now() < deadline) {
    const sessions = getActiveTtsSessionCount();
    const audible = isAudiblyPlaying();
    const uiPlaying = useFinnusStore.getState().isPlayingAudio;
    if (sessions <= 0 && !audible && !uiPlaying) return;
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
  const text = (opts.text ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return id;

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

      // Vor Start: sicher idle (kein Rest-Audio vom vorherigen Job)
      await waitUntilSpeechIdle();
      // Nach Timeout: hängendes UI-Flag freigeben, sonst blockiert die Queue
      if (
        getActiveTtsSessionCount() <= 0 &&
        !isAudiblyPlaying() &&
        useFinnusStore.getState().isPlayingAudio
      ) {
        useFinnusStore.getState().setIsPlayingAudio(false);
      }
      if (abortedTurnId && next.turnId === abortedTurnId) continue;

      currentJob = next;
      emit({ type: 'start', job: next });

      try {
        if (next.alreadySpoken) {
          // Mic/Bridge-Pfad hat TTS schon — nur Idle abwarten
          await waitUntilSpeechIdle();
        } else {
          // Ein Stream, gleiche Priority — keine Preemption Bridging↔Main
          await playSentenceChunks(
            (async function* () {
              const parts = chunkTextForTts(next.text);
              if (parts.length === 0) {
                yield next.text;
                return;
              }
              for (const p of parts) yield p;
            })(),
            undefined,
            { priority: 'question' },
          );
        }
      } catch {
        /* soft — nächster Job trotzdem */
      }

      emit({ type: 'end', job: next });
      currentJob = null;

      if (next.kind === 'main') {
        mainActiveOrPending = queue.some((j) => j.kind === 'main');
      }

      // Nach Bridging sofort Idle prüfen, dann Main ohne lange Pause
      await waitUntilSpeechIdle();
      // Mikro-Pause nur nach Bridging → Main (natürlicher Anschluss, kein Overlap)
      if (next.kind === 'bridging' && queue.some((j) => j.kind === 'main')) {
        await sleep(120);
      }
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
