import { findPoiAtLocation, getPoiWithFacts } from '../db/database';
import type { PoiWithFacts } from '../db/types';
import { buildPoiResearchContext } from '../constants/prompts';
import {
  runFindusNarrationPipeline,
  runFallbackNarration,
} from './ai/findusNarrationPipeline';
import { useFinnusStore } from '../store/useFinnusStore';
import { getCachedUserProfile } from './userProfileService';

/**
 * Kern-Trigger: Real-GPS und Simulation.
 * 3-Phasen-Pipeline: Fast Hook → Deep Story Stream → Phonetic Transformer.
 */
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

  const sessionMemory = { entries: store.visitedHistory };
  const profile = getCachedUserProfile();

  store.addChatMessage({ role: 'system', content: buildSystemContext(poi) });

  const pipelineInput = { poi, profile, sessionMemory };

  try {
    const result = await runFindusNarrationPipeline(pipelineInput);

    if (result.fullText) {
      store.addChatMessage({
        role: 'assistant',
        content: result.fullText,
      });
    }
  } catch (error) {
    console.error('[geofence] Narration pipeline failed, fallback:', error);
    try {
      const fallbackText = await runFallbackNarration(pipelineInput);
      store.addChatMessage({ role: 'assistant', content: fallbackText });
    } catch (fallbackError) {
      console.error('[geofence] Fallback narration failed:', fallbackError);
    }
  } finally {
    store.setIsGenerating(false);
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
