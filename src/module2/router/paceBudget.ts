/**
 * Bridge-Wörter ↔ Fast-Deadline — SSOT Pace-Tabelle (Plan).
 */

import type { ManagerPace } from './types';

export const PACE_TABLE: Record<
  ManagerPace,
  { bridgeMaxWords: number; fastDeadlineMs: number; synthBudgetMs: number }
> = {
  instant: { bridgeMaxWords: 10, fastDeadlineMs: 1500, synthBudgetMs: 1000 },
  /** Chat-first: Bridge spätestens ~1,5 s */
  standard: { bridgeMaxWords: 14, fastDeadlineMs: 1500, synthBudgetMs: 1400 },
  /** 2–3 Sätze (~14s bei 2.5 wps) — Recherche parallel, Haupt-Speech hängt an. */
  cover: { bridgeMaxWords: 36, fastDeadlineMs: 8000, synthBudgetMs: 1600 },
};

/** Default DE TTS estimate; device calibration may override. */
let wordsPerSec = 2.5;

export function setCalibratedWordsPerSec(wps: number): void {
  if (Number.isFinite(wps) && wps >= 1.5 && wps <= 4.5) {
    wordsPerSec = wps;
  }
}

export function getWordsPerSec(): number {
  return wordsPerSec;
}

export function estimateBridgeMs(wordCount: number): number {
  return Math.round((Math.max(1, wordCount) / wordsPerSec) * 1000);
}

export function clampPace(raw: unknown): ManagerPace {
  const s = String(raw || '').toLowerCase();
  if (s === 'instant' || s === 'cover') return s;
  return 'standard';
}

export function resolvePaceBudget(opts: {
  pace?: unknown;
  bridgeMaxWords?: unknown;
  fastDeadlineMs?: unknown;
}): {
  pace: ManagerPace;
  bridgeMaxWords: number;
  fastDeadlineMs: number;
  synthBudgetMs: number;
} {
  const pace = clampPace(opts.pace);
  const base = PACE_TABLE[pace];
  let bridgeMaxWords = base.bridgeMaxWords;
  if (typeof opts.bridgeMaxWords === 'number' && Number.isFinite(opts.bridgeMaxWords)) {
    bridgeMaxWords = Math.min(42, Math.max(6, Math.round(opts.bridgeMaxWords)));
  }
  let fastDeadlineMs = base.fastDeadlineMs;
  if (typeof opts.fastDeadlineMs === 'number' && Number.isFinite(opts.fastDeadlineMs)) {
    // Whitelist clamp — never wild 30s in fast
    const allowed = [1000, 1200, 1500, 2000, 2500, 3500, 4500, 5000, 6000, 8000];
    const want = Math.round(opts.fastDeadlineMs);
    fastDeadlineMs = allowed.reduce((best, n) =>
      Math.abs(n - want) < Math.abs(best - want) ? n : best,
    );
    // Pace cover may use higher; instant/standard capped at 1.5s bridge deadline
    if (pace === 'instant') fastDeadlineMs = Math.min(fastDeadlineMs, 1500);
    if (pace === 'standard') fastDeadlineMs = Math.min(fastDeadlineMs, 1500);
  }
  return {
    pace,
    bridgeMaxWords,
    fastDeadlineMs,
    synthBudgetMs: base.synthBudgetMs,
  };
}

export function clipBridgeToWordLimit(
  text: string | null | undefined,
  maxWords: number,
): string | null {
  if (!(maxWords > 0)) return null;
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const words = t.split(/\s+/);
  if (words.length <= maxWords) return t;
  let cut = words.slice(0, maxWords).join(' ');
  if (!/[.!?…]$/.test(cut)) cut = `${cut}.`;
  return cut;
}

/** Record bridge TTS duration for calibration (call from speech layer). */
export function noteBridgeCalibration(wordCount: number, elapsedMs: number): void {
  if (wordCount < 4 || elapsedMs < 800) return;
  const measured = wordCount / (elapsedMs / 1000);
  // EMA toward measured
  wordsPerSec = wordsPerSec * 0.7 + measured * 0.3;
  if (wordsPerSec < 1.8) wordsPerSec = 1.8;
  if (wordsPerSec > 3.5) wordsPerSec = 3.5;
}
