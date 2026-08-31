/**
 * Run: npx --yes tsx src/services/transit/pickSoonestJourney.smoke.test.ts
 */

import type { JourneyItinerary } from './journeyPlanner';
import { pickSoonestCatchable } from './pickSoonestJourney';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function iti(opts: {
  dep: string;
  durMin: number;
  stops?: number;
  walkSec?: number;
}): JourneyItinerary {
  const dep = Date.parse(opts.dep);
  return {
    source: 'transitous',
    startTime: new Date(dep - 4 * 60_000),
    endTime: new Date(dep + opts.durMin * 60_000),
    durationSec: opts.durMin * 60,
    transfers: 1,
    legs: [
      {
        mode: 'WALK',
        fromName: 'Start',
        toName: 'Halt',
        startTime: new Date(dep - 4 * 60_000),
        endTime: new Date(dep),
        scheduledStart: null,
        scheduledEnd: null,
        delaySec: null,
        durationSec: opts.walkSec ?? 240,
        distanceM: 280,
        line: null,
        headsign: null,
        realTime: false,
      },
      {
        mode: 'RAIL',
        fromName: 'Halt',
        toName: 'Ziel',
        startTime: new Date(dep),
        endTime: new Date(dep + opts.durMin * 60_000),
        scheduledStart: null,
        scheduledEnd: null,
        delaySec: null,
        durationSec: opts.durMin * 60,
        distanceM: 40_000,
        line: 'RB 61',
        headsign: 'Pinneberg',
        realTime: true,
        intermediateStops: Array.from({ length: opts.stops ?? 0 }, (_, i) => ({
          name: `S${i}`,
          lat: null,
          lng: null,
          arrival: null,
          departure: null,
        })),
      },
    ],
    firstTransitDeparture: new Date(dep),
    firstTransitLine: 'RB 61',
    firstTransitDelaySec: 0,
    walkToStopSec: opts.walkSec ?? 240,
  };
}

const now = Date.parse('2026-08-19T20:38:00+02:00');
const picked = pickSoonestCatchable(
  [
    iti({ dep: '2026-08-19T22:41:00+02:00', durMin: 41, stops: 14 }),
    iti({ dep: '2026-08-19T20:43:00+02:00', durMin: 39, stops: 2 }),
    iti({ dep: '2026-08-19T21:17:00+02:00', durMin: 55, stops: 3 }),
    iti({ dep: '2026-08-19T21:40:00+02:00', durMin: 42, stops: 2 }),
  ],
  now,
);

assert(picked.pick != null, 'eine Verbindung');
assert(
  picked.pick!.firstTransitDeparture!.getHours() === 20 &&
    picked.pick!.firstTransitDeparture!.getMinutes() === 43,
  '20:43 noch nicht weg — knapp halten, nicht auf 21:17 springen',
);
assert(picked.tight === true, '20:43 ist knapp (Sprint)');

const justInTime = pickSoonestCatchable(
  [
    iti({
      dep: '2026-08-19T20:46:00+02:00',
      durMin: 10,
      walkSec: 240,
    }),
  ],
  now,
);
assert(
  justInTime.pick!.firstTransitDeparture!.getMinutes() === 46,
  '20:46 = 8 Min weg, 4 Min Fuß + 3 Min Halt → catchable',
);

const missed = pickSoonestCatchable(
  [
    iti({ dep: '2026-08-19T20:36:00+02:00', durMin: 39, stops: 2 }),
    iti({ dep: '2026-08-19T21:17:00+02:00', durMin: 55, stops: 3 }),
  ],
  now,
);
assert(
  missed.pick!.firstTransitDeparture!.getHours() === 21,
  'schon weg → nächste catchable 21:17',
);

const googleEarly = iti({ dep: '2026-08-19T23:37:00+02:00', durMin: 3, stops: 0 });
googleEarly.source = 'google';
googleEarly.firstTransitDelaySec = null;
googleEarly.legs[1]!.realTime = false;
googleEarly.legs[1]!.fromLat = null;
googleEarly.legs[1]!.toLat = null;
const dbLive = iti({ dep: '2026-08-19T23:40:00+02:00', durMin: 3, stops: 0 });
dbLive.source = 'db_rest';
dbLive.firstTransitDelaySec = 180;
dbLive.legs[1]!.realTime = true;
dbLive.legs[1]!.delaySec = 180;
dbLive.legs[1]!.fromPlatform = '2';
dbLive.legs[1]!.headsign = 'Hamburg-Altona';
dbLive.legs[1]!.fromLat = 53.6769;
dbLive.legs[1]!.fromLng = 9.7633;
dbLive.legs[1]!.toLat = 53.639;
dbLive.legs[1]!.toLng = 9.799;
const sameTrain = pickSoonestCatchable([googleEarly, dbLive], Date.parse('2026-08-19T23:20:00+02:00'));
assert(sameTrain.pick?.source === 'db_rest', 'Live-DB schlägt Google-Sollzeit derselben Fahrt');
assert(
  sameTrain.pick!.firstTransitDeparture!.getMinutes() === 40,
  'Abfahrt 23:40 inkl. Verspätung',
);

const around = pickSoonestCatchable(
  [
    iti({ dep: '2026-08-19T13:40:00+02:00', durMin: 20 }),
    iti({ dep: '2026-08-19T14:20:00+02:00', durMin: 18 }),
  ],
  Date.parse('2026-08-19T12:00:00+02:00'),
  { aroundMs: Date.parse('2026-08-19T14:00:00+02:00') },
);
assert(
  around.pick!.firstTransitDeparture!.getHours() === 14 &&
    around.pick!.firstTransitDeparture!.getMinutes() === 20,
  'Zug 14:00 → nächste 14:20, nicht 13:40',
);

console.log('pickSoonestJourney.smoke.test.ts OK');
