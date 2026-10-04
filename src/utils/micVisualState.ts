import type { FindusMood } from '../components/AudioWave';

/** Visuelle Mic-Zustände (Priorität: listening/locked > speaking > thinking > idle). */
export type MicVisualState = 'idle' | 'thinking' | 'speaking' | 'listening' | 'locked';

/**
 * Call-1→Call-2: gelb (speak) → blau (think) → gelb (speak) → grün (idle).
 * Speaking schlägt Thinking — sonst bleibt Mic blau während Call-1 Speech.
 */
export function resolveMicVisualState(opts: {
  isListening: boolean;
  isMicLocked: boolean;
  isSpeaking: boolean;
  isGenerating: boolean;
  isFinalizing: boolean;
  mood?: FindusMood;
}): MicVisualState {
  if (opts.isMicLocked) return 'locked';
  if (opts.isListening || opts.mood === 'listening') return 'listening';
  if (opts.isSpeaking || opts.mood === 'speaking') return 'speaking';
  if (
    opts.isGenerating ||
    opts.isFinalizing ||
    opts.mood === 'thinking'
  ) {
    return 'thinking';
  }
  return 'idle';
}
