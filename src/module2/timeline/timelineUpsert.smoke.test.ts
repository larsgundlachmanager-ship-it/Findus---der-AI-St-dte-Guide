/**
 * Run: npx --yes tsx src/module2/timeline/timelineUpsert.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  scheduleWriteExecutionHint,
  upsertPlanStopFacade,
  cleanPlanDestTitle,
} from './timelineUpsert';
import type { FuturePlanStop } from './futurePlanState';

assert.equal(
  scheduleWriteExecutionHint('Trag den Flug morgen in meine Timeline ein'),
  'plan_module',
);
assert.equal(scheduleWriteExecutionHint('Wo ist das nächste Café?'), 'none');

assert.equal(cleanPlanDestTitle('Schönes Hamburg'), 'Hamburg');

const futureMs = Date.now() + 3600_000;
const stop: FuturePlanStop = {
  id: 'smoke_stop_1',
  kind: 'stop',
  title: 'Smoke Test',
  plannedStartMs: futureMs,
  plannedEndMs: futureMs + 30 * 60_000,
};
assert.equal(typeof upsertPlanStopFacade(stop), 'boolean');

console.log('timelineUpsert.smoke.test.ts ok');
