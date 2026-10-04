/**
 * Pure Pace-Mathematik für Akt-3 Fortschrittsbalken.
 * Priors + EWMA → Plan; Soft-Catchup ohne Sprünge.
 */

import {
  THEATER_STATUS_RAIL,
  THEATER_STAGE_MS,
  normalizeTheaterStage,
} from './theaterStages';

export {
  normalizeTheaterStage,
  canFinishTheaterStage,
  theaterStageIndex,
  THEATER_STATUS_RAIL,
} from './theaterStages';

/** Theater-Checkliste offen→eng (Masterplan). */
export const RESEARCH_STATUS_RAIL = THEATER_STATUS_RAIL;

export type RailStage = (typeof RESEARCH_STATUS_RAIL)[number]['stage'];

/** Harte Wanduhr-Grenze — Funnel + ETA dürfen das nicht überschreiten. */
export const RESEARCH_HARD_CAP_MS = 15 * 60_000;

/**
 * Seed-Priors (ms) — Summe bewusst unter HARD_CAP / ETA_PAD,
 * damit die Anzeige bei Start schon ≤ ~15 Min liegt.
 */
export const DEFAULT_STAGE_MS: Record<string, number> = { ...THEATER_STAGE_MS };

/** ETA nie unterversprechen: Rest × Pad (API-Jitter / QA-Runden). */
export const ETA_PAD = 1.15;

export type StageBudget = {
  stage: string;
  budgetMs: number;
  startFrac: number;
  endFrac: number;
};

export type ProgressPlan = {
  totalMs: number;
  budgets: StageBudget[];
};

const DISPLAY_CAP = 0.97;

export function blendStageMs(
  stage: string,
  localEwma: number | null | undefined,
  crowdEwma: number | null | undefined,
  crowdSamples = 0,
): number {
  const seed = DEFAULT_STAGE_MS[stage] ?? 20_000;
  let ms = seed;
  if (typeof crowdEwma === 'number' && crowdEwma > 0 && crowdSamples > 0) {
    const w = Math.min(0.85, 0.25 + crowdSamples / 40);
    ms = ms * (1 - w) + crowdEwma * w;
  }
  if (typeof localEwma === 'number' && localEwma > 0) {
    ms = ms * 0.35 + localEwma * 0.65;
  }
  return Math.max(2_000, Math.min(900_000, Math.round(ms)));
}

export function buildProgressPlan(
  stages: string[],
  resolveMs: (stage: string) => number,
): ProgressPlan {
  const uniq = [...new Set(stages.filter(Boolean))];
  const list = uniq.length ? uniq : RESEARCH_STATUS_RAIL.map((r) => r.stage);
  let budgetsRaw = list.map((stage) => ({
    stage,
    budgetMs: resolveMs(stage),
  }));
  // Plan-Summe so skalieren, dass ETA_PAD × total ≤ HARD_CAP
  const rawSum = budgetsRaw.reduce((s, b) => s + b.budgetMs, 0);
  const maxPlan = Math.floor(RESEARCH_HARD_CAP_MS / ETA_PAD);
  if (rawSum > maxPlan && rawSum > 0) {
    const scale = maxPlan / rawSum;
    budgetsRaw = budgetsRaw.map((b) => ({
      ...b,
      budgetMs: Math.max(2_000, Math.round(b.budgetMs * scale)),
    }));
  }
  const totalMs = Math.max(
    8_000,
    Math.min(
      maxPlan,
      budgetsRaw.reduce((s, b) => s + b.budgetMs, 0),
    ),
  );
  let acc = 0;
  const budgets: StageBudget[] = budgetsRaw.map((b) => {
    const startFrac = (acc / totalMs) * DISPLAY_CAP;
    acc += b.budgetMs;
    const endFrac = (acc / totalMs) * DISPLAY_CAP;
    return { stage: b.stage, budgetMs: b.budgetMs, startFrac, endFrac };
  });
  return { totalMs, budgets };
}

/** Sanfte Annäherung an Target — max Δ pro Tick. */
export function stepDisplayProgress(
  current: number,
  target: number,
  dtMs: number,
  maxPerSec = 0.12,
): number {
  const maxStep = maxPerSec * (dtMs / 1000);
  const delta = target - current;
  const stepped = current + Math.max(-maxStep, Math.min(maxStep, delta));
  return Math.max(0, Math.min(1, stepped));
}

/**
 * Ziel-Progress innerhalb der aktuellen Stage (Budget-Anteil am Plan).
 * Soft-Ceiling bis Stage fertig; Catchup über rateMul.
 */
export function targetProgressInStage(opts: {
  budget: StageBudget;
  elapsedInStageMs: number;
  rateMul: number;
  stageDone: boolean;
}): number {
  const { budget, elapsedInStageMs, rateMul, stageDone } = opts;
  if (stageDone) return budget.endFrac;
  const span = Math.max(0.01, budget.endFrac - budget.startFrac);
  const raw = elapsedInStageMs / Math.max(800, budget.budgetMs / Math.max(0.35, rateMul));
  // Nie die Stage-Grenze erreichen, bevor finish — asymptotisch 92% der Stage
  const within = span * (1 - Math.exp(-Math.max(0, raw) * 1.15)) * 0.92;
  return Math.min(budget.endFrac - 0.008, budget.startFrac + within);
}

/**
 * Balken-% an Checkliste koppeln: fertige Steps + Teil des aktiven.
 * Verhindert „94 %“ bei halb offener Rail (kein Wall-Clock-Creep).
 */
