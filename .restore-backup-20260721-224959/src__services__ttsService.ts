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

export {
  transformPhoneticSentence,
  transformPhoneticSentenceAsync,
  transformPhoneticText,
} from './tts/phoneticTransformer';

export { getVoiceSettingsForTour } from './userProfileService';

import {
  startVoiceBuffer,
  warmupKokoro,
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

export { applyPronunciationFixes };

/**
 * Sofort beim App-Start: Purge → ONNX + 4 DE-Stimmen (de_thorsten/eva/karl/puck) → Samples.
 */
export function preloadKokoroAtBoot(): void {
  enableKokoroProductMode();
  enableGermanG2PForProduct();
  void warmupPronunciationPipeline();
  void warmupGermanG2P();
  void hydrateSampleCacheFromDisk();
  void purgeLegacyVoiceAssets().catch(() => undefined);
  startVoiceBuffer({ speechRate: 1, priorityVoiceId: 'standard_m' });
  void warmupKokoro().then(() => {
    void prefetchAllKokoroVoicePacks();
    void prefetchVoiceSamples('standard_m');
  });
}
