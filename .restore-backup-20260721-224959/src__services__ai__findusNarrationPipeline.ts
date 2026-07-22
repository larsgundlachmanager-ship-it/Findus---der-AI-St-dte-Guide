/**
 * 3-Phasen Findus-Narrations-Pipeline:
 *   Phase 1: Fast Hook  → sofort Audio
 *   Phase 2: Deep Story → Satz-Stream im Hintergrund
 *   Phase 3: Pass-through → Kokoro textToTokens (G2P intern)
 *
 * Keine Text-Mutation vor Kokoro — nur trimmen.
 */

import type { PoiWithFacts } from '../../db/types';
import type { UserProfile } from '../../types/userProfile';
import { generateFastHook } from './fastHookService';
import { streamDeepStory, collectDeepStory } from './deepStoryService';
import { createBufferedSentenceQueue } from './bufferedSentenceQueue';
import { extractKeyFactsFromPoi } from './PromptBuilderService';
import type { VisitedHistory } from './types';
import { speakTwoPhase, speakWithKokoro, stopSpeaking } from '../ttsService';
import { getVoiceSettingsForTour } from '../userProfileService';
import { useFinnusStore } from '../../store/useFinnusStore';

export type NarrationPipelineInput = {
  poi: PoiWithFacts;
  profile?: UserProfile | null;
  sessionMemory?: VisitedHistory;
};

export type NarrationPipelineResult = {
  fastHook: string;
  fullText: string;
};

function cleanSpeakText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Producer: Deep Story → Queue (Rohsätze, keine Mutation).
 */
function startDeepStoryProducer(
  input: NarrationPipelineInput,
  fastHookRaw: string,
  queue: ReturnType<typeof createBufferedSentenceQueue>,
): { done: Promise<string[]>; collected: string[] } {
  const collected: string[] = [];

  const done = (async () => {
    try {
      for await (const rawSentence of streamDeepStory({
        poi: input.poi,
        fastHook: fastHookRaw,
        sessionMemory: input.sessionMemory,
      })) {
        const clean = cleanSpeakText(rawSentence);
        if (!clean) continue;
        collected.push(clean);
        queue.push(clean);
      }
    } catch (error) {
      console.error('[pipeline] Deep story failed:', error);
      queue.close(error);
      return collected;
    } finally {
      queue.close();
    }
    return collected;
  })();

  return { done, collected };
}

/**
 * Startet die 3-Phasen-Pipeline. Text geht unverändert an Kokoro.
 */
export async function runFindusNarrationPipeline(
  input: NarrationPipelineInput,
): Promise<NarrationPipelineResult> {
  const store = useFinnusStore.getState();

  const fastHookRaw = cleanSpeakText(
    generateFastHook({
      poi: input.poi,
      profile: input.profile,
      sessionMemory: input.sessionMemory,
    }),
  );

  const queue = createBufferedSentenceQueue();
  const { done, collected } = startDeepStoryProducer(input, fastHookRaw, queue);

  try {
    await stopSpeaking();
    const voiceSettings = await getVoiceSettingsForTour();
    await speakTwoPhase({
      introText: fastHookRaw,
      bodySentenceStream: queue.iterate(),
      voice: {
        voiceId: voiceSettings.voiceId,
        speechRate: voiceSettings.speechRate,
      },
    });
  } catch (error) {
    console.error('[pipeline] Audio failed:', error);
    store.setIsGenerating(false);
    store.setSubtitleText(null);
    store.setIsPlayingAudio(false);
    throw error;
  }

  await done;
  const fullText = [fastHookRaw, ...collected].join(' ').trim();

  if (fullText) {
    store.addVisitedPlace({
      poiId: input.poi.id,
      name: input.poi.name,
      keyFacts: extractKeyFactsFromPoi(input.poi),
      visitedAt: Date.now(),
    });
  }

  return { fastHook: fastHookRaw, fullText };
}

export async function runFallbackNarration(
  input: NarrationPipelineInput,
): Promise<string> {
  const fastHookRaw = cleanSpeakText(
    generateFastHook({
      poi: input.poi,
      profile: input.profile,
      sessionMemory: input.sessionMemory,
    }),
  );

  const bodyText = await collectDeepStory({
    poi: input.poi,
    fastHook: fastHookRaw,
    sessionMemory: input.sessionMemory,
  });
  const bodySentences = bodyText
    .split(/(?<=[.!?])\s+/)
    .map((s) => cleanSpeakText(s))
    .filter(Boolean);

  await stopSpeaking();
  const voiceSettings = await getVoiceSettingsForTour();
  await speakTwoPhase({
    introText: fastHookRaw,
    bodySentenceStream: (async function* () {
      for (const s of bodySentences) yield s;
    })(),
    voice: {
      voiceId: voiceSettings.voiceId,
      speechRate: voiceSettings.speechRate,
    },
  });

  const fullText = [fastHookRaw, bodyText].filter(Boolean).join(' ').trim();
  useFinnusStore.getState().addVisitedPlace({
    poiId: input.poi.id,
    name: input.poi.name,
    keyFacts: extractKeyFactsFromPoi(input.poi),
    visitedAt: Date.now(),
  });
  return fullText;
}

export async function speakFastHookOnly(
  input: NarrationPipelineInput,
): Promise<string> {
  const raw = cleanSpeakText(generateFastHook(input));
  const voiceSettings = await getVoiceSettingsForTour();
  await speakWithKokoro(raw, {
    voiceId: voiceSettings.voiceId,
    speechRate: voiceSettings.speechRate,
  });
  return raw;
}
