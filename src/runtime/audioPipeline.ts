/**
 * Global TTS streaming pipeline under Orchestrator.
 * Buffers Gemini text via punctuation chunker and streams to Cartesia
 * with prefetch + gapless playback inside StreamingAudioQueueService.
 */

import {
  resetTtsOnInterruption,
  speakSentenceStream,
  stopSpeaking,
  releaseSpeakingUiIfIdle,
  type SpeakVoiceOptions,
  type SpeechPriority,
} from '../services/AudioVoiceService';
import type { SpeechDeliveryKind } from '../services/speech/speechDeliveryPolicy';
import {
  extractStreamingChunks,
  streamingChunksFromTextStream,
} from '../services/audio/punctuationChunker';
import { flushStreamingAudioQueue } from '../services/audio/streamingAudioQueueService';

/** @deprecated use extractStreamingChunks — kept for callers */
export function extractRuntimeChunks(buffer: string): {
  chunks: string[];
  rest: string;
} {
  return extractStreamingChunks(buffer, { isFirstChunk: true });
}

export type AudioPipelineSession = {
  id: number;
  aborted: boolean;
};

let sessionCounter = 0;
let activeSession: AudioPipelineSession | null = null;

export function getActiveAudioSession(): AudioPipelineSession | null {
  return activeSession;
}

/**
 * User voice (Modul 2) — hard interrupt + streaming queue flush.
 */
export async function interruptAudioPipeline(): Promise<void> {
  if (activeSession) activeSession.aborted = true;
  await flushStreamingAudioQueue();
  await resetTtsOnInterruption();
}

/**
 * GPS / system — stop current playback without user-interrupt semantics.
 */
export async function stopAudioPipeline(): Promise<void> {
  if (activeSession) activeSession.aborted = true;
  await flushStreamingAudioQueue();
  await stopSpeaking();
}

/**
 * Feed incremental Gemini tokens; yields early punctuation chunks (hooks first).
 */
export async function* chunksFromTextStream(
  source: AsyncIterable<string>,
): AsyncGenerator<string, void, unknown> {
  yield* streamingChunksFromTextStream(source);
}

/**
 * Play Gemini stream through Cartesia streaming queue (prefetch + gapless).
 */
export async function playGeminiStream(
  source: AsyncIterable<string>,
  voice?: SpeakVoiceOptions,
  opts?: { priority?: SpeechPriority },
): Promise<void> {
  const session: AudioPipelineSession = {
    id: ++sessionCounter,
    aborted: false,
  };
  activeSession = session;

  try {
    await speakSentenceStream(chunksFromTextStream(source), voice, {
      priority: opts?.priority ?? 'question',
    });
  } finally {
    const stillActive = activeSession?.id === session.id;
    if (stillActive) {
      activeSession = null;
    }
    // Immer Standby, wenn keine TTS-Session mehr — sonst bleibt „Ich erzähle“
    releaseSpeakingUiIfIdle();
  }
}

/**
 * Play pre-built sentence iterable (non-streaming LLM path).
 */
export async function playSentenceChunks(
  sentences: AsyncIterable<string>,
  voice?: SpeakVoiceOptions,
  opts?: {
    bypassDeliveryPolicy?: boolean;
    deliveryKind?: SpeechDeliveryKind;
    priority?: SpeechPriority;
  },
): Promise<void> {
  const session: AudioPipelineSession = {
    id: ++sessionCounter,
    aborted: false,
  };
  activeSession = session;
  try {
    await speakSentenceStream(sentences, voice, opts);
  } finally {
    const stillActive = activeSession?.id === session.id;
    if (stillActive) {
      activeSession = null;
    }
    // Immer Standby, wenn keine TTS-Session mehr — sonst bleibt „Ich erzähle“
    releaseSpeakingUiIfIdle();
  }
}
