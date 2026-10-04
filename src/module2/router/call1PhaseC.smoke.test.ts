/**
 * Phase C — work[] steuert execution; Fanout aus Kombi-Work.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/router/call1PhaseC.smoke.test.ts
 */

import assert from 'node:assert/strict';
import { deriveCall1Execution } from './call1Dispatch';
import {
  executionFromWorkers,
  workerToExecutionHint,
} from './call1CapabilityMap';
import {
  managerTasksFromWork,
  reconcileExecutionWithOrchestrator,
  resolveCall1Task,
} from './call1WorkOrchestrator';
import type { ManagerAnalysis } from './types';
import { emptyTurnFrame } from './turnFrame';

function base(partial?: Partial<ManagerAnalysis>): ManagerAnalysis {
  return {
    intentSummary: 'test',
    route: 'blueprint',
    blueprintId: null,
    blueprintStage: null,
    session: 'new',
    threadMatchId: null,
    subject: null,
    bridge: 'Ok.',
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

assert.equal(workerToExecutionHint('events'), 'events_research');
assert.equal(workerToExecutionHint('tour'), 'tour_module');
assert.equal(workerToExecutionHint('deep_web'), 'task_fanout');
assert.equal(workerToExecutionHint('memory_recall'), 'task_fanout');
assert.equal(workerToExecutionHint('identify_nearby'), 'task_fanout');
assert.equal(workerToExecutionHint('map_pin'), 'task_fanout');
assert.equal(executionFromWorkers(['weather']), 'chat_lane');
assert.equal(
  executionFromWorkers(['timer_alarm', 'weather']),
  'task_fanout',
  'kombi fanout',
);
assert.equal(executionFromWorkers(['events']), 'events_research');
assert.equal(executionFromWorkers(['place', 'dining']), 'pitch_module');
assert.equal(
  executionFromWorkers(['flight', 'dining']),
  'task_fanout',
  'mixed families',
);
assert.equal(executionFromWorkers(['memory_recall']), 'task_fanout');
assert.equal(executionFromWorkers(['memory_prefs']), 'memory');
assert.equal(executionFromWorkers(['deep_web']), 'task_fanout');

assert.equal(
  deriveCall1Execution(
    base({
      chatLane: 'chat',
      frame: emptyTurnFrame({
        tasks: [{ id: 'e1', worker: 'events', brief: 'Towers Barclays' }],
      }),
    }),
  ),
  'events_research',
  'events work beats chat lane',
);

assert.equal(
  deriveCall1Execution(
    base({
      chatLane: 'plan',
      frame: emptyTurnFrame({
        tasks: [{ id: 't1', worker: 'tour', brief: 'Tour Elbe' }],
      }),
    }),
  ),
  'tour_module',
  'tour worker → tour_module',
);

assert.equal(
  deriveCall1Execution(
    base({
      chatLane: 'pitch',
      frame: emptyTurnFrame({
        tasks: [{ id: 'd1', worker: 'dining', brief: 'Steak HH' }],
      }),
    }),
  ),
  'pitch_module',
  'dining → pitch',
);

const combo = resolveCall1Task({
  analysis: base(),
  userText: 'Erinner mich in 10 Minuten und wie wird morgen das Wetter?',
});
assert.equal(combo.primaryExecution, 'task_fanout');
const synth = managerTasksFromWork(combo.brief.runnableWork);
assert.ok(synth.length >= 2, 'fanout tasks from work');

const morgen = resolveCall1Task({
  analysis: base({
    execution: 'nav_execute',
    frame: emptyTurnFrame({
      tasks: [
        {
          id: 'n1',
          worker: 'nav',
          brief: 'Route Elphi',
          when: { kind: 'day', label: 'morgen', dateKey: '2026-09-12' },
        },
      ],
    }),
  }),
  userText: 'Morgen möchte ich zur Elbphilharmonie dahin',
});
assert.equal(
  reconcileExecutionWithOrchestrator('nav_execute', morgen),
  'chat_lane',
  'morgen dahin: no nav_execute',
);

const taxi = resolveCall1Task({
  analysis: base({
    frame: emptyTurnFrame({
      tasks: [
        { id: 't1', worker: 'transit', brief: 'Taxi zum Flughafen' },
      ],
    }),
  }),
  userText: 'Kannst du mir ein Taxi zum Flughafen vorbestellen?',
});
assert.equal(
  reconcileExecutionWithOrchestrator('task_fanout', taxi),
  'chat_lane',
  'taxi blocker → chat',
);

console.log('[call1PhaseC] ok');
