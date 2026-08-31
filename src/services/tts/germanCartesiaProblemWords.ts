/**
 * Gezielte DE-Problemwörter für Cartesia — aktuell no-op.
 *
 * Sounds-like (Tsihl, Ruute, Schtart) sieht für sonic-3.5 wie Englisch aus
 * und zieht den ganzen Satz in den US-Akzent. Native de-DE-Stimmen
 * (Alina/Sebastian) brauchen normalen deutschen Text — wie die Hörproben.
 *
 * Einzelne echte Problemfälle: Cartesia Pronunciation Dictionary
 * (EXPO_PUBLIC_CARTESIA_PRONUNCIATION_DICT_ID), nicht Ortho-Hacks im Transcript.
 */

/** lowercase key → Ersatz für TTS. Leer = kein Umschreiben. */
export const GERMAN_CARTESIA_PROBLEM_WORDS: Record<string, string> = {};

/**
 * Restlicher Text unverändert — Alina/Sebastian bekommen echtes Deutsch.
 */
export function applyGermanCartesiaProblemWords(text: string): string {
  return text.normalize('NFKC');
}
