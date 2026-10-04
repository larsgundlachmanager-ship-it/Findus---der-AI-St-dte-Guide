/**
 * Explore-Drift-Block: Flug+Taxi → flight_advisor, nie „Stadt erkunden“.
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/flights/flightBlocksExplore.smoke.ts
 */
import assert from 'node:assert/strict';
import {
  blocksExploreDriftForFlight,
  shouldEnterFlightAdvisor,
} from './flightTripIntent';
import { shouldIngestCompoundPlan } from '../../module2/planning/compoundPlanIngestCore';
import { looksLikeModul5PlanUtterance } from '../../module2/planning/planUtteranceGate';
import { detectCall1Situation } from '../../module2/reboot/pipeline/call1AnswerContract';
import { finalizeCall1Execution } from '../../module2/router/call1Dispatch';
import type { ManagerAnalysis } from '../../module2/router/types';
import { emptyTurnFrame } from '../../module2/router/turnFrame';

const u =
  'Ich fliege morgen nach London und kannst du mir dafür ein Taxi vorbestellen, so dass ich pünktlich am Flughafen bin?';

assert.equal(blocksExploreDriftForFlight(u), true);
assert.equal(shouldEnterFlightAdvisor({ userText: u }), true);
assert.equal(shouldIngestCompoundPlan(u), false, 'no compound ingest');
assert.equal(looksLikeModul5PlanUtterance(u), false, 'no M5 explore');
assert.equal(detectCall1Situation(u), 'flight_leave_by');

function base(partial: Partial<ManagerAnalysis> = {}): ManagerAnalysis {
  return {
    intentSummary: 'test',
    route: 'blueprint',
    blueprintId: null,
    blueprintStage: null,
    session: 'new',
    threadMatchId: null,
    subject: null,
    bridge: 'Verstanden.',
    lanePlan: 'fast_only',
    pace: 'standard',
    bridgeMaxWords: 36,
    fastDeadlineMs: 8000,
    latencyHintSec: null,
    tasks: [],
    openLoops: [],
    nameAllowed: false,
    jobHint: null,
    chatLane: 'plan',
    frame: emptyTurnFrame(),
    ...partial,
  };
}

assert.equal(
  finalizeCall1Execution(
    base({ execution: 'plan_module', chatLane: 'plan' }),
    u,
  ),
  'flight_advisor',
  'plan_module loses to flight+taxi',
);

assert.equal(
  finalizeCall1Execution(
    base({ execution: 'reisebuero', chatLane: 'plan' }),
    u,
  ),
  'flight_advisor',
  'reisebuero loses to flight+taxi',
);

assert.equal(
  finalizeCall1Execution(
    base({ execution: 'plan_walkthrough', chatLane: 'plan' }),
    u,
  ),
  'flight_advisor',
  'plan_walkthrough loses to flight+taxi',
);

console.log('flightBlocksExplore.smoke.ts OK');
