/**
 * Live-TTS-Session für Concierge-Turns (Fast-Hook + Prefetch).
 * Aus runConciergeTurn ausgelagert — Bridge/Speech getrennt vom Turn-Router.
 * TTS_SENTENCE_PIPELINE_LOCK — Verhalten nicht umbauen.
 */

import { enqueueSpeech } from '../speech/speechQueue';
import type { LiveSentencePump } from '../../services/audio/liveSentencePump';

export async function startLiveSpeechSession(
  pump: LiveSentencePump,
  turnId: string,
  firstSentence: string,
): Promise<void> {
  // Dieselbe fused Session (Bridge = Satz 1) nicht ein zweites Mal öffnen.
  if (pump.hasStarted()) return;
  if (!pump.markStarted()) return;
  // Eine Session: Fast-Hook = oft die Bridge. Kein Wait auf eine zweite Playback.
  // TTS_SENTENCE_PIPELINE_LOCK
  let pumpStarted = false;
  try {
    const { speakRuntimeSentences } = await import('../../runtime/speechModule');
    const { getVoiceSettingsForTour } = await import('../../services/ttsService');
    const { warmStreamingPhrases } = await import(
      '../../services/audio/streamingAudioQueueService'
    );
    const voice = await getVoiceSettingsForTour();
    warmStreamingPhrases(firstSentence, voice.voiceId);
    void speakRuntimeSentences(
      pump.sentences,
      { voiceId: voice.voiceId, speechRate: voice.speechRate },
      { priority: 'question', deliveryKind: 'assistant' },
    );
    pumpStarted = true;
  } catch {
    pumpStarted = false;
  }
  enqueueSpeech({
    kind: 'main',
    text: firstSentence,
    turnId,
    alreadySpoken: pumpStarted,
  });
}
