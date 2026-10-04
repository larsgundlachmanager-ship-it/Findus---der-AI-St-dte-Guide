/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/planning/planConflictResolve.smoke.test.ts
 */

import { planStopsOverlap } from './planTimeOverlap';
import type { FuturePlanStop } from '../timeline/futurePlanState';
import { resolveOverlapsQuietlyOnStops } from './planQuietOverlap';

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

{
  const end = {
    id: 'live_journey_l5',
    title: '5 · END',
    kind: 'stop',
    transport: 'transit',
    groupId: 'live_journey',
    plannedStartMs: Date.parse('2026-09-11T18:46:00+02:00'),
    plannedEndMs: null,
  };
  const dinner = {
    id: 'rio',
    title: 'Rio Grande',
    kind: 'stop',
    plannedStartMs: Date.parse('2026-09-11T19:00:00+02:00'),
    plannedEndMs: Date.parse('2026-09-11T20:15:00+02:00'),
  };
  assert(
    !planStopsOverlap([end as any, dinner as any]),
    'END + Dinner 14 Min Lücke ist kein Zeitkonflikt',
  );
}
console.log('planConflict END-gap: OK');

{
  const breakfastStart = new Date(2026, 7, 24, 10, 0, 0, 0).getTime();
  const breakfastEnd = new Date(2026, 7, 24, 10, 45, 0, 0).getTime();
  const tourPrefer = new Date(2026, 7, 24, 9, 30, 0, 0).getTime();

  const before = [
    stop({
      id: 'wish_breakfast',
      title: 'Frühstück',
      kind: 'wish',
      plannedStartMs: breakfastStart,
      plannedEndMs: breakfastEnd,
      planPriority: 5,
      notes: 'Frühstück nach Ankunft',
      status: 'pending_change',
    }),
    stop({
      id: 'tour_t1_poi',
      title: 'Stadtrundgang',
      plannedStartMs: tourPrefer,
      plannedEndMs: tourPrefer + 90 * 60_000,
      planPriority: 6,
      emoji: '🗺️',
      notes: 'Tour · ~90 Min',
    }),
  ];

  assert(
    (before.find((s) => s.id === 'tour_t1_poi')!.plannedStartMs ?? 0) <
      breakfastEnd,
    'Tour startet vor Quiet-Resolve im Frühstück-Fenster',
  );

  const result = resolveOverlapsQuietlyOnStops(before);
  const tour = result.stops.find((s) => s.id === 'tour_t1_poi');
  assert(tour?.plannedStartMs != null, 'Tour hat Start');
  assert(
    tour!.plannedStartMs! >= breakfastEnd,
    `Tour nach Frühstück, got ${new Date(tour!.plannedStartMs!).toISOString()}`,
  );
  assert(result.shiftedIds.includes('tour_t1_poi'), 'Tour wurde verschoben');
  assert(!result.stillOverlapping, 'quiet resolve: kein Rest-Banner-Overlap');
  assert(
    !planStopsOverlap(result.stops),
    'hasTimeOverlap/planStopsOverlap false nach quiet resolve',
  );
}
console.log('planConflict quiet breakfast→tour: OK');
