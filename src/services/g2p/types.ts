/**
 * Grapheme-to-Phoneme für Kokoro (Deutsch).
 * Produktion: natives espeak-ng (de) via findus-espeak JNI.
 */
export type GermanG2PProvider = {
  /** Stabiler Identifier für Logs / Feature-Gates */
  readonly id: string;
  /**
   * true = Phoneme sind produktionsreif für Kokoro-Inferenz.
   * false = nur Übergang; Produkt sollte System-TTS / Flag nutzen.
   */
  readonly productionReady: boolean;
  /** Text → Kokoro-Phonemstring (IPA / Vocab-Zeichen) */
  phonemize(text: string): string;
};
