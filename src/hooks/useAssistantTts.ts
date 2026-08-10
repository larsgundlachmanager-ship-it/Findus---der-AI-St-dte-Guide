/**
 * Früher: Auto-TTS auf neue assistant-Nachrichten.
 * Audio läuft jetzt über speakTwoPhase in poiTrigger / useVoiceInput.
 */
export function useAssistantTts(): void {
  // no-op – Zwei-Phasen-TTS steuert Untertitel + Playback direkt
}
