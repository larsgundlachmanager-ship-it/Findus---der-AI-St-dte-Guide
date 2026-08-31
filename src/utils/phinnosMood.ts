import type { FindusMood } from '../components/AudioWave';

/** Phinnos-Avatar-Zustand — nur aktive Interaktion, kein Follow-up-Chip. */
export function derivePhinnosMood(opts: {
  isListening: boolean;
  isFinalizing: boolean;
  isGenerating: boolean;
  /** Legacy: Session busy — nicht allein Thinking (sonst Dauer-Drehen wenn sticky) */
  isPlayingAudio: boolean;
  /** Echt hörbar — steuert speaking/standby */
  isAudiblySpeaking?: boolean;
  navRouteLoading?: boolean;
  /** Tour läuft schon — Ladebalken darf Orb nicht dauerblau halten. */
  navActive?: boolean;
}): FindusMood {
  // Blau (denken) vor Rot (Mic): Recherche darf nicht wie „sprich jetzt“ aussehen.
  if (opts.isAudiblySpeaking) return 'speaking';
  const routePending = Boolean(opts.navRouteLoading) && !opts.navActive;
  if (opts.isFinalizing || opts.isGenerating || routePending) {
    return 'thinking';
  }
  if (opts.isListening) return 'listening';
  // isPlayingAudio allein = kein Lade-Spinner (verhindert „überlegt“-Falschpositiv)
  void opts.isPlayingAudio;
  return 'idle';
}