export function railAlignedProgress(opts: {
  stageOrder: string[];
  finishedStages: Iterable<string>;
  currentStage: string | null;
  elapsedInStageMs: number;
  currentBudgetMs: number;
}): number {
  const order = opts.stageOrder.filter(Boolean);
  const n = Math.max(1, order.length);
  const finished = opts.finishedStages instanceof Set
    ? opts.finishedStages
    : new Set(opts.finishedStages);
  let done = 0;
  for (const s of order) {
    if (finished.has(s)) done += 1;
  }
  let partial = 0;
  if (opts.currentStage && !finished.has(opts.currentStage)) {
    const raw =
      opts.elapsedInStageMs / Math.max(1_200, opts.currentBudgetMs);
    partial = Math.min(0.88, 1 - Math.exp(-Math.max(0, raw) * 1.05));
  }
  return Math.min(DISPLAY_CAP, (done + partial) / n);
}

/**
 * Harte Decke: nie über den Budget-End-Anteil der aktuellen (bzw. letzten fertigen) Stage.
 */
export function budgetProgressCeiling(opts: {
  budgets: StageBudget[];
  finishedStages: Iterable<string>;
  currentStage: string | null;
  elapsedInStageMs: number;
  rateMul: number;
}): number {
  const finished = opts.finishedStages instanceof Set
    ? opts.finishedStages
    : new Set(opts.finishedStages);
  let maxDone = 0;
  for (const b of opts.budgets) {
    if (finished.has(b.stage)) maxDone = Math.max(maxDone, b.endFrac);
  }
  const cur = opts.currentStage
    ? opts.budgets.find((b) => b.stage === opts.currentStage)
    : null;
  if (cur && !finished.has(cur.stage)) {
    return Math.max(
      maxDone,
      targetProgressInStage({
        budget: cur,
        elapsedInStageMs: opts.elapsedInStageMs,
        rateMul: opts.rateMul,
        stageDone: false,
      }),
    );
  }
  return Math.min(DISPLAY_CAP, Math.max(maxDone, 0.02));
}

/**
 * Restzeit aus Stage-Budgets (nicht aus Display-% — der hinkt Soft-Catchup hinterher).
 * Aktueller Schritt: Budget − bisher; danach alle noch nicht fertigen Steps.
 * rateMul > 1 verkürzt die ETA nicht (lieber etwas länger ansagen).
 */
export function etaMsRemaining(opts: {
  budgets: StageBudget[];
  finishedStages: Iterable<string>;
  currentStage: string | null;
  elapsedInStageMs: number;
  rateMul: number;
  /** Session-Wanduhr seit Start — capped gegen HARD_CAP. */
  sessionElapsedMs?: number;
}): number {
  const finished = opts.finishedStages instanceof Set
    ? opts.finishedStages
    : new Set(opts.finishedStages);
  // Nur verlangsamen wenn late — early darf ETA nicht nach unten ziehen
  const slow = Math.min(1, Math.max(0.4, opts.rateMul));
  let left = 0;
  for (const b of opts.budgets) {
    if (finished.has(b.stage)) continue;
    if (opts.currentStage && b.stage === opts.currentStage) {
      const elapsed = Math.max(0, opts.elapsedInStageMs);
      let rem: number;
      if (elapsed <= b.budgetMs) {
        rem = b.budgetMs - elapsed;
      } else {
        // Overtime: begrenzt, nicht endlos wachsen
        rem = b.budgetMs * 0.12;
      }
      left += rem / slow;
    } else {
      left += b.budgetMs / slow;
    }
  }
  let ms = Math.max(0, Math.round(left * ETA_PAD));
  if (typeof opts.sessionElapsedMs === 'number' && opts.sessionElapsedMs >= 0) {
    const wallLeft = Math.max(0, RESEARCH_HARD_CAP_MS - opts.sessionElapsedMs);
    ms = Math.min(ms, wallLeft);
  }
  return ms;
}

/** Minuten für UI — &lt; ~25 s → 0 („gleich fertig“). Aufrunden, nie unterversprechen. */
export function etaMinutesFromMs(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 25_000) return 0;
  return Math.max(1, Math.ceil(ms / 60_000));
}

/**
 * ETA aus Plan + aktuellem Schritt.
 * (Alter Progress-%-Pfad entfernt — stimmte nicht mit Step-Dauern überein.)
 */
export function etaMinutesRemaining(opts: {
  budgets: StageBudget[];
  finishedStages: Iterable<string>;
  currentStage: string | null;
  elapsedInStageMs: number;
  rateMul: number;
  sessionElapsedMs?: number;
}): number {
  return etaMinutesFromMs(etaMsRemaining(opts));
}

export function adjustRateMul(opts: {
  rateMul: number;
  stageEarly: boolean;
  stageLate: boolean;
}): number {
  let m = opts.rateMul;
  if (opts.stageEarly) m = Math.min(1.55, m * 1.04);
  if (opts.stageLate) m = Math.max(0.45, m * 0.96);
  // drift back toward 1
  m = m * 0.98 + 1 * 0.02;
  return m;
}

export function ewmaUpdate(prev: number | null, sample: number, alpha = 0.18): number {
  if (prev == null || prev <= 0) return sample;
  return prev * (1 - alpha) + sample * alpha;
}

export function stageKey(path: string | null | undefined, stage: string): string {
  const p = (path || 'default').toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 24);
  return `${p}::${stage}`;
}
