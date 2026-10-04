/**
 * Laufzeit-Controller: glatter Fortschritt + ETA während Funnel.
 */

import { useReisebueroStore } from '../store';
import {
  adjustRateMul,
  budgetProgressCeiling,
  buildProgressPlan,
  etaMinutesRemaining,
  normalizeTheaterStage,
  railAlignedProgress,
  RESEARCH_HARD_CAP_MS,
  RESEARCH_STATUS_RAIL,
  stepDisplayProgress,
  type ProgressPlan,
  type StageBudget,
} from './progressPace';
import { getResolvedStageMs, recordStageDuration, warmProgressLearning } from './progressLearning';

type Session = {
  path: string;
  plan: ProgressPlan;
  display: number;
  rateMul: number;
  currentStage: string | null;
  stageStartedAt: number | null;
  sessionStartedAt: number;
  lastTickAt: number;
  finishedStages: Set<string>;
  timer: ReturnType<typeof setInterval> | null;
  finishTimer: ReturnType<typeof setInterval> | null;
};

let session: Session | null = null;

function etaForSession(now = Date.now()): number {
  if (!session) return 0;
  const elapsed =
    session.currentStage && session.stageStartedAt != null
      ? now - session.stageStartedAt
      : 0;
  return etaMinutesRemaining({
    budgets: session.plan.budgets,
    finishedStages: session.finishedStages,
    currentStage: session.currentStage,
    elapsedInStageMs: elapsed,
    rateMul: session.rateMul,
    sessionElapsedMs: now - session.sessionStartedAt,
  });
}

function publish(display: number, etaMin: number | null): void {
  const store = useReisebueroStore.getState();
  store.setThinking(true, Math.max(0.02, Math.min(0.97, display)));
  store.setResearchEtaMin(etaMin);
}

function budgetFor(stage: string | null): StageBudget | null {
  if (!session || !stage) return null;
  return session.plan.budgets.find((b) => b.stage === stage) || null;
}

/** Ziel-%: min(Rail-Checkliste, Budget-Decke) — kein Zeit-Creep auf 94 %. */
function computeTarget(now: number): number {
  if (!session) return 0.02;
  const elapsed =
    session.currentStage && session.stageStartedAt != null
      ? now - session.stageStartedAt
      : 0;
  const curBudget = budgetFor(session.currentStage);
  if (curBudget && session.stageStartedAt != null) {
    const late = elapsed > curBudget.budgetMs * 1.15;
    session.rateMul = adjustRateMul({
      rateMul: session.rateMul,
      stageEarly: false,
      stageLate: late,
    });
  }
  const rail = railAlignedProgress({
    stageOrder: session.plan.budgets.map((b) => b.stage),
    finishedStages: session.finishedStages,
    currentStage: session.currentStage,
    elapsedInStageMs: elapsed,
    currentBudgetMs: curBudget?.budgetMs ?? 20_000,
  });
  const ceiling = budgetProgressCeiling({
    budgets: session.plan.budgets,
    finishedStages: session.finishedStages,
    currentStage: session.currentStage,
    elapsedInStageMs: elapsed,
    rateMul: session.rateMul,
  });
  // Rail entscheidet fürs Auge; Budget-Decke verhindert Sprünge über den Plan
  return Math.max(0.02, Math.min(rail, ceiling, 0.97));
}

function tick(): void {
  if (!session) return;
  const now = Date.now();
  const dt = Math.max(50, Math.min(800, now - session.lastTickAt));
  session.lastTickAt = now;

  const target = computeTarget(now);
  // Soft nachziehen — auch nach unten, wenn alter Creep zu hoch war
  session.display = stepDisplayProgress(session.display, target, dt, 0.14);
  session.display = Math.min(session.display, Math.max(target, 0.02));
  publish(session.display, etaForSession(now));
}

