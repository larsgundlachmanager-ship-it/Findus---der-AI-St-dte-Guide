import type { FindusMood } from '../components/AudioWave';

/** Phinnos-Avatar-Zustand — nur aktive Interaktion, kein Follow-up-Chip. */
export function derivePhinnosMood(opts: {
  isListening: boolean;
  isFinalizing: boolean;
  isGenerating: boolean;
  /** Legacy: Session busy — nicht für „Ich erzähle“ */
  isPlayingAudio: boolean;
  /** Echt hörbar — steuert speaking/standby */
  isAudiblySpeaking?: boolean;
  navRouteLoading?: boolean;
}): FindusMood {
  if (opts.isListening) return 'listening';
  if (
    opts.isFinalizing ||
    opts.isGenerating ||
    opts.navRouteLoading
  ) {
    return 'thinking';
  }
  // Nur bei echtem Audio „Ich erzähle“ — sonst Standby (idle)
  if (opts.isAudiblySpeaking) return 'speaking';
  return 'idle';
}
