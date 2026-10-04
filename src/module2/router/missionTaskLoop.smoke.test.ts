/**
 * Smoke: Task-Loop Ziel → invent → herleiten → nur Blocker → später nachlegen.
 */
import assert from 'node:assert/strict';
import {
  runMissionTaskLoop,
  applyLaterPromote,
  pickLoopBlockers,
  formatTaskLoopIntent,
} from './missionTaskLoop';
import {
  clearFollowThroughGoal,
  syncFollowThroughGoal,
  inventFollowThroughWork,
  getFollowThroughGoal,
} from './missionFollowThrough';
import { buildCall1TaskBrief } from './call1TaskBrief';
import type { ManagerAnalysis } from './types';

clearFollowThroughGoal();

const baseWork = [
  {
    id: 'ft_taxi_flight',
    worker: 'flight' as const,
    brief: 'Task 1 Flug',
    proximity: 'here_now' as const,
    executeWhen: 'now' as const,
  },
  {
    id: 'ft_taxi_transfer',
    worker: 'taxi' as const,
    brief: 'Task 2 Taxi',
    proximity: 'here_now' as const,
    executeWhen: 'now' as const,
    dependsOn: 'ft_taxi_flight',
    wantBookingLink: true,
  },
];

{
  const { work, deferredIds } = applyLaterPromote({
    work: baseWork,
    flightTimeReady: false,
    accessPending: false,
  });
  assert.equal(
    work.find((w) => w.id === 'ft_taxi_transfer')?.executeWhen,
    'later',
    'taxi deferred without clock',
  );
  assert.ok(deferredIds.includes('ft_taxi_transfer'));
}

{
  const { work, promotedIds } = applyLaterPromote({
    work: baseWork.map((w) =>
      w.id === 'ft_taxi_transfer' ? { ...w, executeWhen: 'later' as const } : w,
    ),
    flightTimeReady: true,
    accessPending: false,
  });
  assert.equal(
    work.find((w) => w.id === 'ft_taxi_transfer')?.executeWhen,
    'now',
    'taxi promoted when clock ready',
  );
  assert.ok(promotedIds.includes('ft_taxi_transfer'));
}

assert.ok(
  pickLoopBlockers({
    userText: 'Taxi zum Flughafen morgen London',
    wish: 'Taxi pünktlich',
    flightTaxiGoal: true,
  }).some((b) => /Abflugzeit/i.test(b)),
);

assert.equal(
  pickLoopBlockers({
    userText: 'um 18 Uhr',
    wish: 'Taxi pünktlich',
    flightTime: '18 Uhr',
    flightTaxiGoal: true,
  }).filter((b) => /Abflugzeit/i.test(b)).length,
  0,
  'no time blocker when clock known',
);

const loopNoClock = runMissionTaskLoop({
  userText:
    'Ich fliege morgen nach London, bestell mir ein Taxi zum Flughafen pünktlich',
  wish: 'Taxi zum Flughafen vorbestellen (pünktlich)',
  work: baseWork,
});
assert.ok(loopNoClock.derived.some((d) => /Ziel=London|Tag=/i.test(d)));
assert.ok(loopNoClock.derived.some((d) => /Startflughafen/i.test(d)));
assert.ok(loopNoClock.blockers.some((b) => /Abflugzeit/i.test(b)));
// Flight-Worker übernimmt Slot-Frage → Loop setzt kein zweites AskBack
assert.equal(loopNoClock.askBack, null, 'flight worker owns ask');
assert.equal(
  loopNoClock.work.find((w) => w.id === 'ft_taxi_transfer')?.executeWhen,
  'later',
);
assert.match(loopNoClock.loopIntent, /Task-Loop:/);

const loopWithClock = runMissionTaskLoop({
  userText: 'um 18 Uhr',
  wish: 'Taxi zum Flughafen vorbestellen (pünktlich)',
  work: baseWork,
  flightTime: '18 Uhr',
});
assert.ok(!loopWithClock.blockers.some((b) => /Abflugzeit/i.test(b)));
assert.equal(
  loopWithClock.work.find((w) => w.id === 'ft_taxi_transfer')?.executeWhen,
  'now',
  'nachlegen now after clock',
);
assert.match(
  formatTaskLoopIntent({
    wish: 'x',
    derived: ['a'],
    blockers: [],
    deferredIds: [],
    promotedIds: ['ft_taxi_transfer'],
  }),
  /JetztNachgelegt/,
);

// End-to-end invent + brief
syncFollowThroughGoal(
  'Ich fliege morgen nach London, bestell mir ein Taxi zum Flughafen pünktlich',
);
const invented = inventFollowThroughWork(
  'Ich fliege morgen nach London, bestell mir ein Taxi zum Flughafen pünktlich',
  'here_now',
);
assert.ok(invented.some((w) => w.worker === 'flight'));
assert.ok(
  invented.some(
    (w) =>
      (w.worker === 'taxi' || w.worker === 'transit') &&
      w.executeWhen === 'later',
  ),
  'taxi later until clock',
);

const brief = buildCall1TaskBrief({
  analysis: {
    intentSummary: 'Taxi Flughafen',
    authorIntent: 'Taxi pünktlich zum Flughafen',
    session: 'continue',
    chatLane: 'plan',
    bridge: 'Klar.',
    bridgeComplete: false,
    askBack: null,
    openLoops: [],
    mustHaves: [],
    frame: null,
  } as unknown as ManagerAnalysis,
  userText:
    'Ich fliege morgen nach London, bestell mir ein Taxi zum Flughafen pünktlich',
});
assert.match(brief.authorIntent, /Task-Loop:/);
assert.ok(
  brief.work.some((w) => w.executeWhen === 'later'),
  'brief keeps later taxi',
);

inventFollowThroughWork('um 18 Uhr', 'here_now');
const g = getFollowThroughGoal();
assert.ok(g?.slots.flightTime || g?.auftrag?.known?.length);

clearFollowThroughGoal();
console.log('missionTaskLoop.smoke.test.ts OK');
