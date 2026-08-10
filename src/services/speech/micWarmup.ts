/**
 * Mic-Press Warmup — nur TTS / Aussprache (kein Fragen-Modul).
 */

let lastWarmMs = 0;
const WARM_COOLDOWN_MS = 8_000;

/**
 * Fire-and-forget beim Mic-Druck (vor STT-Ende).
 */
export function warmupAiOnMicPress(): void {
  const now = Date.now();
  if (now - lastWarmMs < WARM_COOLDOWN_MS) return;
  lastWarmMs = now;

  void (async () => {
    try {
      const { getCachedUserProfile } = await import('../userProfileService');
      const profile = getCachedUserProfile();
      const voiceId = profile?.voiceId;
      const { warmupTtsEngine } = await import('../AudioVoiceService');
      await warmupTtsEngine(voiceId ? { voiceId } : undefined);
    } catch {
      /* soft */
    }
    try {
      const { warmupPronunciationPipeline } = await import('../g2p');
      void warmupPronunciationPipeline();
    } catch {
      /* soft */
    }
  })();
}
