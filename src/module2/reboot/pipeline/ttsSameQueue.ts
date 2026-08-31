/**
 * Eine TTS-Session: Call-2 hängt an, startet keine zweite Queue.
 * SSOT bleibt startLiveSpeechSession in runConciergeTurn (no-op wenn schon gestartet).
 */

export function shouldStartNewLiveSpeechSession(alreadyStarted: boolean): boolean {
  return !alreadyStarted;
}
