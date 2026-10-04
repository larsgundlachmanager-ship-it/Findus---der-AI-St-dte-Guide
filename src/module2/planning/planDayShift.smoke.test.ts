/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/planning/planDayShift.smoke.test.ts
 *
 * Node-sicher: Detection + pure shiftPlanDayStops + Store-Apply ohne planLiveEdits (RN).
 */

import assert from 'node:assert/strict';
import {
  looksLikePlanEditUtterance,
  looksLikeWholePlanDayShift,
} from './planEditDetect';
import {
  remapClockMsToDay,
  shiftPlanDayStops,
} from './planDayShift';
import type { FuturePlanStop } from '../timeline/futurePlanState';
import { useFuturePlanStore } from '../timeline/futurePlanState';
import { nextWeekdayDateKey } from '../../utils/dateKeys';

function assertOk(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

/** Spiegel von shiftWholePlanDay — ohne gapFill/RN. */
function applyShiftToStore(fromDay: string, toDay: string): void {
  const store = useFuturePlanStore.getState();
  store.ensureDay(fromDay);
  const fromPlan = store.getPlanForDay(fromDay);
  const { moved } = shiftPlanDayStops({
    fromDay,
    toDay,
    stops: fromPlan.stops,
  });
  store.clearDay(fromDay);
  for (const s of moved) {
    store.upsertStopOnDay(toDay, s);
  }
  store.ensureDay(toDay);
}

// --- Detection ---
assertOk(
  looksLikeWholePlanDayShift('verschieb den ganzen Plan auf Donnerstag'),
  'ganzen Plan auf Donnerstag',
);
assertOk(
  looksLikeWholePlanDayShift('alles auf Donnerstag'),
  'alles auf Donnerstag',
);
assertOk(
  looksLikeWholePlanDayShift('kannst du den Plan auf Freitag verschieben'),
  'Plan auf Freitag',
);
assertOk(
  looksLikePlanEditUtterance('verschieb den ganzen Plan auf Donnerstag'),
  'edit path includes whole-day',
);
assertOk(!looksLikeWholePlanDayShift('lösch Michel'), 'delete is not whole-day');
assertOk(
  !looksLikeWholePlanDayShift('verschieb Frühstück auf 11'),
  'single stop clock is not whole-day',
);

// --- Edit heuristics still true ---
assertOk(looksLikePlanEditUtterance('lösch Michel'), 'delete Michel');
assertOk(looksLikePlanEditUtterance('raus damit'), 'raus damit');
assertOk(looksLikePlanEditUtterance('noch dazu Museum'), 'add Museum');
assertOk(looksLikePlanEditUtterance('Frühstück später'), 'Frühstück später');
assertOk(looksLikePlanEditUtterance('von 10 auf 11'), 'von 10 auf 11');

// --- Pure stop dayKey / clock remap ---
const fromDay = '2026-09-16';
const toDay = '2026-09-17';
const startMs = new Date(2026, 8, 16, 10, 0, 0, 0).getTime();
const endMs = new Date(2026, 8, 16, 11, 30, 0, 0).getTime();
const remapped = remapClockMsToDay(startMs, toDay)!;
assert.equal(new Date(remapped).getHours(), 10, 'hour preserved');
assert.equal(new Date(remapped).getDate(), 17, 'day moved');

const stops: FuturePlanStop[] = [
  {
    id: 's1',
    title: 'Frühstück',
    plannedStartMs: startMs,
    plannedEndMs: endMs,
    bufferMin: 12,
    transport: 'walk',
    kind: 'stop',
    status: 'planned',
  },
  {
    id: 's2',
    title: 'Michel',
    plannedStartMs: new Date(2026, 8, 16, 14, 0, 0, 0).getTime(),
    plannedEndMs: null,
    bufferMin: 12,
    transport: 'walk',
    kind: 'stop',
    status: 'planned',
  },
  {
    id: 'nav_s1_s2',
    title: 'Fußweg nach Michel',
    plannedStartMs: new Date(2026, 8, 16, 13, 30, 0, 0).getTime(),
    plannedEndMs: new Date(2026, 8, 16, 13, 55, 0, 0).getTime(),
    bufferMin: 0,
    transport: 'walk',
    kind: 'nav_leg',
    status: 'planned',
  },
];

const { moved, droppedNavIds } = shiftPlanDayStops({ fromDay, toDay, stops });
assert.equal(moved.length, 2, 'two content stops moved');
assert.equal(droppedNavIds.length, 1, 'nav leg dropped');
assertOk(
  moved.every((s) => {
    if (s.plannedStartMs == null) return false;
    const d = new Date(s.plannedStartMs);
    return d.getFullYear() === 2026 && d.getMonth() === 8 && d.getDate() === 17;
  }),
  'moved stops land on toDay',
);
assert.equal(new Date(moved[0]!.plannedStartMs!).getHours(), 10, 'breakfast 10h');
assert.equal(new Date(moved[1]!.plannedStartMs!).getHours(), 14, 'michel 14h');

// --- Store: no duplicates on both days ---
useFuturePlanStore.getState().setPlan({
  dayKey: fromDay,
  stops: [...stops],
  transportDefault: 'walk',
  vibe: null,
  base: null,
  originBase: null,
  updatedAtMs: Date.now(),
});

const don = nextWeekdayDateKey(
  'donnerstag',
  new Date(2026, 8, 16, 12, 0, 0).getTime(),
);
assertOk(!!don && don !== fromDay, 'donnerstag key');
applyShiftToStore(fromDay, don!);

const fromAfter = useFuturePlanStore.getState().getPlanForDay(fromDay);
const toAfter = useFuturePlanStore.getState().getPlanForDay(don!);
const fromContent = fromAfter.stops.filter((s) => s.kind !== 'nav_leg');
const toContent = toAfter.stops.filter(
  (s) => s.kind !== 'nav_leg' && !s.id.startsWith('choice_'),
);
assert.equal(fromContent.length, 0, 'old day cleared');
assert.equal(toContent.length, 2, 'both stops on new day');
assertOk(
  !toAfter.stops.some((s) => s.kind === 'nav_leg'),
  'no stale nav legs copied',
);
assert.equal(useFuturePlanStore.getState().plan.dayKey, don, 'active day = target');

// dayKeys via plannedStartMs
for (const s of toContent) {
  assertOk(s.plannedStartMs != null, `${s.title} has time`);
  const key = `${new Date(s.plannedStartMs!).getFullYear()}-${String(new Date(s.plannedStartMs!).getMonth() + 1).padStart(2, '0')}-${String(new Date(s.plannedStartMs!).getDate()).padStart(2, '0')}`;
  assert.equal(key, don, `${s.title} dayKey`);
}

console.log('planDayShift.smoke.test.ts ok');
