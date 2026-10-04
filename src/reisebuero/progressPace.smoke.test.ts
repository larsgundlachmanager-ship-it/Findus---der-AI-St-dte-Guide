/**
 * Smoke: Akt-3 Pace-Mathematik (ohne RN/Netzwerk).
 */
import {
  adjustRateMul,
  blendStageMs,
  buildProgressPlan,
  DEFAULT_STAGE_MS,
  etaMinutesFromMs,
  etaMinutesRemaining,
  etaMsRemaining,
  ewmaUpdate,
  railAlignedProgress,
  RESEARCH_HARD_CAP_MS,
  RESEARCH_STATUS_RAIL,
  ETA_PAD,
  stageKey,
  stepDisplayProgress,
  targetProgressInStage,
} from './research/progressPace';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(RESEARCH_STATUS_RAIL.length >= 8, 'rail length');
assert(
  RESEARCH_STATUS_RAIL.every((r, i, arr) => arr.findIndex((x) => x.stage === r.stage) === i),
  'rail unique stages',
);
const titles = RESEARCH_STATUS_RAIL.map((r) => r.title);
assert(new Set(titles).size === titles.length, 'rail unique titles');

const plan = buildProgressPlan(
  RESEARCH_STATUS_RAIL.map((r) => r.stage),
  (s) => DEFAULT_STAGE_MS[s] ?? 10_000,
);
assert(plan.totalMs > 60_000, `totalMs ${plan.totalMs}`);
assert(plan.totalMs <= RESEARCH_HARD_CAP_MS, `plan under hard cap ${plan.totalMs}`);
assert(
  Math.round(plan.totalMs * ETA_PAD) <= RESEARCH_HARD_CAP_MS,
  `ETA pad under 15 Min ${Math.round(plan.totalMs * ETA_PAD)}`,
);
assert(RESEARCH_HARD_CAP_MS === 15 * 60_000, 'hard cap is 15 min');
{
  const wallEta = etaMsRemaining({
    budgets: plan.budgets,
    finishedStages: [],
    currentStage: plan.budgets[0]!.stage,
    elapsedInStageMs: 0,
    rateMul: 1,
    sessionElapsedMs: RESEARCH_HARD_CAP_MS - 30_000,
  });
  assert(wallEta <= 30_000, `wall cap ETA ${wallEta}`);
}
assert(plan.budgets[0]!.startFrac === 0, 'first starts at 0');
assert(plan.budgets[plan.budgets.length - 1]!.endFrac <= 0.97, 'cap under 1');
for (let i = 1; i < plan.budgets.length; i++) {
  assert(
    plan.budgets[i]!.startFrac >= plan.budgets[i - 1]!.startFrac,
    'monotonic startFrac',
  );
}

const bStay = plan.budgets.find((b) => b.stage === 'stay_tracks')!;
assert(bStay, 'stay_tracks budget');
const early = targetProgressInStage({
  budget: bStay,
  elapsedInStageMs: 200,
  rateMul: 1,
  stageDone: false,
});
const mid = targetProgressInStage({
  budget: bStay,
  elapsedInStageMs: bStay.budgetMs * 0.5,
  rateMul: 1,
  stageDone: false,
});
const late = targetProgressInStage({
  budget: bStay,
  elapsedInStageMs: bStay.budgetMs * 3,
  rateMul: 1,
  stageDone: false,
});
assert(early < mid && mid < late, 'stage progress increases');
assert(late < bStay.endFrac, 'soft ceiling before done');
assert(
  targetProgressInStage({
    budget: bStay,
    elapsedInStageMs: 0,
    rateMul: 1,
    stageDone: true,
  }) === bStay.endFrac,
  'done → endFrac',
);

let p = 0.1;
p = stepDisplayProgress(p, 0.9, 250, 0.12);
assert(p > 0.1 && p < 0.2, `soft step ${p}`);
p = stepDisplayProgress(0.5, 0.4, 250, 0.12);
assert(p < 0.5 && p > 0.45, 'soft downclamp');

const eta = etaMinutesRemaining({
  budgets: plan.budgets,
  finishedStages: [],
  currentStage: plan.budgets[0]!.stage,
  elapsedInStageMs: 0,
  rateMul: 1,
});
assert(eta >= 10, `eta start realistic ${eta}`);

const etaMid = etaMinutesRemaining({
  budgets: plan.budgets,
  finishedStages: plan.budgets.slice(0, 3).map((b) => b.stage),
  currentStage: plan.budgets[3]!.stage,
  elapsedInStageMs: plan.budgets[3]!.budgetMs * 0.5,
  rateMul: 1,
});
assert(etaMid < eta, `eta drops after steps ${etaMid} < ${eta}`);

const etaAlmost = etaMinutesRemaining({
  budgets: plan.budgets,
  finishedStages: plan.budgets.slice(0, -1).map((b) => b.stage),
  currentStage: plan.budgets[plan.budgets.length - 1]!.stage,
  elapsedInStageMs: plan.budgets[plan.budgets.length - 1]!.budgetMs,
  rateMul: 1,
});
assert(etaAlmost <= 1, `eta near end ${etaAlmost}`);

assert(etaMinutesFromMs(5_000) === 0, 'sub-20s → 0');
assert(etaMsRemaining({
  budgets: plan.budgets,
  finishedStages: plan.budgets.map((b) => b.stage),
  currentStage: null,
  elapsedInStageMs: 0,
  rateMul: 1,
}) === 0, 'all done → 0ms');

assert(ewmaUpdate(null, 10_000) === 10_000, 'ewma seed');
assert(ewmaUpdate(10_000, 20_000) > 10_000 && ewmaUpdate(10_000, 20_000) < 20_000, 'ewma blend');

let mul = 1;
mul = adjustRateMul({ rateMul: mul, stageEarly: true, stageLate: false });
assert(mul > 1, 'early speeds');
mul = adjustRateMul({ rateMul: 1, stageEarly: false, stageLate: true });
assert(mul < 1, 'late slows');

assert(stageKey('Flight First', 'stay') === 'flight_first::stay', 'stageKey');

const seedOnly = blendStageMs('discover', null, null, 0);
assert(seedOnly === DEFAULT_STAGE_MS.discover, `seed ${seedOnly}`);
const blended = blendStageMs('discover', null, 200_000, 40);
assert(blended > DEFAULT_STAGE_MS.discover!, `crowd pulls up ${blended}`);
assert(blended < 200_000, `still blended ${blended}`);
const localBlend = blendStageMs('stay', 300_000, 400_000, 50);
assert(localBlend > 240_000 && localBlend < 400_000, `blendStageMs ${localBlend}`);

const stages = RESEARCH_STATUS_RAIL.map((r) => r.stage);
const halfOpen = railAlignedProgress({
  stageOrder: stages,
  finishedStages: stages.slice(0, 3),
  currentStage: stages[3]!,
  elapsedInStageMs: 5_000,
  currentBudgetMs: 60_000,
});
assert(halfOpen < 0.5, `rail half-open not 94% (${halfOpen})`);
const almostDone = railAlignedProgress({
  stageOrder: stages,
  finishedStages: stages.slice(0, 9),
  currentStage: stages[9]!,
  elapsedInStageMs: 80_000,
  currentBudgetMs: 90_000,
});
assert(almostDone > 0.85 && almostDone < 0.98, `rail near end ${almostDone}`);

console.log('progressPace.smoke.test.ts OK');
