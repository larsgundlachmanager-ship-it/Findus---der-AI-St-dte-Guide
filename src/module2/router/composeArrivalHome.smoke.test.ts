/**
 * Run: npx --yes tsx src/module2/router/composeArrivalHome.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  buildComposeManagerTasks,
  resolveComposeJobShape,
  augmentAnalysisForCompose,
  mergeComposeSpeech,
} from './composeRunner';
import { inferCall1JobShape, jobShapeNeedsCompose } from './call1JobShape';
import { finalizeCall1Execution } from './call1Dispatch';
import type { ManagerAnalysis } from './types';

const arrival =
  'Wann bin ich zu Hause, wenn der Flug um 18 Uhr in Hamburg landet?';
assert.equal(inferCall1JobShape(arrival), 'arrival_home');
assert.ok(jobShapeNeedsCompose('arrival_home'));
assert.equal(resolveComposeJobShape(arrival), 'arrival_home');

const tasks = buildComposeManagerTasks('arrival_home', arrival, []);
assert.ok(tasks.length >= 2, 'arrival_home builds flight+nav tasks');
assert.ok(
  tasks.some((t) => /flight|leave/i.test(t.brief)),
  'flight slice',
);
assert.ok(tasks.some((t) => t.lane === 'walk_eta'), 'nav slice');

const woven = mergeComposeSpeech([
  { id: 'a', worker: 'flight', speech: 'Landung gegen 18 Uhr · Terminal 2' },
  { id: 'b', worker: 'nav', speech: 'Mit S-Bahn bist du so gegen 19:15 da.' },
], { shape: 'arrival_home' });
assert.ok(!woven.speechText.includes('·'), 'no middle dots in speech');
assert.match(woven.speechText, /18|19:15/);

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
    chatLane: 'nav',
    ...partial,
  };
}

const multi = 'Noch einen Stopp beim Bäcker, wie lange brauche ich insgesamt?';
assert.equal(inferCall1JobShape(multi), 'logistics_multi');
const multiTasks = buildComposeManagerTasks('logistics_multi', multi, []);
assert.ok(multiTasks.length >= 2);

const dispatch = finalizeCall1Execution(base({ execution: 'nav_execute' }), arrival);
assert.equal(dispatch, 'task_fanout', 'compose shape forces fanout not nav');

const aug = augmentAnalysisForCompose(base({}), arrival, 'arrival_home');
assert.equal(aug.execution, 'task_fanout');
assert.ok((aug.tasks?.length ?? 0) >= 2);

console.log('composeArrivalHome.smoke.test.ts ok');
