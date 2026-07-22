/**
 * Früher: Auto-TTS auf neue assistant-Nachrichten.
 * Audio läuft jetzt über speakTwoPhase in poiTrigger / useVoiceInput.
 */
export function useAssistantTts(): void {
  // no-op – Zwei-Phasen-Kokoro steuert Untertitel + Playback direkt
}
