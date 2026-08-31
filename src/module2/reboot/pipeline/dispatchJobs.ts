/**
 * Child-Jobs wirklich feuern: jedes Slot-Tool parallel, Plan webt nur.
 * Die volle User-Frage wird nie als Klumpen an day_plan_budget gegeben.
 */

import { REBOOT_MAX_PARALLEL_FACT_JOBS } from '../contracts';
import type { FindusJobId } from '../../jobs/types';
import { orchestrateUtterance, type OrchestratedTurn } from './orchestrateSlots';

export function uniqueJobIds(ids: FindusJobId[]): FindusJobId[] {
  const out: FindusJobId[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function dispatchJobsForUtterance(text: string): FindusJobId[] {
  return uniqueJobIds(orchestrateUtterance(text).jobs).slice(
    0,
    REBOOT_MAX_PARALLEL_FACT_JOBS,
  );
}

export function childJobsBesidesPlan(jobs: FindusJobId[]): FindusJobId[] {
  return jobs.filter((j) => j !== 'day_plan_budget');
}

/** Kombi mit eigenen Tools → Plan darf den Turn nicht exklusiv klauen. */
export function hasParallelChildJobs(text: string): boolean {
  return childJobsBesidesPlan(dispatchJobsForUtterance(text)).length > 0;
}

export function shouldExclusiveM5Plan(text: string): boolean {
  const orch = orchestrateUtterance(text);
  if (!orch.weaveDayPlan) return false;
  return childJobsBesidesPlan(orch.jobs).length === 0;
}

/** Kombi-Satz: nach Call-1 nicht exklusiv an Pitch/Chat/M5. */
export function call1OwnsCompoundTurn(text: string): boolean {
  const orch = orchestrateUtterance(text);
  if (orch.weaveDayPlan) return true;
  return childJobsBesidesPlan(orch.jobs).length >= 2;
}

export function planMustNotSwallowParts(orch: OrchestratedTurn): boolean {
  const parts = orch.slots.filter((s) => s.kind !== 'travel' || orch.slots.length > 1);
  if (parts.length <= 1) return true;
  const children = childJobsBesidesPlan(orch.jobs);
  if (!orch.weaveDayPlan) return children.length >= Math.min(2, parts.length);
  return children.length >= 2;
}
