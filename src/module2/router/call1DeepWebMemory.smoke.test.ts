/**
 * Deep-Web / Memory-Recall Worker Smokes (ohne Netz).
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/router/call1DeepWebMemory.smoke.test.ts
 */

import assert from 'node:assert/strict';
import {
  looksLikeIslandFlight,
  shapeDeepWebQuery,
  wantsDeepWebBooking,
} from './call1DeepWebWorker';
import {
  pickMemoryRecallHits,
  wantsFoodVisitFilter,
  wantsMemoryRecall,
} from './call1MemoryRecallWorker';
import { workerToExecutionHint, executionFromWorkers } from './call1CapabilityMap';
import { buildCall1TaskBrief } from './call1TaskBrief';
import { emptyTurnFrame } from './turnFrame';
import type { ManagerAnalysis } from './types';
import type { VisitLogEntry } from '../../services/timeline/visitLog';

assert.equal(
  wantsMemoryRecall('Wo waren wir gestern essen?'),
  true,
  'memory intent',
);
assert.equal(wantsMemoryRecall('SUP auf der Alster'), false);
assert.equal(wantsFoodVisitFilter('gestern essen'), true);

assert.equal(
  looksLikeIslandFlight('Flug nach Wangerooge buchen'),
  true,
  'island flight',
);
assert.equal(wantsDeepWebBooking('Charter nach Juist'), true);
assert.match(
  shapeDeepWebQuery('Flug nach Wangerooge bitte'),
  /Wangerooge.*Charter/i,
);

assert.equal(workerToExecutionHint('memory_recall'), 'task_fanout');
assert.equal(workerToExecutionHint('deep_web'), 'task_fanout');
assert.equal(executionFromWorkers(['memory_recall']), 'task_fanout');
assert.equal(executionFromWorkers(['deep_web']), 'task_fanout');
assert.equal(executionFromWorkers(['memory_prefs']), 'memory');

const nowMs = Date.parse('2026-09-11T12:00:00+02:00');
const yesterday = '2026-09-10';
const entries: VisitLogEntry[] = [
  {
    id: '1',
    dateKey: yesterday,
    name: 'Restaurant Elbterrassen',
    lat: null,
    lng: null,
    poiId: null,
    arrivedAtMs: Date.parse('2026-09-10T19:00:00+02:00'),
    leftAtMs: null,
    dwellMin: null,
    source: 'dwell',
    cityId: 'hamburg',
  },
  {
    id: '2',
    dateKey: yesterday,
    name: 'Hauptbahnhof',
    lat: null,
    lng: null,
    poiId: null,
    arrivedAtMs: Date.parse('2026-09-10T10:00:00+02:00'),
    leftAtMs: null,
    dwellMin: null,
    source: 'nav',
    cityId: 'hamburg',
  },
];

const foodHits = pickMemoryRecallHits({
  entries,
  userText: 'Wo waren wir gestern essen?',
  nowMs,
});
assert.equal(foodHits.length, 1);
assert.equal(foodHits[0]!.label, 'Restaurant Elbterrassen');
assert.equal(foodHits[0]!.whenLabel, 'gestern');

const emptyHits = pickMemoryRecallHits({
  entries: [],
  userText: 'Wo waren wir gestern essen?',
  nowMs,
});
assert.equal(emptyHits.length, 0, 'empty visit log honesty');

const analysis: ManagerAnalysis = {
  intentSummary: 'memory',
  route: 'blueprint',
  blueprintId: null,
  blueprintStage: null,
  session: 'new',
  threadMatchId: null,
  subject: null,
  bridge: 'Kurz.',
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
};

const memBrief = buildCall1TaskBrief({
  analysis,
  userText: 'Wo waren wir gestern essen?',
});
assert.ok(
  memBrief.work.some((w) => w.worker === 'memory_recall'),
  'brief injects memory_recall',
);

const deepBrief = buildCall1TaskBrief({
  analysis,
  userText: 'Flug nach Wangerooge buchen',
});
assert.ok(
  deepBrief.work.some((w) => w.worker === 'deep_web'),
  'brief injects deep_web',
);

console.log('call1DeepWebMemory.smoke.test.ts OK');
