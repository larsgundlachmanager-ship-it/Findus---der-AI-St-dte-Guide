/**
 * Grapheme-to-Phoneme für TTS (Deutsch).
 * Produktion: natives espeak-ng (de) via findus-espeak JNI.
 */
export type GermanG2PProvider = {
  /** Stabiler Identifier für Logs / Feature-Gates */
  readonly id: string;
  /**
   * true = Phoneme sind produktionsreif für TTS-Inferenz.
   * false = nur Übergang; Produkt sollte System-TTS / Flag nutzen.
   */
  readonly productionReady: boolean;
  /** Text → TTS-Phonemstring (IPA / Vocab-Zeichen) */
  phonemize(text: string): string;
};
