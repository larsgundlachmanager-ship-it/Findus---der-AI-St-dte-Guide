/**
 * Speculative Manager Warmup — Partial-Text während Mic.
 */

import { analyzeManagerTurn, enrichAnalysisWithBlueprint } from './analyzeTurn';
import type { ManagerAnalysis } from './types';

type WarmupEntry = {
  partial: string;
  startedAt: number;
  promise: Promise<ManagerAnalysis>;
  analysis: ManagerAnalysis | null;
};

let current: WarmupEntry | null = null;
const STABLE_MS = 400;
const MIN_CHARS = 12;
let lastPartial = '';
let lastChangeAt = 0;
let stableTimer: ReturnType<typeof setTimeout> | null = null;

export function clearManagerWarmup(): void {
  current = null;
  lastPartial = '';
  lastChangeAt = 0;
  if (stableTimer) {
    clearTimeout(stableTimer);
    stableTimer = null;
  }
}

export function notePartialForManagerWarmup(
  partial: string,
  ctx?: { cityHint?: string | null; navActive?: boolean; calendarOpen?: boolean },
): void {
  const text = (partial || '').replace(/\s+/g, ' ').trim();
  if (text.length < MIN_CHARS) return;
  if (text !== lastPartial) {
    lastPartial = text;
    lastChangeAt = Date.now();
  }
  if (stableTimer) clearTimeout(stableTimer);
  stableTimer = setTimeout(() => {
    if (Date.now() - lastChangeAt < STABLE_MS - 50) return;
    if (current?.partial === text && current.analysis) return;
    const promise = analyzeManagerTurn({
      userText: text,
      cityHint: ctx?.cityHint,
      navActive: ctx?.navActive,
      calendarOpen: ctx?.calendarOpen,
      speculative: true,
    }).then(enrichAnalysisWithBlueprint);
    current = {
      partial: text,
      startedAt: Date.now(),
      promise,
      analysis: null,
    };
    void promise.then((a) => {
      if (current?.partial === text) current.analysis = a;
    });
  }, STABLE_MS);
}

function similarEnough(a: string, b: string): boolean {
  const na = a.toLowerCase().replace(/\s+/g, ' ').trim();
  const nb = b.toLowerCase().replace(/\s+/g, ' ').trim();
  if (na === nb) return true;
  if (na.length < 8 || nb.length < 8) return false;
  // Final is extension of partial or vice versa
  if (na.startsWith(nb.slice(0, Math.min(40, nb.length))) || nb.startsWith(na.slice(0, Math.min(40, na.length)))) {
    const shorter = na.length < nb.length ? na : nb;
    const longer = na.length >= nb.length ? na : nb;
    return longer.includes(shorter.slice(0, Math.max(12, shorter.length - 8)));
  }
  return false;
}

/** If warmup matches final text, reuse; else null. */
export async function takeManagerWarmupIfMatch(
  finalText: string,
): Promise<ManagerAnalysis | null> {
  const entry = current;
  current = null;
  if (!entry) return null;
  if (!similarEnough(entry.partial, finalText)) return null;
  try {
    return entry.analysis ?? (await entry.promise);
  } catch {
    return null;
  }
}
