/**
 * Run: npx --yes tsx src/module2/planning/planConflictResolve.smoke.test.ts
 */

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

const now = Date.UTC(2026, 7, 21, 12, 0, 0);
const journey = [
  stop({
    id: 'nav_live_tour_0_a',
    title: '1 · Bahnhof Prisdorf',
    plannedStartMs: now,
    plannedEndMs: now + 15 * 60_000,
    groupId: 'live_journey',
    transport: 'transit',
  }),
  stop({
    id: 'nav_live_tour_1_b',
    title: '2 · Pinneberg',
    plannedStartMs: now + 10 * 60_000,
    plannedEndMs: now + 25 * 60_000,
    groupId: 'live_journey',
    transport: 'transit',
  }),
];

assert(!planStopsOverlap(journey), 'ÖPNV-Akkordeon ist kein Zeitkonflikt');

const clash = [
  ...journey,
  stop({
    id: 'dinner',
    title: 'Abendessen',
    plannedStartMs: now + 5 * 60_000,
    plannedEndMs: now + 40 * 60_000,
  }),
];
assert(planStopsOverlap(clash), 'echter Termin gegen die Fahrt bleibt Konflikt');

console.log('planConflictResolve.smoke.test.ts OK');
