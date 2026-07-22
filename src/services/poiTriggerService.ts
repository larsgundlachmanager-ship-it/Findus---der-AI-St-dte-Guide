/**
 * Kern-Trigger: Real-GPS und Simulation.
 * Kontextbezogener Fast-Hook (LLM-Satz 1) → strikte Auflösung im Folgesatz → Kokoro.
 * Timeout → Template-Hook + Deep-Story, der genau diesen Hook einlöst.
 * Keine Text-Mutation vor TTS.
 */

import { getPoiWithFacts, findPoiAtLocation } from '../db/database';
import type { PoiWithFacts } from '../db/types';
import { buildPoiResearchContext } from '../constants/prompts';
import { filterDeepStoryFacts } from './ai/deepStoryFilter';
import {
  beginHookResolvingStream,
  buildVisitedMemoryEntry,
} from './ai/storyService';
import { createBufferedSentenceQueue } from './ai/bufferedSentenceQueue';
import { sentencesFromFullText } from './ai/sentenceStream';
import { buildContextAwareOfflineNarration } from './ai/promptBuilder';
import { speakTwoPhase, stopSpeaking, getVoiceSettingsForTour } from './ttsService';
import { useFinnusStore } from '../store/useFinnusStore';
import { getCachedUserProfile } from './userProfileService';

export async function triggerPoiArrival(poiId: number): Promise<void> {
  const store = useFinnusStore.getState();

  if (store.lastVisitedPoiId === poiId) {
    return;
  }

  const poi = await getPoiWithFacts(poiId);
  if (!poi) {
    console.warn('[geofence] POI not found:', poiId);
    return;
  }

  store.setLastVisitedPoiId(poiId);
  store.setCurrentPoiId(poi.id);
  store.setCurrentLocationName(poi.name);
  store.setIsGenerating(true);

  const profile = getCachedUserProfile();
  const sessionMemory = { entries: store.visitedHistory };

  const deep = filterDeepStoryFacts(poi, { profile, sessionMemory });
  store.addChatMessage({ role: 'system', content: buildSystemContext(poi) });

  let fastHook = '';
  const queue = createBufferedSentenceQueue();
  const collected: string[] = [];

  try {
    const started = await beginHookResolvingStream(
      { poi, profile, sessionMemory },
      { hookTimeoutMs: 1100 },
    );
    fastHook = started.hook;

    if (__DEV__) {
      console.log(
        `[geofence] Fast-Hook(${started.usedLlmHook ? 'llm' : 'fallback'})="${fastHook.slice(0, 56)}" facts=${deep.facts.length}`,
      );
    }

    void (async () => {
      try {
        for await (const sentence of started.bodySentenceStream) {
          const t = sentence.trim();
          if (!t) continue;
          collected.push(t);
          queue.push(t);
        }

        const fullText = [fastHook, ...collected].join(' ').trim();
        store.addChatMessage({ role: 'assistant', content: fullText });
        store.addVisitedPlace(
          buildVisitedMemoryEntry(
            poi,
            deep.facts.map((f) => f.text),
          ),
        );
      } catch (error) {
        console.error('[geofence] Story stream failed:', error);
        const fallback = buildContextAwareOfflineNarration(
          poi,
          profile,
          sessionMemory,
        );
        store.addChatMessage({
          role: 'assistant',
          content: `${fastHook} ${fallback}`.trim(),
        });
        for await (const s of sentencesFromFullText(fallback)) {
          queue.push(s);
        }
        store.addVisitedPlace(buildVisitedMemoryEntry(poi));
      } finally {
        store.setIsGenerating(false);
        queue.close();
      }
    })();

    await stopSpeaking();
    const voiceSettings = await getVoiceSettingsForTour();
    await speakTwoPhase({
      introText: fastHook,
      bodySentenceStream: queue.iterate(),
      voice: {
        voiceId: voiceSettings.voiceId,
        speechRate: voiceSettings.speechRate,
      },
    });
  } catch (error) {
    console.error('[geofence] Hook/Audio fehlgeschlagen:', error);
    store.setIsGenerating(false);
    store.setSubtitleText(null);
    store.setIsPlayingAudio(false);
    queue.close();
  }
}

export async function handleLocationUpdate(
  lat: number,
  lng: number,
): Promise<void> {
  const poi = await findPoiAtLocation(lat, lng);

  if (!poi) {
    const {
      lastVisitedPoiId,
      setLastVisitedPoiId,
      setCurrentLocationName,
      setCurrentPoiId,
    } = useFinnusStore.getState();
    if (lastVisitedPoiId !== null) {
      setLastVisitedPoiId(null);
      setCurrentLocationName(null);
      setCurrentPoiId(null);
    }
    return;
  }

  await triggerPoiArrival(poi.id);
}

function buildSystemContext(poi: PoiWithFacts): string {
  return buildPoiResearchContext(poi);
}
