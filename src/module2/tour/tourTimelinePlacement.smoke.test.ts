/**
 * Tour→Timeline Platzierung + Pack-Guard (Node, kein RN).
 *
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/tour/tourTimelinePlacement.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { useFuturePlanStore } from '../timeline/futurePlanState';
import {
  softTimedIntervalsFromStops,
  findFreeSlotStartMs,
  dayBoundsMs,
  hardIntervalsFromStops,
} from '../planning/planHardLock';
import {
  buildTourStopNotes,
  resolveTourStartMs,
} from './tourTimelinePlacement';
import { packCityMismatchesDestPure } from './packCityGuard';
import type { TourRequest } from './types';

const dayKey = '2026-09-21';
const breakfastStart = new Date(2026, 8, 21, 10, 0, 0, 0).getTime();
const breakfastEnd = new Date(2026, 8, 21, 10, 45, 0, 0).getTime();

useFuturePlanStore.getState().setPlan({
  dayKey,
  stops: [
    {
      id: 'wish_breakfast',
      title: 'Frühstück Hamburg',
      plannedStartMs: breakfastStart,
      plannedEndMs: breakfastEnd,
      bufferMin: 5,
      transport: 'walk',
      kind: 'wish',
      status: 'pending_change',
      planPriority: 5,
      notes: 'Frühstück nach Ankunft ab 10:00',
    },
  ],
  transportDefault: 'walk',
  vibe: null,
  base: { label: 'Hamburg', kind: 'other', lat: 53.55, lng: 10.0 },
  originBase: null,
  updatedAtMs: Date.now(),
});

const soft = softTimedIntervalsFromStops(
  useFuturePlanStore.getState().plan.stops,
);
assert.equal(soft.length, 1, 'Frühstück ist soft-timed Block');

const req: TourRequest = {
  requestId: 't1',
  title: 'Stadt erkunden',
  context: 'Morgen Hamburg Tour vormittag',
  mode: 'stop_tour',
  startMode: 'scheduled',
  anchor: { lat: 53.55, lng: 10.0 },
  themeFilters: [],
  categoryMust: [],
  categoryAvoid: [],
  mobility: 'walk',
  needsDurationAsk: false,
  visitedExclude: false,
  uiLayout: 'timeline_stack',
  prefs: {},
  cityHint: 'Hamburg',
  preferStartMs: new Date(2026, 8, 21, 9, 30, 0, 0).getTime(),
};

const start = resolveTourStartMs(dayKey, req.preferStartMs, req, 120);
assert.ok(
  start >= breakfastEnd,
  `Tour muss nach Frühstück starten, got ${new Date(start).toISOString()}`,
);

const notesA = buildTourStopNotes(4);
const notesB = buildTourStopNotes(12);
assert.equal(notesA, 'Tour · ~4 Min', 'dwell not total');
assert.equal(notesB, 'Tour · ~12 Min', 'per-stop dwell');
assert.ok(!/134/.test(notesA), 'no stamped totalMin');

assert.ok(
  packCityMismatchesDestPure('Pinneberg', 'Hamburg'),
  'Pinneberg pack ≠ Hamburg dest',
);
assert.ok(
  !packCityMismatchesDestPure('Hamburg', 'Hamburg'),
  'same city ok',
);
assert.ok(
  !packCityMismatchesDestPure('Pinneberg', null),
  'missing dest → no block',
);

const bounds = dayBoundsMs(dayKey);
const free = findFreeSlotStartMs({
  preferredStartMs: new Date(2026, 8, 21, 9, 30, 0, 0).getTime(),
  durationMs: 90 * 60_000,
  hardIntervals: hardIntervalsFromStops(
    useFuturePlanStore.getState().plan.stops,
  ),
  extraIntervals: soft,
  dayStartMs: bounds.start,
  dayEndMs: bounds.end,
});
assert.ok(free != null && free >= breakfastEnd, 'findFree after breakfast');

console.log('tourTimelinePlacement.smoke.test.ts OK');
