/**
 * API / Gemini usage counters for Developer settings.
 * Tracks chars in/out and rough € cost for the current session.
 * Persists lifetime / today / last session via apiCostLedger.
 */

import {
  finalizeCurrentSession,
  getCostOverview,
  resetCurrentSessionUsage,
  trackLedgerGemini,
  trackLedgerMaps,
  trackLedgerTts,
  type CostOverview,
} from '../diagnostics/apiCostLedger';

type UsageBucket = {
  requests: number;
  charsIn: number;
  charsOut: number;
};

const state: {
  gemini: UsageBucket;
  maps: UsageBucket;
  tts: UsageBucket;
  startedAtMs: number;
} = {
  gemini: { requests: 0, charsIn: 0, charsOut: 0 },
  maps: { requests: 0, charsIn: 0, charsOut: 0 },
  tts: { requests: 0, charsIn: 0, charsOut: 0 },
  startedAtMs: Date.now(),
};

/** Gemini Flash-Lite ≈ €0.10 / 1M input, €0.40 / 1M output (approx). */
const GEMINI_IN_PER_M = 0.1;
const GEMINI_OUT_PER_M = 0.4;
/** Rough Maps Places/Directions call ≈ €0.005–0.017 — use mid. */
const MAPS_PER_CALL = 0.008;
/** Cartesia sonic-3.5 ≈ €0.009 / 1k chars. */
const TTS_CLOUD_PER_1K = 0.009;

function bump(bucket: UsageBucket, charsIn: number, charsOut: number): void {
  bucket.requests += 1;
  bucket.charsIn += Math.max(0, charsIn);
  bucket.charsOut += Math.max(0, charsOut);
}

export function trackGeminiUsage(charsIn: number, charsOut: number): void {
  bump(state.gemini, charsIn, charsOut);
  trackLedgerGemini(charsIn, charsOut);
}

export function trackMapsUsage(label = 'maps'): void {
  bump(state.maps, label.length, 0);
  trackLedgerMaps(label);
}

export function trackTtsUsage(chars: number, cloud = false): void {
  if (!cloud) {
    bump(state.tts, chars, 0);
    return;
  }
  bump(state.tts, chars, chars);
  trackLedgerTts(chars, true);
}

export type ApiUsageSnapshot = {
  geminiRequests: number;
  geminiCharsIn: number;
  geminiCharsOut: number;
  mapsRequests: number;
  ttsRequests: number;
  ttsChars: number;
  estimatedEur: number;
  sessionMinutes: number;
  breakdown: {
    geminiEur: number;
    mapsEur: number;
    ttsEur: number;
  };
};

export function getApiUsageSnapshot(): ApiUsageSnapshot {
  const geminiEur =
    (state.gemini.charsIn / 1_000_000) * GEMINI_IN_PER_M +
    (state.gemini.charsOut / 1_000_000) * GEMINI_OUT_PER_M;
  const mapsEur = state.maps.requests * MAPS_PER_CALL;
  const ttsEur =
    (state.tts.charsOut / 1000) * TTS_CLOUD_PER_1K;
  return {
    geminiRequests: state.gemini.requests,
    geminiCharsIn: state.gemini.charsIn,
    geminiCharsOut: state.gemini.charsOut,
    mapsRequests: state.maps.requests,
    ttsRequests: state.tts.requests,
    ttsChars: state.tts.charsOut,
    estimatedEur: geminiEur + mapsEur + ttsEur,
    sessionMinutes: Math.max(
      0,
      Math.round((Date.now() - state.startedAtMs) / 60_000),
    ),
    breakdown: { geminiEur, mapsEur, ttsEur },
  };
}

export function resetApiUsage(): void {
  state.gemini = { requests: 0, charsIn: 0, charsOut: 0 };
  state.maps = { requests: 0, charsIn: 0, charsOut: 0 };
  state.tts = { requests: 0, charsIn: 0, charsOut: 0 };
  state.startedAtMs = Date.now();
  resetCurrentSessionUsage();
}

export { getCostOverview, finalizeCurrentSession, type CostOverview };
