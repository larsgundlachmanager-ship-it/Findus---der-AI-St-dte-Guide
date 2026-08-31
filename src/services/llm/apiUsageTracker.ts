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
  type LedgerTrackMeta,
} from '../diagnostics/apiCostLedger';
import { geminiEur, mapsEur, ttsEur } from '../diagnostics/costRates';
import { useFinnusStore } from '../../store/useFinnusStore';

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

function bump(bucket: UsageBucket, charsIn: number, charsOut: number): void {
  bucket.requests += 1;
  bucket.charsIn += Math.max(0, charsIn);
  bucket.charsOut += Math.max(0, charsOut);
}

export function trackGeminiUsage(
  charsIn: number,
  charsOut: number,
  meta?: LedgerTrackMeta,
): void {
  bump(state.gemini, charsIn, charsOut);
  trackLedgerGemini(charsIn, charsOut, meta);
}

export function trackMapsUsage(label = 'maps'): void {
  bump(state.maps, label.length, 0);
  let module: import('../diagnostics/costRates').CostModuleId = 'maps';
  try {
    if (useFinnusStore.getState().navActive) module = 'nav';
  } catch {
    /* store may be unavailable in tests */
  }
  trackLedgerMaps(label, module);
}

export function trackTtsUsage(
  chars: number,
  cloud = false,
  meta?: LedgerTrackMeta,
): void {
  if (!cloud) {
    bump(state.tts, chars, 0);
    return;
  }
  bump(state.tts, chars, chars);
  trackLedgerTts(chars, true, meta);
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
  const geminiEurVal = geminiEur(
    state.gemini.charsIn,
    state.gemini.charsOut,
    'conservative',
  );
  const mapsEurVal = mapsEur(state.maps.requests, 'conservative');
  const ttsEurVal = ttsEur(state.tts.charsOut, 'conservative');
  return {
    geminiRequests: state.gemini.requests,
    geminiCharsIn: state.gemini.charsIn,
    geminiCharsOut: state.gemini.charsOut,
    mapsRequests: state.maps.requests,
    ttsRequests: state.tts.requests,
    ttsChars: state.tts.charsOut,
    estimatedEur: geminiEurVal + mapsEurVal + ttsEurVal,
    sessionMinutes: Math.max(
      0,
      Math.round((Date.now() - state.startedAtMs) / 60_000),
    ),
    breakdown: {
      geminiEur: geminiEurVal,
      mapsEur: mapsEurVal,
      ttsEur: ttsEurVal,
    },
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
