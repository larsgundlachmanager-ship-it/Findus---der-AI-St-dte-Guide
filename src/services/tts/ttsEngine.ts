/**
 * TTS Engine facade — Active-Voice Keep-Warm API (Piper).
 */
export {
  voicePreloader,
  type WarmVoiceResult,
} from './voicePreloader';

export { voicePreloader as ttsEngine } from './voicePreloader';

export {
  warmupKokoro,
  warmupPiperEngine,
  startVoiceBuffer,
  synthesizeWav,
  speakWithKokoro,
  speakWithPiper,
  speakAssistantText,
  stopSpeaking,
  isKokoroReady,
  isPiperReady,
  loadVoiceIntoRam,
  unloadVoiceFromRam,
  unloadInactiveVoicePacks,
  ensureMartinOrtSession,
  markKokoroWarmedUp,
  markPiperWarmedUp,
} from '../AudioVoiceService';
