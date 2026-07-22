/**
 * TTS Engine facade — Active-Voice Keep-Warm API.
 *
 * Die Synthese selbst liegt in AudioVoiceService; dieser Einstieg bündelt
 * den Singleton-VoicePreloader für Boot und Persona-Wechsel.
 */
export {
  voicePreloader,
  VoicePreloaderService,
  type WarmVoiceResult,
} from './voicePreloader';

/** Alias: Engine-Einstieg für Active-Voice Keep-Warm. */
export { voicePreloader as ttsEngine } from './voicePreloader';

export {
  warmupKokoro,
  startVoiceBuffer,
  synthesizeWav,
  speakWithKokoro,
  speakAssistantText,
  stopSpeaking,
  isKokoroReady,
  loadVoiceIntoRam,
  unloadVoiceFromRam,
  unloadInactiveVoicePacks,
  ensureMartinOrtSession,
  markKokoroWarmedUp,
} from '../AudioVoiceService';
