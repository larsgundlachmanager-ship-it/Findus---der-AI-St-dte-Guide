/**
 * Öffentliche TTS-API – Instant Samples + Sentence-Streaming + Eager Boot (Piper).
 */
export {
  speakAssistantText,
  speakTwoPhase,
  speakWithPiper,
  speakWithKokoro,
  speakSentenceStream,
  speakOnboardingIntro,
  prefetchOnboardingIntro,
  prefetchOnboardingAudioBundle,
  prefetchVoiceSamples,
  prepareOnboardingVoiceSamples,
  prefetchAllKokoroVoicePacks,
  prefetchAllPiperModels,
  prefetchSingleVoiceSample,
  playVoiceSample,
  hydrateSampleCacheFromDisk,
  startVoiceBuffer,
  isVoiceSampleReady,
  isOnboardingIntroHeadReady,
  synthesizeWav,
  stopSpeaking,
  resetTtsOnInterruption,
  ensureKokoroAssets,
  ensurePiperAssets,
  ensureVoicePack,
  ensurePiperModel,
  warmupKokoro,
  warmupPiperEngine,
  stopKokoroPlayback,
  stopPiperPlayback,
  resetVoiceSystem,
  purgeLegacyVoiceAssets,
  isKokoroReady,
  isPiperReady,
  isKokoroLoading,
  isPiperLoading,
  INTRO_VOICE,
  MARTIN_PURE,
  ONBOARDING_INTRO_HEAD_DE,
  applyPronunciationFixes,
} from './AudioVoiceService';

export {
  setKokoroProductInferenceEnabled,
  setPiperProductInferenceEnabled,
  isKokoroProductInferenceEnabled,
  isPiperProductInferenceEnabled,
  shouldUseKokoroInference,
  shouldUsePiperInference,
  enableKokoroProductMode,
  enablePiperProductMode,
  KOKORO_LOADING_MSG,
  KOKORO_DOWNLOAD_MSG,
  KOKORO_UNAVAILABLE_MSG,
  PIPER_LOADING_MSG,
  PIPER_DOWNLOAD_MSG,
  PIPER_UNAVAILABLE_MSG,
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
import { enablePiperProductMode } from './ttsPolicy';
import { loadUserProfile } from './userProfileService';
import { voicePreloader } from './tts/voicePreloader';

export { voicePreloader };
export type { WarmVoiceResult } from './tts/voicePreloader';

/**
 * Sofort beim App-Start: Purge Kokoro-Legacy → Piper-Modell keep-warm.
 */
export function preloadPiperAtBoot(): void {
  enablePiperProductMode();
  void hydrateSampleCacheFromDisk();
  void purgeLegacyVoiceAssets().catch(() => undefined);

  void loadUserProfile().then((profile) => {
    const voiceId = profile?.voiceId ?? 'standard_m';
    startVoiceBuffer({ speechRate: 1, priorityVoiceId: voiceId });
    void prefetchVoiceSamples(voiceId);
    void voicePreloader.warmActiveVoice(voiceId);
  });
}

/** @deprecated */
export function preloadKokoroAtBoot(): void {
  preloadPiperAtBoot();
}
