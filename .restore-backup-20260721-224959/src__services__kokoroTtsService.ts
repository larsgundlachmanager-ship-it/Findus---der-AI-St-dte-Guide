/**
 * @deprecated Use AudioVoiceService / ttsService directly.
 * Re-export shim — Stimmen/TTS brauchen diesen Pfad für ältere Imports.
 */
export {
  speakAssistantText,
  speakWithKokoro,
  speakTwoPhase,
  speakSentenceStream,
  stopSpeaking,
  stopKokoroPlayback,
  warmupKokoro,
  ensureKokoroAssets,
  ensureVoicePack,
  isKokoroReady,
  isKokoroLoading,
  applyPronunciationFixes,
  synthesizeWav,
} from './AudioVoiceService';
