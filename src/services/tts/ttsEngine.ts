/**
 * TTS Engine facade — Active-Voice Keep-Warm API (Cartesia).
 */
export {
  voicePreloader,
  type WarmVoiceResult,
} from './voicePreloader';

export { voicePreloader as ttsEngine } from './voicePreloader';

export {
  warmupTtsEngine,
  startVoiceBuffer,
  synthesizeWav,
  speakText,
  speakAssistantText,
  stopSpeaking,
  isTtsReady,
  loadVoiceIntoRam,
  unloadVoiceFromRam,
  unloadInactiveVoicePacks,
  ensureMartinOrtSession,
  markTtsWarmedUp,
} from '../AudioVoiceService';
