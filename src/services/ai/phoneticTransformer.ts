/**
 * Re-Export: Phonetic Transformer lebt unter g2p/.
 * Audio-only: EN-Ortho für Anglizismen; Alltagswörter bleiben Deutsch (native Cartesia).
 * Display bleibt Original.
 */
export {
  applyPhoneticTransformer,
  prepareSpokenText,
  prepareDisplayText,
  prepareAudioText,
  splitDisplayAndAudioText,
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
  isOrthoPronunciation,
  isIpaPronunciation,
  resetOrthoPronunciationCache,
} from '../g2p/phoneticTransformer';

export {
  applyDictionaryToAudioText,
  initDictionaryEngine,
  lookupPronunciation,
  getCombinedDictionary,
} from '../tts/dictionaryEngine';

export {
  transformMultilingualTerms,
  initMultilingualPhoneticEngine,
  lookupMultilingualPhonetic,
  getCombinedPhoneticMap,
} from './multilingualPhoneticEngine';

export {
  scanPoiDataset,
  scanPoiDatasetSafe,
  applyPhoneticRules,
} from './poiDatasetScanner';
