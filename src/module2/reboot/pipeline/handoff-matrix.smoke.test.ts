/**
 * Handoff-Matrix — strukturelle Smoke-Checks (RFC handoff-matrix.md).
 */

import { resolveHandoff } from '../../router/handoffs';
import { buildAnalysisFromChoice } from '../../router/choiceTurnContext';
import type { ManagerAnalysis } from '../../router/types';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

function baseAnalysis(partial: Partial<ManagerAnalysis>): ManagerAnalysis {
  return {
    intentSummary: 'test',
    route: 'blueprint',
    blueprintId: null,
    blueprintStage: null,
    session: 'new',
    threadMatchId: null,
    subject: null,
    bridge: null,
    lanePlan: 'fast_only',
    pace: 'standard',
    bridgeMaxWords: 28,
    fastDeadlineMs: 6000,
    latencyHintSec: null,
    tasks: [],
    openLoops: [],
    nameAllowed: false,
    jobHint: null,
    ...partial,
  };
}

// #1 nav → m3
assert(
  resolveHandoff(baseAnalysis({ route: 'm3_nav_start' })) === 'm3_nav_start',
  'matrix nav',
);

// #5 flight job
assert(
  resolveHandoff(
    baseAnalysis({
      route: 'blueprint',
      jobHint: 'flight_trip',
    }),
  ) === 'none',
  'matrix flight job',
);

// #7 plan
assert(
  resolveHandoff(baseAnalysis({ route: 'm5_plan', chatLane: 'plan' })) === 'm5_plan',
  'matrix plan',
);

// #18 reisebuero handoff field
const reise = baseAnalysis({ handoff: 'reisebuero', route: 'm5_plan' });
assert(reise.handoff === 'reisebuero', 'matrix reisebuero field');

// #6 baggage tap
const baggage = buildAnalysisFromChoice(
  {
    parentTurnId: 'p',
    choiceId: 'b',
    label: 'Handgepäck',
    slotKey: 'baggage_type',
  },
  null,
);
assert(baggage.jobHint === 'flight_trip', 'matrix baggage tap');

// #16 pitch option tap
const pitch = buildAnalysisFromChoice(
  {
    parentTurnId: 'p',
    choiceId: '1',
    label: 'Option 1',
    slotKey: 'pitch_option',
  },
  null,
);
assert(pitch.jobHint === 'live_events', 'matrix pitch tap');

console.log('[handoff-matrix] ok');
