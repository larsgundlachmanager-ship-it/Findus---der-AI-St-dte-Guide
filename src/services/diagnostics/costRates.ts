/**
 * API-Listenpreise für Tester-Obergrenzen (konservativ, ohne Rabatte).
 * Effizient = Flash-Lite + tatsächliche TTS-Overage-Rate.
 */

import { CARTESIA_EUR_PER_1K_CHARS } from '../../constants/cartesiaVoices';

export type CostModuleId =
  | 'nav'
  | 'research'
  | 'concierge'
  | 'story'
  | 'followup'
  | 'tts'
  | 'maps'
  | 'other';

export const COST_MODULE_LABELS: Record<CostModuleId, string> = {
  nav: 'Navigation',
  research: 'Live-Recherche',
  concierge: 'Concierge / Antworten',
  story: 'Stories / Historie',
  followup: 'Rückfragen',
  tts: 'Stimme (Cartesia)',
  maps: 'Karten / Places',
  other: 'Sonstiges',
};

/** Gemini 2.5 Pro list (ceiling). */
export const CONS_GEMINI_IN_PER_M = 1.25;
export const CONS_GEMINI_OUT_PER_M = 10;
/** Flash-Lite — tatsächlicher Sparpfad. */
export const EFF_GEMINI_IN_PER_M = 0.1;
export const EFF_GEMINI_OUT_PER_M = 0.4;
/** Cartesia Pro-Overage SSOT (65 $/1M ≈ 0,065 / 1k Zeichen). */
export const CONS_TTS_PER_1K = CARTESIA_EUR_PER_1K_CHARS;
export const EFF_TTS_PER_1K = CARTESIA_EUR_PER_1K_CHARS;
/** Places Nearby / Details list ~0,03 € / Call. */
export const CONS_MAPS_PER_CALL = 0.03;
export const EFF_MAPS_PER_CALL = 0.008;

export type GeminiCostTier = 'lite' | 'pro';

export function geminiEur(
  charsIn: number,
  charsOut: number,
  mode: 'conservative' | 'efficient',
  tier: GeminiCostTier = 'lite',
): number {
  const inR =
    mode === 'conservative' || tier === 'pro'
      ? CONS_GEMINI_IN_PER_M
      : EFF_GEMINI_IN_PER_M;
  const outR =
    mode === 'conservative' || tier === 'pro'
      ? CONS_GEMINI_OUT_PER_M
      : EFF_GEMINI_OUT_PER_M;
  return (Math.max(0, charsIn) / 1_000_000) * inR + (Math.max(0, charsOut) / 1_000_000) * outR;
}

export function ttsEur(chars: number, mode: 'conservative' | 'efficient'): number {
  const r = mode === 'conservative' ? CONS_TTS_PER_1K : EFF_TTS_PER_1K;
  return (Math.max(0, chars) / 1000) * r;
}

export function mapsEur(calls: number, mode: 'conservative' | 'efficient'): number {
  const r = mode === 'conservative' ? CONS_MAPS_PER_CALL : EFF_MAPS_PER_CALL;
  return Math.max(0, calls) * r;
}

export function mapGeminiTaskToModule(
  task?: string | null,
): CostModuleId {
  switch (task) {
    case 'nav_parse':
    case 'itinerary':
      return 'nav';
    case 'story':
    case 'history_deep':
    case 'teaser':
      return 'story';
    case 'concierge':
    case 'intent':
      return 'concierge';
    case 'local_qa':
      return 'followup';
    case 'research':
      return 'research';
    case 'weather':
      return 'other';
    default:
      return 'other';
  }
}
