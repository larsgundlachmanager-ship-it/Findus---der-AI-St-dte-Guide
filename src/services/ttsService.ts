/**
 * Öffentliche TTS-API – Instant Samples + Sentence-Streaming + Eager Boot (Cartesia).
 */
export {
  speakAssistantText,
  speakTwoPhase,
  speakText,
  speakSentenceStream,
  speakOnboardingIntro,
  prefetchOnboardingIntro,
  prefetchOnboardingAudioBundle,
  prefetchVoiceSamples,
  prepareOnboardingVoiceSamples,
  prefetchSingleVoiceSample,
  playVoiceSample,
  hydrateSampleCacheFromDisk,
  startVoiceBuffer,
  isVoiceSampleReady,
  isOnboardingIntroHeadReady,
  synthesizeWav,
  stopSpeaking,
  resetTtsOnInterruption,
  pauseSpeakingForNav,
  resumeSpeakingAfterNav,
  speakNavWithMultitask,
  playCachedNavCueWav,
  flushQueuedNavSpeechCue,
  enqueueNavSpeechCue,
  isFindusSpeechBusyForNav,
  getActiveTtsSessionCount,
  releaseSpeakingUiIfIdle,
  forceClearSpeakingUi,
  ensureTtsReady,
  ensureVoicePack,
  warmupTtsEngine,
  resetVoiceSystem,
  purgeLegacyVoiceAssets,
  isTtsReady,
  isTtsLoading,
  markTtsWarmedUp,
  INTRO_VOICE,
  MARTIN_PURE,
  ONBOARDING_INTRO_HEAD_DE,
  applyPronunciationFixes,
} from './AudioVoiceService';

export {
  playGeminiStream,
  playSentenceChunks,
  interruptAudioPipeline,
  stopAudioPipeline,
} from '../runtime/audioPipeline';

export {
  flushStreamingAudioQueue,
  playStreamingAudioQueue,
  playStreamingText,
  getStreamingPrefetchDepth,
} from './audio/streamingAudioQueueService';

export {
  extractStreamingChunks,
  splitTextToStreamingChunks,
  streamingChunksFromTextStream,
} from './audio/punctuationChunker';

export { speakRuntimeText, speakRuntimeSentences } from '../runtime/speechModule';

export {
  enableCartesiaProductMode,
  TTS_LOADING_MSG,
  TTS_DOWNLOAD_MSG,
  TTS_UNAVAILABLE_MSG,
} from './ttsPolicy';

export {
  setGermanG2P,
  getGermanG2P,
  isGermanG2PProductionReady,
  phonemizeGerman,
  enableGermanG2PForProduct,
  warmupGermanG2P,
  roughGermanG2P,
  PRONUNCIATION_MAP,
  PRONUNCIATION_DICTIONARY,
  getFusedPronunciationMap,
  getCityPronunciationMap,
  warmupPronunciationPipeline,
  loadPronunciationDictionary,
} from './g2p';

export {
  PRONUNCIATION_CATEGORIES,
  getPronunciationCategoryCounts,
  getPronunciationMapSize,
} from './tts/pronunciationMap';

export {
  parseAndCacheCityPronunciations,
  type CityPackage,
} from './tts/cityPronunciationParser';

export { getVoiceSettingsForTour } from './userProfileService';

import {
  startVoiceBuffer,
  purgeLegacyVoiceAssets,
  hydrateSampleCacheFromDisk,
  prefetchVoiceSamples,
} from './AudioVoiceService';
import { enableCartesiaProductMode } from './ttsPolicy';
import { loadUserProfile } from './userProfileService';
import { voicePreloader } from './tts/voicePreloader';

export { voicePreloader };
export type { WarmVoiceResult } from './tts/voicePreloader';

/**
 * Sofort beim App-Start: Legacy-Assets purge → Cartesia keep-warm.
 */
export function preloadTtsAtBoot(): void {
  enableCartesiaProductMode();
  void hydrateSampleCacheFromDisk();
  void purgeLegacyVoiceAssets().catch(() => undefined);

  void loadUserProfile().then((profile) => {
    const voiceId = profile?.voiceId ?? 'alina';
    startVoiceBuffer({ speechRate: 1, priorityVoiceId: voiceId });
    void prefetchVoiceSamples(voiceId);
    void voicePreloader.warmActiveVoice(voiceId);
  });
}
