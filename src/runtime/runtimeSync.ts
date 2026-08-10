/**
 * Bridge: Zustand store ↔ Runtime orchestrator.
 */

import { useFinnusStore } from '../store/useFinnusStore';
import { onSpeechEnded, syncRuntimeFromStore } from './orchestrator';

export function syncRuntimeFromFinnusStore(): void {
  const s = useFinnusStore.getState();
  syncRuntimeFromStore({
    isPlayingAudio: s.isPlayingAudio,
    isListening: s.isListening,
    isGenerating: s.isGenerating,
    navActive: s.navActive,
  });
}

/** After TTS ends — returns queued POI id if orchestrator wants to fire next. */
export function dequeueRuntimeAfterSpeech(): number | null {
  syncRuntimeFromFinnusStore();
  const next = onSpeechEnded();
  if (next?.action === 'run_gps_trigger') return next.poiId;
  return null;
}

/**
 * Central hook — call when all TTS sessions finished (any module).
 * Flushes queued GPS triggers + deferred nav turn cues („übrigens…“).
 */
export function notifyRuntimeSpeechEnded(): void {
  // Speech-Ende — kein UI-Clear nötig
  const poiId = dequeueRuntimeAfterSpeech();
  if (poiId != null) {
    void import('./exploreModule').then((m) => m.triggerPoiArrival(poiId));
  }
  void import('../services/AudioVoiceService').then((m) =>
    m.flushQueuedNavSpeechCue({ afterSpeechEnd: true }),
  );
}
