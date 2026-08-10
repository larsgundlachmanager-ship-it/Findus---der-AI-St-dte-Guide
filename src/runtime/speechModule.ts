/**
 * Runtime TTS — Orchestrator-sync + AudioPipeline (SSOT für Modul-Speech).
 */

import type {
  SpeakVoiceOptions,
  SpeechPriority,
} from '../services/AudioVoiceService';
import { sentencesFromFullText } from '../services/ai/sentenceStream';
import { onSpeechStart } from './orchestrator';
import { playSentenceChunks } from './audioPipeline';
import { requestSpeechDelivery } from '../services/speech/speechDeliveryPolicy';
import type { SpeechDeliveryKind } from '../services/speech/speechDeliveryPolicy';
import { getRuntimeContext } from './orchestrator';

function defaultPriorityForModule(): SpeechPriority {
  const mod = getRuntimeContext().module;
  if (mod === 'questions') return 'question';
  if (mod === 'explore') return 'explore';
  if (mod === 'navigation') return 'nav';
  return 'system';
}

/** Ein Satz oder Fließtext — queue-fähig, GPS-Flush nach Ende. */
export async function speakRuntimeText(
  text: string,
  voice?: SpeakVoiceOptions,
  opts?: { deliveryKind?: SpeechDeliveryKind; priority?: SpeechPriority },
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  const maySpeak = await requestSpeechDelivery({
    text: trimmed,
    voiceOptions: voice,
    kind: opts?.deliveryKind ?? 'assistant',
  });
  if (!maySpeak) return;

  onSpeechStart();
  await playSentenceChunks(sentencesFromFullText(trimmed), voice, {
    bypassDeliveryPolicy: true,
    priority: opts?.priority ?? defaultPriorityForModule(),
  });
}

/** Mehrere Sätze / Stream-Iterable. */
export async function speakRuntimeSentences(
  sentences: AsyncIterable<string>,
  voice?: SpeakVoiceOptions,
  opts?: { deliveryKind?: SpeechDeliveryKind; priority?: SpeechPriority },
): Promise<void> {
  onSpeechStart();
  await playSentenceChunks(sentences, voice, {
    deliveryKind: opts?.deliveryKind ?? 'assistant',
    priority: opts?.priority ?? defaultPriorityForModule(),
  });
}
