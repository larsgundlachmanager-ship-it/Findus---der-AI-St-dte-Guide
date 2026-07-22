/**
 * Öffentliche TTS-API – Instant Samples + Sentence-Streaming + Eager Boot.
 */
export {
  speakAssistantText,
  speakTwoPhase,
  speakWithKokoro,
  speakSentenceStream,
  speakOnboardingIntro,
  prefetchOnboardingIntro,
  prefetchOnboardingAudioBundle,
  prefetchVoiceSamples,
  prepareOnboardingVoiceSamples,
  prefetchAllKokoroVoicePacks,
  prefetchSingleVoiceSample,
  playVoiceSample,
  hydrateSampleCacheFromDisk,
  startVoiceBuffer,
  isVoiceSampleReady,
  isOnboardingIntroHeadReady,
  synthesizeWav,
  stopSpeaking,
  ensureKokoroAssets,
  ensureVoicePack,
  warmupKokoro,
  stopKokoroPlayback,
  resetVoiceSystem,
  purgeLegacyVoiceAssets,
  isKokoroReady,
  isKokoroLoading,
  INTRO_VOICE,
  MARTIN_PURE,
  ONBOARDING_INTRO_HEAD_DE,
} from './AudioVoiceService';

export {
  setKokoroProductInferenceEnabled,
  isKokoroProductInferenceEnabled,
  shouldUseKokoroInference,
  enableKokoroProductMode,
  KOKORO_LOADING_MSG,
  KOKORO_DOWNLOAD_MSG,
  KOKORO_UNAVAILABLE_MSG,
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
  prefetchAllKokoroVoicePacks,
  applyPronunciationFixes,
} from './AudioVoiceService';
import { enableKokoroProductMode } from './ttsPolicy';
import {
  enableGermanG2PForProduct,
  warmupGermanG2P,
  warmupPronunciationPipeline,
} from './g2p';
import { loadUserProfile } from './userProfileService';
// Side-effect: registriert Active-Voice-Warmer am AudioVoiceService
import { voicePreloader } from './tts/voicePreloader';

export { applyPronunciationFixes };
export { voicePreloader };
export type { WarmVoiceResult } from './tts/voicePreloader';

/**
 * Sofort beim App-Start: Purge → Martin-ONNX + aktive Stimme keep-warm im RAM.
 * Weitere Packs nur auf Disk (für späteren Wechsel), nicht alle im RAM.
 */
export function preloadKokoroAtBoot(): void {
  enableKokoroProductMode();
  enableGermanG2PForProduct();
  void warmupPronunciationPipeline();
  void warmupGermanG2P();
  void hydrateSampleCacheFromDisk();
  void purgeLegacyVoiceAssets().catch(() => undefined);

  void loadUserProfile().then((profile) => {
    const voiceId = profile?.voiceId ?? 'standard_m';
    startVoiceBuffer({ speechRate: 1, priorityVoiceId: voiceId });
    // Disk-Prefetch anderer Packs parallel — RAM bleibt single-active
    void prefetchAllKokoroVoicePacks();
    void prefetchVoiceSamples(voiceId);
    void voicePreloader.warmActiveVoice(voiceId);
  });
}