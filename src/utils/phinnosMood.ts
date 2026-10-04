import type { FindusMood } from '../components/AudioWave';

/**
 * Phinnos/Mic-Zustand — nur aktive Interaktion.
 *
 * Call-1 → Call-2: gelb (speak) → blau (think via isGenerating) → gelb → grün.
 * Busy-Flags von Streaming/Queue hier NICHT lesen — die können kleben und
 * Mic dauerblau + Stichpunkte/Idle blockieren.
 */
export function derivePhinnosMood(opts: {
  isListening: boolean;
  isFinalizing: boolean;
  isGenerating: boolean;
  /** Legacy: Session busy — nicht allein Thinking */
  isPlayingAudio: boolean;
  /** Echt hörbar — steuert speaking */
  isAudiblySpeaking?: boolean;
  navRouteLoading?: boolean;
  /** Tour läuft schon — Ladebalken darf Orb nicht dauerblau halten. */
  navActive?: boolean;
}): FindusMood {
  if (opts.isAudiblySpeaking) return 'speaking';

  const routePending = Boolean(opts.navRouteLoading) && !opts.navActive;
  if (opts.isFinalizing || opts.isGenerating || routePending) {
    return 'thinking';
  }

  if (opts.isListening) return 'listening';
  void opts.isPlayingAudio;
  return 'idle';
}

/**
 * Echte Speech/TTS noch aktiv (ohne Gate-Flag).
 * Mit Timeout-Nutzung durch Caller — nie endlos pollen ohne Cap.
 */
export function isLiveSpeechTransportBusy(): boolean {
  try {
    const { isStreamingAudioQueueBusy } = require('../services/audio/streamingAudioQueueService') as {
      isStreamingAudioQueueBusy: () => boolean;
    };
    if (isStreamingAudioQueueBusy()) return true;
  } catch {
    /* soft */
  }
  try {
    const { getActiveTtsSessionCount } = require('../services/AudioVoiceService') as {
      getActiveTtsSessionCount: () => number;
    };
    if (getActiveTtsSessionCount() > 0) return true;
  } catch {
    /* soft */
  }
  return false;
}

/** @deprecated Alias — nicht für Mood nutzen (klebt). */
export function isTurnSpeechOrResearchPending(): boolean {
  return isLiveSpeechTransportBusy();
}
