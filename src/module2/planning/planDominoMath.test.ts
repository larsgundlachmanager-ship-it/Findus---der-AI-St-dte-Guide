/**
 * Domino-Mathematik ohne Store/RN:
 * Soft-Stops weichen, harte Termine bleiben, gleicher groupId ist kein Clash.
 *
 *   npm run test:domino
 */
import {
  findFreeSlotStartMs,
  hardIntervalsFromStops,
  isHardFixedStop,
  isSoftMovableStop,
} from './planHardLock';
import { planStopsOverlap } from './planTimeOverlap';
import type { FuturePlanStop } from '../timeline/futurePlanState';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function stop(
  partial: Pick<FuturePlanStop, 'id' | 'title' | 'plannedStartMs' | 'plannedEndMs'> &
    Partial<FuturePlanStop>,
): FuturePlanStop {
  return {
    bufferMin: 0,
    transport: 'walk',
    kind: 'stop',
    status: 'planned',
    hardAnchor: false,
    ...partial,
  };
}

const dayStart = Date.UTC(2026, 7, 24, 7, 0, 0);
const dayEnd = Date.UTC(2026, 7, 24, 22, 30, 0);

const sacred = stop({
  id: 'meeting',
  title: 'Meeting',
  plannedStartMs: Date.UTC(2026, 7, 24, 15, 0, 0),
  plannedEndMs: Date.UTC(2026, 7, 24, 16, 0, 0),
  planPriority: 2,
  userFixedTime: true,
  hardAnchor: true,
});

const softWish = stop({
  id: 'ice',
  title: 'Eis',
  plannedStartMs: Date.UTC(2026, 7, 24, 15, 20, 0),
  plannedEndMs: Date.UTC(2026, 7, 24, 15, 50, 0),
  planPriority: 6,
});

assert(isHardFixedStop(sacred), 'Prio-2 + userFixed = sacred');
assert(!isSoftMovableStop(sacred), 'sacred wird nicht auto-verschoben');
assert(isSoftMovableStop(softWish), 'Prio-6 darf weichen');
assert(planStopsOverlap([sacred, softWish]), 'Eis knallt ins Meeting');

const transit = [
  stop({
    id: 'nav_live_tour_0_a',
    title: '1 · Start',
    plannedStartMs: Date.UTC(2026, 7, 24, 12, 0, 0),
    plannedEndMs: Date.UTC(2026, 7, 24, 12, 15, 0),
    groupId: 'live_journey',
    transport: 'transit',
  }),
  stop({
    id: 'nav_live_tour_1_b',
    title: '2 · Umstieg',
    plannedStartMs: Date.UTC(2026, 7, 24, 12, 10, 0),
    plannedEndMs: Date.UTC(2026, 7, 24, 12, 25, 0),
    groupId: 'live_journey',
    transport: 'transit',
  }),
];
assert(!planStopsOverlap(transit), 'ÖPNV-Akkordeon ist kein Konflikt');

const hardIv = hardIntervalsFromStops([sacred]);
assert(hardIv.length === 1, 'ein harter Block');
const slot = findFreeSlotStartMs({
  preferredStartMs: softWish.plannedStartMs,
  durationMs: 30 * 60_000,
  hardIntervals: hardIv,
  dayStartMs: dayStart,
  dayEndMs: dayEnd,
});
assert(slot != null, 'freier Slot trotz Meeting');
assert(
  slot! + 30 * 60_000 <= sacred.plannedStartMs! ||
    slot! >= sacred.plannedEndMs! + 10 * 60_000,
  'Slot überlappt Sacred nicht',
);

console.log('planDominoMath.test.ts OK');
