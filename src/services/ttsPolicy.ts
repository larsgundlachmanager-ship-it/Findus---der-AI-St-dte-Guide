/**
 * TTS-Routing: Männer → Piper, Frauen → Kokoro (de_nova / de_bella).
 */
import type { VoiceId } from '../types/userProfile';
import { isKokoroVoice } from '../constants/kokoroVoicePacks';
import { resolveTtsEngine } from '../constants/voices';

export const PIPER_LOADING_MSG = 'Sprachmodell wird vorbereitet…';
export const PIPER_DOWNLOAD_MSG = 'Sprachmodell wird geladen…';
export const PIPER_UNAVAILABLE_MSG =
  'Deutsche Sprachausgabe konnte nicht gestartet werden. App neu starten — Internet ist dafür nicht nötig.';

export const KOKORO_LOADING_MSG = PIPER_LOADING_MSG;
export const KOKORO_DOWNLOAD_MSG = PIPER_DOWNLOAD_MSG;
export const KOKORO_UNAVAILABLE_MSG = PIPER_UNAVAILABLE_MSG;

export function shouldUseKokoroInference(voiceId?: VoiceId | null): boolean {
  return isKokoroVoice(voiceId);
}

export function shouldUsePiperInference(voiceId?: VoiceId | null): boolean {
  return resolveTtsEngine(voiceId) === 'piper';
}

export function enablePiperProductMode(): void {
  console.log(
    '[tts] Hybrid — Männer: Piper | Frauen: Kokoro de_nova (standard_w) + de_bella (prinzessin)',
  );
}

export function enableKokoroProductMode(): void {
  enablePiperProductMode();
}

export function setPiperProductInferenceEnabled(_enabled: boolean): void {}
export function setKokoroProductInferenceEnabled(enabled: boolean): void {
  setPiperProductInferenceEnabled(enabled);
}

export function isPiperProductInferenceEnabled(): boolean {
  return true;
}

export function isKokoroProductInferenceEnabled(): boolean {
  return true;
}
