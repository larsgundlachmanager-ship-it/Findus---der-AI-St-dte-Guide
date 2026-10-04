/**
 * Speculative Manager Warmup — Partial-Text während Mic.
 * Ziel: Call-1 oft schon fertig wenn Final kommt → Bridge ohne Kaltstart-Stille.
 *
 * Sicherheit: nur near-final Partials (Δ≤24, Prefix). Langer Mid-Satz ersetzt Call-1 nicht.
 */

import { analyzeManagerTurn, enrichAnalysisWithBlueprint } from './analyzeTurn';
import type { ManagerAnalysis } from './types';
import {
  isTrivialWarmupRevision,
  warmupMatchesFinalUtterance,
} from './managerWarmupMatch';

export {
  normalizeWarmupText,
  warmupMatchesFinalUtterance,
  WARMUP_MAX_DELTA,
} from './managerWarmupMatch';

type WarmupEntry = {
  partial: string;
  startedAt: number;
  promise: Promise<ManagerAnalysis>;
  analysis: ManagerAnalysis | null;
};

let current: WarmupEntry | null = null;
/** Letzte fertige Analyze — bleibt Kandidat wenn STT noch 1–2 Tokens anhängt. */
let lastReady: WarmupEntry | null = null;

/** Früher starten: Mic-Loslassen oft <400ms nach letztem Partial. */
const STABLE_MS = 280;
const STABLE_MS_LONG = 220;
const MIN_CHARS = 10;

let lastPartial = '';
let lastChangeAt = 0;
let lastCtx: {
  cityHint?: string | null;
  navActive?: boolean;
  calendarOpen?: boolean;
} | null = null;
let stableTimer: ReturnType<typeof setTimeout> | null = null;

export function clearManagerWarmup(): void {
  current = null;
  lastReady = null;
  lastPartial = '';
  lastChangeAt = 0;
  lastCtx = null;
  if (stableTimer) {
    clearTimeout(stableTimer);
    stableTimer = null;
  }
}

function stableDelayMs(len: number): number {
  return len >= 20 ? STABLE_MS_LONG : STABLE_MS;
}

function warmThreadsAndBudget(): void {
  try {
    void import('../../services/memory/conversationThreads').then((m) =>
      m.loadConversationThreads(),
    );
  } catch {
    /* soft */
  }
  try {
    void import('../reboot/pipeline/bulletUiBudget').then((m) =>
      m.loadBulletUiBudget(),
    );
  } catch {
    /* soft */
  }
}

function startAnalyze(
  text: string,
  ctx?: { cityHint?: string | null; navActive?: boolean; calendarOpen?: boolean },
): void {
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
    if (current?.partial === text) {
      current.analysis = a;
      lastReady = current;
    }
  });
}

export function notePartialForManagerWarmup(
  partial: string,
  ctx?: { cityHint?: string | null; navActive?: boolean; calendarOpen?: boolean },
): void {
  warmThreadsAndBudget();
  const text = (partial || '').replace(/\s+/g, ' ').trim();
  if (text.length < MIN_CHARS) return;
  if (ctx) lastCtx = ctx;
  if (text !== lastPartial) {
    lastPartial = text;
    lastChangeAt = Date.now();
  }
  if (current?.analysis && isTrivialWarmupRevision(current.partial, text)) {
    current.partial = text;
    lastReady = current;
    return;
  }
  if (lastReady?.analysis && isTrivialWarmupRevision(lastReady.partial, text)) {
    lastReady = { ...lastReady, partial: text };
    return;
  }
  if (stableTimer) clearTimeout(stableTimer);
  const delay = stableDelayMs(text.length);
  stableTimer = setTimeout(() => {
    if (Date.now() - lastChangeAt < delay - 50) return;
    if (current?.partial === text && current.analysis) return;
    if (current?.analysis && isTrivialWarmupRevision(current.partial, text)) {
      current.partial = text;
      lastReady = current;
      return;
    }
    startAnalyze(text, lastCtx ?? ctx);
  }, delay);
}

function pickMatchingEntry(finalText: string): WarmupEntry | null {
  const candidates: WarmupEntry[] = [];
  if (current) candidates.push(current);
  if (lastReady && lastReady !== current) candidates.push(lastReady);
  for (const entry of candidates) {
    if (warmupMatchesFinalUtterance(entry.partial, finalText)) return entry;
  }
  return null;
}

/**
 * Final-Text bekannt (Turn-Start): Analyze sofort parallel zu Rucksack/Gold/Threads.
 * Deckt den Fall Mic-los vor STABLE_MS.
 */
export function kickManagerWarmupForFinal(
  finalText: string,
  ctx?: { cityHint?: string | null; navActive?: boolean; calendarOpen?: boolean },
): void {
  const text = (finalText || '').replace(/\s+/g, ' ').trim();
  if (text.length < MIN_CHARS) return;
  if (ctx) lastCtx = ctx;
  if (stableTimer) {
    clearTimeout(stableTimer);
    stableTimer = null;
  }
  if (pickMatchingEntry(text)) {
    lastPartial = text;
    return;
  }
  if (current?.analysis && isTrivialWarmupRevision(current.partial, text)) {
    current.partial = text;
    lastReady = current;
    lastPartial = text;
    return;
  }
  if (lastReady?.analysis && isTrivialWarmupRevision(lastReady.partial, text)) {
    lastReady = { ...lastReady, partial: text };
    lastPartial = text;
    return;
  }
  lastPartial = text;
  lastChangeAt = Date.now();
  startAnalyze(text, lastCtx ?? ctx);
}

/** If warmup matches final text, reuse; else null. */
export async function takeManagerWarmupIfMatch(
  finalText: string,
): Promise<ManagerAnalysis | null> {
  if (stableTimer) {
    clearTimeout(stableTimer);
    stableTimer = null;
  }
  const entry = pickMatchingEntry(finalText);
  current = null;
  lastReady = null;
  lastPartial = '';
  lastChangeAt = 0;

  if (!entry) return null;
  try {
    return entry.analysis ?? (await entry.promise);
  } catch {
    return null;
  }
}
