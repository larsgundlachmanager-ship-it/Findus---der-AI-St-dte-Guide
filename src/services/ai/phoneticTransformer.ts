/**
 * Re-Export: Phonetic Transformer lebt unter g2p/.
 * Audio-only Orthografie + Kurzwort-Schutz vor Kokoro / speakTwoPhase.
 * Display bleibt Original; nur Audio wird phonetisch korrigiert.
 * Dictionary-Engine (Base + Cloud + User-Scan) läuft vor jeder Audio-Generierung.
 *
 * Pflicht-Swaps (Audio):
 * - „Prisdorf" → „Prissdorf"
 * - „Hof" → „Hoff" (Komposita: Bahnhof→Bahnoff, …)
 * - „Bus" → „Buss"
 * Plus: Small-Cup/Markdown-Müll, Liniennummern, Sound-Hooks (Tüt-tüt).
 *
 * Queue: AudioVoiceService.speakTwoPhase hält Fast-Hook sofort spielbereit,
 * während Body-Sätze entkoppelt im Hintergrund vorbereitet werden.
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
