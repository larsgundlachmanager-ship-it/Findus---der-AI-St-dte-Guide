/**
 * Early / route M5 handoffs — aus runConciergeTurn ausgelagert (inkrementell).
 */

import { synthesizeOutput } from '../../pipeline/synthesis';
import type { LogicNodeOutput, PipelineTurnResult } from '../../types';

function emptyM5Result(turnId: string): PipelineTurnResult {
  const logic: LogicNodeOutput = {
    spokenDraft: '',
    bullets: [],
    buttons: [],
    moneyEur: [],
    warnings: [],
  };
  return {
    turnId,
    tasks: [],
    bridgingText: null,
    logic,
    synthesis: synthesizeOutput(logic),
    deepResearchQueued: false,
    jobId: 'day_plan_budget',
  };
}

/**
 * Vor Manager-LLM: Tour gewinnt vor M5; sonst Force-M5 → Planning.
 */
export async function tryEarlyM5Handoff(opts: {
  rewritten: string;
  turnId: string;
}): Promise<PipelineTurnResult | null> {
  try {
    const { shouldHandoffToTourModule } = await import(
      '../../tour/shouldHandoffTour'
    );
    const { shouldForceModul5Handoff } = await import(
      '../../planning/planHandoffGuard'
    );
    const tourFirst = shouldHandoffToTourModule(opts.rewritten);
    if (!tourFirst && shouldForceModul5Handoff(opts.rewritten)) {
      if (__DEV__) {
        console.log(
          '[m5] force handoff → runPlanningModule',
          opts.rewritten.slice(0, 100),
        );
      }
      const { runPlanningModule } = await import(
        '../../planning/runPlanningModule'
      );
      await runPlanningModule({
        userText: opts.rewritten,
        turnId: opts.turnId,
      });
      return emptyM5Result(opts.turnId);
    }
    if (tourFirst && __DEV__) {
      console.log('[tour] skip early m5 — tour handoff pending');
    }
  } catch (err) {
    console.warn('[m5] early handoff failed', err);
  }
  return null;
}

/** Manager-Route m5_plan — Tour kann noch gewinnen. */
export async function tryM5PlanRouteHandoff(opts: {
  rewritten: string;
  turnId: string;
}): Promise<PipelineTurnResult | null> {
  try {
    const { shouldHandoffToTourModule } = await import(
      '../../tour/shouldHandoffTour'
    );
    if (shouldHandoffToTourModule(opts.rewritten)) {
      if (__DEV__) console.log('[m5] skip m5_plan handoff — tour wins');
      return null;
    }
    const { runPlanningModule } = await import(
      '../../planning/runPlanningModule'
    );
    await runPlanningModule({
      userText: opts.rewritten,
      turnId: opts.turnId,
    });
    return emptyM5Result(opts.turnId);
  } catch {
    return null;
  }
}
