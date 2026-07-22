/**
 * TTS-Routing: ausschließlich In-Memory Kokoro.
 * Modell + 4 Basisstimmen beim Boot in den RAM.
 */

export const KOKORO_LOADING_MSG = 'Sprachmodell wird vorbereitet…';
export const KOKORO_DOWNLOAD_MSG = 'Sprachmodell wird geladen…';
export const KOKORO_UNAVAILABLE_MSG =
  'Deutsches Sprachmodell nicht verfügbar. Bitte Internet prüfen und App neu starten.';

/** true wenn Kokoro-Session + Stimmen im RAM sind. */
export function shouldUseKokoroInference(opts?: {
  kokoroReady: boolean;
}): boolean {
  return Boolean(opts?.kokoroReady);
}

export function enableKokoroProductMode(): void {
  console.log('[tts] Kokoro DE Multi-Speaker (Martin/Victoria + 4 Packs)');
}

export function setKokoroProductInferenceEnabled(_enabled: boolean): void {
  // Legacy-API
}

export function isKokoroProductInferenceEnabled(): boolean {
  return true;
}
