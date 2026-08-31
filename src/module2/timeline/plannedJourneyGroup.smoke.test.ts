/**
 * Run: npx --yes tsx src/module2/timeline/plannedJourneyGroup.smoke.test.ts
 */

import type { JourneyItinerary } from '../../services/transit/journeyPlanner';
import {
  buildPlannedJourneyStops,
  cleanPlanDestTitle,
  titleForJourneyLeg,
} from './plannedJourneyGroup';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const start = new Date('2026-08-22T07:12:00');
const mid = new Date('2026-08-22T07:28:00');
const end = new Date('2026-08-22T08:05:00');

const itinerary: JourneyItinerary = {
  source: 'db_rest',
  startTime: start,
  endTime: end,
  durationSec: 53 * 60,
  transfers: 0,
  firstTransitDeparture: mid,
  firstTransitLine: 'RE',
  firstTransitDelaySec: null,
  walkToStopSec: 8 * 60,
  legs: [
    {
      mode: 'WALK',
      fromName: 'Hier',
      toName: 'Bahnhof Start',
      startTime: start,
      endTime: new Date('2026-08-22T07:20:00'),
      scheduledStart: null,
      scheduledEnd: null,
      delaySec: null,
      durationSec: 8 * 60,
      distanceM: 520,
      line: null,
      headsign: null,
      realTime: false,
      fromLat: 53.68,
      fromLng: 9.76,
      toLat: 53.681,
      toLng: 9.762,
    },
    {
      mode: 'RAIL',
      fromName: 'Bahnhof Start',
      toName: 'Hauptbahnhof',
      startTime: mid,
      endTime: end,
      scheduledStart: null,
      scheduledEnd: null,
      delaySec: null,
      durationSec: 37 * 60,
      distanceM: 18000,
      line: 'RE',
      headsign: 'Hamburg Hbf',
      realTime: false,
      fromLat: 53.681,
      fromLng: 9.762,
      toLat: 53.55,
      toLng: 10.0,
      stationCount: 4,
    },
  ],
};

assert(
  /RE/.test(titleForJourneyLeg(itinerary.legs[1]!)),
  'rail title has line',
);

const stops = buildPlannedJourneyStops({
  navId: 'nav_here_breakfast',
  destTitle: 'Frühstück',
  itinerary,
});

assert(stops.length === 2, `2 legs, got ${stops.length}`);
assert(stops.every((s) => s.groupId === 'nav_here_breakfast'), 'same group');
assert(
  stops.every((s) => s.groupLabel === 'ÖPNV nach Frühstück'),
  'group label',
);
assert(stops[0]!.transport === 'walk', 'first walk');
assert(stops[1]!.transport === 'transit', 'second rail');
assert(stops[0]!.kind === 'nav_leg' && stops[1]!.kind === 'nav_leg', 'nav legs');
assert(stops[0]!.routeEstimate === 'routed', 'routed');
assert(/^nav_here_breakfast_l/.test(stops[0]!.id), 'leg ids');

assert(cleanPlanDestTitle('Schönes Hamburg') === 'Hamburg', 'strip hollow schönes');
assert(
  buildPlannedJourneyStops({
    navId: 'nav_here_hh',
    destTitle: 'Schönes Hamburg',
    itinerary,
  }).every((s) => s.groupLabel === 'ÖPNV nach Hamburg'),
  'group label not schönes hamburg',
);

console.log('plannedJourneyGroup.smoke.test.ts ok');
