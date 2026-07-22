/**
 * Re-Export: Phonetic Transformer lebt unter g2p/.
 * Audio-only Orthografie + Kurzwort-Schutz (Hof, Fairway, …).
 * Display bleibt Original; nur Audio wird phonetisch korrigiert.
 * Dictionary-Engine (Base + Cloud + User-Scan) läuft vor jeder Audio-Generierung.
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