export function startResearchProgress(opts?: { path?: string | null; stages?: string[] }): void {
  stopResearchProgress({ complete: false });
  void warmProgressLearning();
  const path = opts?.path || 'default';
  const stages =
    opts?.stages?.length
      ? opts.stages
      : RESEARCH_STATUS_RAIL.map((r) => r.stage);
  const plan = buildProgressPlan(stages, (stage) => getResolvedStageMs(path, stage));
  const now = Date.now();
  session = {
    path,
    plan,
    display: 0.03,
    rateMul: 1,
    currentStage: stages[0] || 'brief_plan',
    stageStartedAt: now,
    sessionStartedAt: now,
    lastTickAt: now,
    finishedStages: new Set(),
    timer: setInterval(tick, 280),
    finishTimer: null,
  };
  publish(0.03, etaForSession(now));
}

export function onResearchStageActive(stageRaw: string): void {
  if (!session) return;
  const stage = normalizeTheaterStage(stageRaw);
  if (session.finishedStages.has(stage)) {
    // fertige Stage nicht wieder öffnen (Legacy-Alias nach Closers)
    return;
  }
  if (session.currentStage === stage && session.stageStartedAt != null) {
    return;
  }
  session.currentStage = stage;
  session.stageStartedAt = Date.now();
  tick();
}

export function onResearchStageDone(stageRaw: string): void {
  if (!session) return;
  const stage = normalizeTheaterStage(stageRaw);
  const started = session.stageStartedAt;
  const budget = budgetFor(stage);
  const wasCurrent = session.currentStage === stage;
  if (started != null && wasCurrent) {
    const dur = Date.now() - started;
    void recordStageDuration({ path: session.path, stage, durationMs: dur });
    if (budget) {
      const early = dur < budget.budgetMs * 0.7;
      const late = dur > budget.budgetMs * 1.25;
      session.rateMul = adjustRateMul({
        rateMul: session.rateMul,
        stageEarly: early,
        stageLate: late,
      });
      if (late && session.rateMul < 1) {
        for (const b of session.plan.budgets) {
          if (!session.finishedStages.has(b.stage) && b.stage !== stage) {
            const stretch = Math.max(1.08, 1 / Math.max(0.55, session.rateMul));
            b.budgetMs = Math.round(b.budgetMs * stretch);
          }
        }
        // Nie über die 15-Min-Wanduhr hinaus planen
        const sum = session.plan.budgets.reduce((s, b) => s + b.budgetMs, 0);
        if (sum > RESEARCH_HARD_CAP_MS) {
          const scale = RESEARCH_HARD_CAP_MS / sum;
          for (const b of session.plan.budgets) {
            b.budgetMs = Math.max(2_000, Math.round(b.budgetMs * scale));
          }
        }
        session.plan.totalMs = Math.min(
          RESEARCH_HARD_CAP_MS,
          session.plan.budgets.reduce((s, b) => s + b.budgetMs, 0),
        );
      }
    }
  }
  session.finishedStages.add(stage);
  if (wasCurrent) {
    session.stageStartedAt = null;
    session.currentStage = null;
  }
  // Display folgt Rail in tick() — kein Jump auf Budget-endFrac
  tick();
}

export function stopResearchProgress(opts?: { complete?: boolean }): void {
  const prev = session;
  if (prev?.timer) clearInterval(prev.timer);
  if (prev?.finishTimer) clearInterval(prev.finishTimer);
  session = null;
  const complete = opts?.complete === true;
  if (!complete) {
    useReisebueroStore.getState().setResearchEtaMin(null);
    return;
  }
  const start = prev?.display ?? useReisebueroStore.getState().trip.verifyProgress ?? 0.85;
  const t0 = Date.now();
  const fin = setInterval(() => {
    const t = (Date.now() - t0) / 1200;
    const p = Math.min(1, start + (1 - start) * Math.min(1, t));
    useReisebueroStore.getState().setThinking(true, p);
    useReisebueroStore.getState().setResearchEtaMin(t >= 1 ? 0 : 1);
    if (t >= 1) {
      clearInterval(fin);
      useReisebueroStore.getState().setResearchEtaMin(null);
    }
  }, 80);
}

export function getResearchProgressSnapshot(): {
  display: number;
  etaMin: number | null;
  totalMs: number;
} | null {
  if (!session) return null;
  return {
    display: session.display,
    etaMin: etaForSession(),
    totalMs: session.plan.totalMs,
  };
}
