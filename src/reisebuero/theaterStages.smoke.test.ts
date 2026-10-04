/**
 * Akt-3 Theater: Rail offen→eng + Legacy-Normalize.
 */
import assert from 'node:assert/strict';
import {
  LEGACY_TO_THEATER,
  THEATER_STATUS_RAIL,
  canFinishTheaterStage,
  normalizeTheaterStage,
} from './research/theaterStages';
import { RESEARCH_STATUS_RAIL, DEFAULT_STAGE_MS, buildProgressPlan } from './research/progressPace';
import { STAGE_META, theaterChecklistFocus } from './research/stageMeta';
import type { ResearchStep } from './types';

assert.equal(RESEARCH_STATUS_RAIL[0]?.stage, 'brief_plan');
assert.equal(RESEARCH_STATUS_RAIL.at(-1)?.stage, 'package_pick');
assert.equal(RESEARCH_STATUS_RAIL.length, THEATER_STATUS_RAIL.length);

const expected = [
  'brief_plan',
  'open_space',
  'access_filter',
  'shortlist',
  'stay_tracks',
  'flight_matrix',
  'score_compare',
  'feeder',
  'package_pick',
];
assert.deepEqual(
  RESEARCH_STATUS_RAIL.map((r) => r.stage),
  expected,
);

assert.equal(normalizeTheaterStage('climate'), 'open_space');
assert.equal(normalizeTheaterStage('discover'), 'open_space');
assert.equal(normalizeTheaterStage('soft'), 'open_space');
assert.equal(normalizeTheaterStage('flights'), 'flight_matrix');
assert.equal(normalizeTheaterStage('stay'), 'stay_tracks');
assert.equal(normalizeTheaterStage('compare'), 'score_compare');
assert.equal(normalizeTheaterStage('qa'), 'package_pick');
assert.equal(normalizeTheaterStage('flight_matrix'), 'flight_matrix');
assert.equal(canFinishTheaterStage('discover', 'open_space'), false);
assert.equal(canFinishTheaterStage('soft', 'open_space'), true);
assert.equal(canFinishTheaterStage('climate', 'open_space'), false);

for (const r of RESEARCH_STATUS_RAIL) {
  assert.ok(STAGE_META[r.stage]?.title, `meta ${r.stage}`);
  assert.ok(DEFAULT_STAGE_MS[r.stage]! > 0, `ms ${r.stage}`);
}

const plan = buildProgressPlan(
  RESEARCH_STATUS_RAIL.map((r) => r.stage),
  (s) => DEFAULT_STAGE_MS[s] ?? 10_000,
);
assert.ok(plan.budgets.every((b) => expected.includes(b.stage as (typeof expected)[number])));

const steps: ResearchStep[] = expected.map((stage, i) => ({
  id: `rs_${stage}`,
  stage,
  title: STAGE_META[stage]!.title,
  detail: STAGE_META[stage]!.vibe,
  status: i === 5 ? 'active' : i < 5 ? 'done' : 'pending',
  emoji: STAGE_META[stage]!.emoji,
}));
const focus = theaterChecklistFocus(steps);
assert.equal(focus.stage, 'flight_matrix');
assert.match(focus.stepTitle, /Flug/i);

const cmp = theaterChecklistFocus([
  {
    id: 'rs_score_compare',
    stage: 'score_compare',
    title: 'Score',
    detail: '…',
    status: 'active',
  },
]);
assert.equal(cmp.showComparePalette, true);

assert.ok(Object.keys(LEGACY_TO_THEATER).length >= 15, 'legacy map');

console.log('theaterStages.smoke.test.ts ok');
