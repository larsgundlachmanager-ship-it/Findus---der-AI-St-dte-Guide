/**
 * Phoneme cleanup for G2P → TTS pipelines (Cartesia).
 * Formerly model-vocab filter — now identity-safe sanitize (no model vocab lock-in).
 */

/** Keep IPA / punctuation useful for TTS; strip control junk. */
export function filterPhonemesToVocab(phonemes: string): string {
  return phonemes
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** @deprecated legacy token map removed */
export function tokenIdForPhoneme(_ch: string): number | undefined {
  return undefined;
}
