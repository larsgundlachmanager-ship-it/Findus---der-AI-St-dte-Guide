/**
 * researchBudgetSec — Hybrid: Code-Floor + LLM ±2 s (RFC v2.1).
 */

import type { ManagerPace } from '../../router/types';
import { clampPace } from '../../router/paceBudget';

export type ResearchBudgetInput = {
  lane?: string | null;
  handoff?: string | null;
  needsResearch?: string | null;
  blueprintId?: string | null;
  llmResearchBudgetSec?: number | null;
};

export type ResearchBudgetResult = {
  finalSec: number;
  baseSec: number;
  bridgeTargetWords: number;
  pace: ManagerPace;
  fastDeadlineMs: number;
  call2BudgetMs: number;
};

function baseSecFromTable(opts: ResearchBudgetInput): number {
  const lane = String(opts.lane || 'chat').toLowerCase();
  const handoff = String(opts.handoff || 'none').toLowerCase();
  const nr = String(opts.needsResearch || 'quick').toLowerCase();
  const bp = String(opts.blueprintId || '').toLowerCase();

  if (lane === 'nav' || handoff === 'm3_nav') return 1;
  if (handoff === 'flight') return 8;
  if (handoff === 'reisebuero') return 6;
  if (handoff === 'm5_plan' || lane === 'plan') return 5;
  if (handoff === 'tour') return nr === 'deep' ? 7 : 6;
  if (lane === 'm1' || handoff === 'm1_poi') {
    return nr === 'deep' || nr === 'pack' ? 3 : 2;
  }
  if (lane === 'pitch' || handoff === 'pitch') {
    if (nr === 'deep') return 7;
    if (nr === 'pack') return 5;
    return 4;
  }
  if (lane === 'chat') {
    if (bp.includes('live_events') || /events|tonight|cinema/.test(bp)) {
      return nr === 'deep' ? 9 : 7;
    }
    if (nr === 'deep') return 8;
    if (nr === 'pack') return 4;
    return 2;
  }
  return 3;
}

function paceFromSec(sec: number): ManagerPace {
  if (sec <= 2) return 'instant';
  if (sec <= 5) return 'standard';
  return 'cover';
}

export function resolveResearchBudget(
  opts: ResearchBudgetInput,
): ResearchBudgetResult {
  const baseSec = baseSecFromTable(opts);
  const llm =
    typeof opts.llmResearchBudgetSec === 'number' &&
    Number.isFinite(opts.llmResearchBudgetSec)
      ? Math.round(opts.llmResearchBudgetSec)
      : baseSec;
  const delta = Math.max(-2, Math.min(2, llm - baseSec));
  const finalSec = Math.max(0, Math.min(12, baseSec + delta));
  const bridgeTargetWords = Math.round(
    Math.max(12, Math.min(48, 8 + finalSec * 2.5)),
  );
  const pace = paceFromSec(finalSec);
  const fastDeadlineMs = Math.max(1500, finalSec * 1000);
  const call2BudgetMs = finalSec * 1000;
  return {
    finalSec,
    baseSec,
    bridgeTargetWords,
    pace,
    fastDeadlineMs,
    call2BudgetMs,
  };
}

export function applyResearchBudgetToPace(
  pace: ManagerPace,
  budget: ResearchBudgetResult,
): {
  pace: ManagerPace;
  bridgeMaxWords: number;
  fastDeadlineMs: number;
} {
  const merged = clampPace(budget.pace) === 'cover' ? 'cover' : pace;
  return {
    pace: merged === 'instant' && budget.finalSec > 2 ? 'standard' : merged,
    bridgeMaxWords: budget.bridgeTargetWords,
    fastDeadlineMs: Math.max(
      merged === 'cover' ? 8000 : 1500,
      budget.fastDeadlineMs,
    ),
  };
}
