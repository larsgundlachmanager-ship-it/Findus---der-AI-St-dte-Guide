/**
 * P0 routing harden smoke — JobShape + Solo/Package + reconcile locks.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/router/agentHardenP0.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  inferCall1JobShape,
  jobShapeNeedsCompose,
  jobShapeToExecutionHint,
} from './call1JobShape';
import { parseCall1OrderTicket } from './call1OrderTicket';
import { isSoloFlightAbSearch } from '../../services/flights/flightTripIntent';
import { isFindusReisebueroHandoff } from '../../reisebuero/handoff';
import { reconcileExecutionWithOrchestrator } from './call1WorkOrchestrator';
import { finalizeCall1Execution } from './call1Dispatch';
import type { ManagerAnalysis } from './types';
import { emptyTurnFrame } from './turnFrame';

const SOLO = 'günstig von Hamburg nach Split fliegen';
assert.equal(inferCall1JobShape(SOLO), 'flight_only');
assert.equal(isSoloFlightAbSearch(SOLO), true);
assert.equal(isFindusReisebueroHandoff(SOLO), false);
assert.equal(jobShapeToExecutionHint('flight_only'), 'flight_advisor');

const PKG = 'Urlaub für vier Tage nach Palma mit Hotel';
assert.equal(isSoloFlightAbSearch(PKG), false, 'stay days not solo');
assert.ok(
  isFindusReisebueroHandoff(PKG) || inferCall1JobShape(PKG) === 'trip_package',
  'package → reisebuero/trip_package',
);

const HOME =
  'Wann bin ich zu Hause wenn der Flug um 18 Uhr in Hamburg landet?';
assert.equal(inferCall1JobShape(HOME), 'arrival_home');
assert.ok(jobShapeNeedsCompose('arrival_home'));

const order = parseCall1OrderTicket(
  { order: { jobShape: 'place_dining', need: { menuUrl: true } } },
  { userText: 'Pizza mit Rucola in der Nähe' },
);
assert.equal(order.jobShape, 'place_dining');
assert.equal(order.need.menuUrl, true);

function base(partial: Partial<ManagerAnalysis>): ManagerAnalysis {
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
    chatLane: 'chat',
    frame: emptyTurnFrame(),
    ...partial,
  };
}

assert.equal(
  reconcileExecutionWithOrchestrator('chat_lane', { brief: { runnableWork: [] } } as never, SOLO),
  'flight_advisor',
  'reconcile locks solo flight',
);

assert.equal(
  reconcileExecutionWithOrchestrator(
    'reisebuero',
    { brief: { runnableWork: [{ worker: 'dining' }] } } as never,
    PKG,
  ),
  'reisebuero',
  'reconcile locks reisebuero',
);

assert.equal(
  finalizeCall1Execution(base({ execution: 'nav_execute' }), HOME),
  'task_fanout',
  'arrival_home compose fanout',
);

console.log('agentHardenP0.smoke.test.ts OK');
