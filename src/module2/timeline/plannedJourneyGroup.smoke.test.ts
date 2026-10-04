/**
 * Run: npx --yes tsx src/module2/timeline/plannedJourneyGroup.smoke.test.ts
 */

import type { JourneyItinerary } from '../../services/transit/journeyPlanner';
import {
  buildPlannedJourneyStops,
  cleanPlanDestTitle,
  isPlanPromptLeak,
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

// Ort → Weg → Ort … : Start + 2×(Weg+Halt) = 5
assert(stops.length === 5, `origin+2 legs → 5 rows, got ${stops.length}`);
assert(stops.every((s) => s.groupId === 'nav_here_breakfast'), 'same group');
assert(
  stops.every((s) => s.groupLabel === 'ÖPNV nach Frühstück'),
  'group label',
);
assert(stops[0]!.kind === 'stop', 'origin halt first');
assert(/^1 ·/.test(stops[0]!.title), 'numbered origin');
assert(stops[1]!.kind === 'nav_leg', 'walk path after origin');
assert(stops[1]!.transport === 'walk', 'first walk path');
assert(/zu Fuß|520|8 Min/i.test(stops[1]!.title), 'walk title live-style');
assert(stops[2]!.kind === 'stop', 'first arrival halt');
assert(/^2 ·/.test(stops[2]!.title), 'numbered halt');
assert(stops[3]!.transport === 'transit', 'rail path');
assert(/RE nach/i.test(stops[3]!.title), 'rail live-style title');
assert(stops[4]!.kind === 'stop', 'dest halt');
assert(/Ankunft/i.test(stops[4]!.notes || ''), 'arrival notes');
assert(stops[1]!.routeEstimate === 'routed', 'routed');
assert(/^nav_here_breakfast_l/.test(stops[1]!.id), 'leg ids');

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

assert(isPlanPromptLeak('Weg zur Haltestelle und was ich beachten soll.'), 'prompt leak');
assert(cleanPlanDestTitle('Cruise hinterher in Kiel damit') === 'Cruise Center Kiel' || cleanPlanDestTitle('Cruise hinterher in Kiel damit') === '', 'cruise/prompt dest cleaned');
