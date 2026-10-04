/**
 * Call-1 Task-Honor — Agents folgen brief/lane, statt den Rohsatz neu zu klassifizieren.
 */

import type { FindusJobId } from '../jobs/types';
import type { ManagerAnalysis, ManagerTask, ManagerTaskLane } from './types';

const LANE_TO_JOB: Partial<Record<ManagerTaskLane, FindusJobId>> = {
  weather: 'weather_outfit',
  pack: 'fact_number',
  places: 'sight_recommend',
  hours: 'dining_open',
  walk_eta: 'nav_route',
  web_events: 'tonight_live',
  grocery_on_way: 'shopping_errand',
  dining: 'dining_open',
  cinema: 'tonight_live',
  /** Toilette/ATM/Wasser = Sofort-Friction, kein Shopping */
  amenity: 'friction_now',
  parking: 'parking_ev',
  combo: 'day_plan_budget',
  knowledge: 'fact_number',
  instagram: 'nightlife_vibe',
  other: 'smalltalk_general',
};

export type Call1TaskHonor = {
  jobHint: FindusJobId;
  secondaryJobIds: FindusJobId[];
  honoredCall1: boolean;
  /** Text für classify/thinkAhead — Brief wenn honoriert, sonst Rohsatz */
  classifyText: string;
  /** Agent-Input: Brief + Constraints, Rohsatz nur als Kontext */
  laneUserText: string;
};

function constraintLine(analysis: ManagerAnalysis, task: ManagerTask): string {
  const must = [
    ...(analysis.order?.must ?? []),
    ...(analysis.order?.avoid ?? []),
    ...(analysis.mustHaves ?? []),
    ...(analysis.frame?.mustHaves ?? []),
    ...(Array.isArray(task.searchHints) ? task.searchHints : []),
  ]
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .slice(0, 8);
  if (!must.length) return '';
  const soft = analysis.order?.search?.forbidSoftFill ? ' | FORBID_SOFT_FILL' : '';
  return `CONSTRAINTS: ${must.join(', ')}${soft}`;
}

/**
 * Wenn Call 1 einen klaren Task-Brief + Lane/Job geliefert hat:
 * kein Re-Classify am ganzen User-Satz.
 */
export function resolveCall1TaskHonor(opts: {
  task: ManagerTask;
  userText: string;
  analysis: ManagerAnalysis;
  /** Live-Chat Kurzbefehl: Rohtext behalten */
  forceRawUserText?: boolean;
}): Call1TaskHonor {
  const brief = String(opts.task.brief || '')
    .replace(/\s+/g, ' ')
    .trim();
  const raw = String(opts.userText || '')
    .replace(/\s+/g, ' ')
    .trim();
  const fromLane = LANE_TO_JOB[opts.task.lane];
  const analysisHint = String(opts.analysis.jobHint || '').trim() as FindusJobId | '';
  const briefLow = brief.toLowerCase();
  const frictionFromBrief =
    /\b(toilette|\bwc\b|geldautomat|\batm\b|trinkwasser|steckdose|friction|sofort)\b/iu.test(
      briefLow,
    ) ||
    /\b(toilette|\bwc\b|geldautomat|\batm\b)\b/iu.test(raw);
  const laneJob: FindusJobId | undefined = frictionFromBrief
    ? 'friction_now'
    : fromLane;
  const clearBrief = brief.length >= 8;
  const hasCall1Job = Boolean(
    laneJob ||
      analysisHint ||
      opts.analysis.call2Brief?.trim() ||
      opts.analysis.execution ||
      (opts.analysis.order?.must?.length ?? 0) > 0,
  );

  if (opts.forceRawUserText) {
    return {
      jobHint: (analysisHint || laneJob || 'smalltalk_general') as FindusJobId,
      secondaryJobIds: [],
      honoredCall1: false,
      classifyText: raw,
      laneUserText: raw,
    };
  }

  if (clearBrief && hasCall1Job) {
    // Multi-Task: Lane schlägt globalen jobHint (sonst klaut Taxi den Dining-Task).
    // Amenity/Friction nie von shopping_errand-Hint überschreiben.
    const multi = (opts.analysis.tasks?.length ?? 0) > 1;
    const preferFriction =
      frictionFromBrief || laneJob === 'friction_now';
    const jobHint = (
      preferFriction
        ? 'friction_now'
        : multi
          ? laneJob || analysisHint || 'smalltalk_general'
          : analysisHint || laneJob || 'smalltalk_general'
    ) as FindusJobId;
    const constraints = constraintLine(opts.analysis, opts.task);
    const laneUserText = [
      `[TASK ${opts.task.id}] ${brief}`,
      constraints,
      '=== CONTEXT_UTTERANCE ===',
      raw,
    ]
      .filter(Boolean)
      .join('\n');
    return {
      jobHint,
      secondaryJobIds: [],
      honoredCall1: true,
      classifyText: brief,
      laneUserText,
    };
  }

  // Fallback: Rohsatz + Brief-Anhang (Legacy)
  return {
    jobHint: (analysisHint || laneJob || 'smalltalk_general') as FindusJobId,
    secondaryJobIds: [],
    honoredCall1: false,
    classifyText: raw,
    laneUserText: `${raw}\n\n[TASK ${opts.task.id}] ${brief || '—'}`,
  };
}

export function laneToJobId(lane: ManagerTaskLane): FindusJobId | null {
  return LANE_TO_JOB[lane] ?? null;
}
