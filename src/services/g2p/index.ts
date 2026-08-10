import type { GermanG2PProvider } from './types';
import { germanIpaG2P } from './de/germanIpaG2p';
import {
  nativeEspeakGermanG2P,
  phonemizeGermanNativeEspeak,
  warmupNativeEspeakG2P,
} from './nativeEspeakG2p';

export type { GermanG2PProvider } from './types';
export { roughGermanG2P } from './roughGermanG2p';
export { germanIpaG2P, phonemizeGermanIpa } from './de/germanIpaG2p';
export { normalizeGermanTtsText } from './germanTextNormalize';
export {
  applyGermanTtsProsodyRules,
  applyEnumerationRhythm,
  applySpokenContractions,
  applyContrastiveFocusStress,
  applyGreetingPauses,
  applyNarratorFinale,
  isGreetingOrWelcomeSentence,
  sentenceEndPauseMs,
  SENTENCE_END_PAUSE_MS,
  GREETING_PAUSE_MS,
  COMMA_PAUSE_MS,
  GEN_Z_PAUSE_MS,
  applyGenZRunOnProsody,
  applyPunctuationSpacing,
  applyEmotionalEmphasis,
  applyTtsProsody,
  stripLlmProsodyMarkers,
  stripStageDirections,
} from './germanTtsProsodyRules';
export {
  GERMAN_TTS_PROSODY_LLM_PROMPT,
  buildGermanTtsProsodyPrompt,
} from './germanTtsProsodyPrompt';
export {
  polishGermanTtsWithLlm,
  polishGermanTtsSync,
} from './llmGermanTtsPolish';
export {
  applyPhoneticTransformer,
  prepareSpokenText,
  prepareDisplayText,
  prepareAudioText,
  sanitizeSpokenText,
  numberToGermanWords,
  expandAllDigitsToWords,
  applyEnglishOrthoPronunciations,
  applyShortNounAudioHints,
  normalizeShortGermanNounCasing,
  transformClockTimes,
  transformOrdinalDates,
  transformLetterCodes,
  expandTransitLineCodes,
  normalizeOnomatopoeia,
  applyPlaceNamePhonetics,
  stripSpellTrapsAndMarkdownJunk,
  splitDisplayAndAudioText,
  isOrthoPronunciation,
  isIpaPronunciation,
} from './phoneticTransformer';
export {
  applyPronunciationMap,
  phonemizeWithPronunciationMap,
  PRONUNCIATION_MAP,
  PRONUNCIATION_DICTIONARY,
  loadPronunciationDictionary,
  getPronunciationCache,
  lookupPronunciationTier,
} from './pronunciationMap';
export {
  getFusedPronunciationMap,
  getCityPronunciationMap,
  mergePronunciationMaps,
  invalidateCityPronunciationCache,
  warmupPronunciationPipeline,
} from './fusedPronunciation';
export {
  nativeEspeakGermanG2P,
  phonemizeGermanNativeEspeak,
  warmupNativeEspeakG2P,
  mapEspeakIpaToTts,
  validateGermanIpaSample,
} from './nativeEspeakG2p';

/**
 * Produktiver Provider: natives espeak-ng (de).
 * Sync-API fällt auf JS zurück; Async nutzt JNI.
 */
let activeProvider: GermanG2PProvider = nativeEspeakGermanG2P;

export function getGermanG2P(): GermanG2PProvider {
  return activeProvider;
}

export function setGermanG2P(provider: GermanG2PProvider): void {
  activeProvider = provider;
  console.log(
    `[g2p] Provider → ${provider.id} (productionReady=${provider.productionReady})`,
  );
}

export function enableGermanG2PForProduct(): void {
  setGermanG2P(nativeEspeakGermanG2P);
}

export function isGermanG2PProductionReady(): boolean {
  return activeProvider.productionReady;
}

/** Warmup: natives espeak-ng (de), sonst JS-Fallback bleibt verfügbar. */
export function warmupGermanG2P(): Promise<boolean> {
  return warmupNativeEspeakG2P().then((ok) => {
    setGermanG2P(nativeEspeakGermanG2P);
    console.log(
      ok
        ? '[g2p] Deutsch-Phonemisierung: espeak-ng native (de)'
        : '[g2p] Deutsch-Phonemisierung: JS-Fallback (Native nicht bereit)',
    );
    return ok;
  });
}

/** Sync — nur JS (Native ist async). Für Debug. */
export function phonemizeGerman(text: string): string {
  return activeProvider.phonemize(text);
}

/** Async-Pfad: natives espeak-ng → TTS-IPA. */
export async function phonemizeGermanAsync(text: string): Promise<string> {
  return phonemizeGermanNativeEspeak(text);
}

/** @deprecated Legacy-Alias */
export const espeakGermanG2P = nativeEspeakGermanG2P;
export async function phonemizeGermanEspeak(text: string): Promise<string> {
  return phonemizeGermanNativeEspeak(text);
}
export async function warmupEspeakGermanG2P(): Promise<boolean> {
  return warmupNativeEspeakG2P();
}
