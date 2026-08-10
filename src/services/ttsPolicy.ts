/**
 * TTS-Routing: Cartesia sonic-3.5 primär, expo-speech als Offline-Fallback.
 */

export const TTS_LOADING_MSG = 'Stimme wird vorbereitet…';
export const TTS_UNAVAILABLE_MSG =
  'Sprachausgabe fehlgeschlagen. Offline nutze ich die Systemstimme.';

/** @deprecated use TTS_LOADING_MSG */
export const TTS_DOWNLOAD_MSG = 'Cartesia TTS wird geladen…';

export function enableCartesiaProductMode(): void {
  console.log('[tts] Cartesia sonic-3.5 — Offline-Fallback: expo-speech');
}
