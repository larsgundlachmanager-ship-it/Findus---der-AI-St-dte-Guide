/**
 * Run: npx --yes tsx src/module2/timeline/liveTourSchedule.smoke.test.ts
 */

import { STATION_ARRIVE_BEFORE_MIN } from '../../services/transit/stationArriveBuffer';
import { buildLiveTourSchedule } from './liveTourSchedule';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const now = Date.parse('2026-08-19T20:30:00+02:00');
const dep = Date.parse('2026-08-19T20:40:00+02:00');

const out = buildLiveTourSchedule({
  upcoming: [
    {
      name: 'Prisdorf',
      lat: 53.676,
      lng: 9.763,
      role: 'walk',
      durationSec: 4 * 60,
      vehicleStartMs: dep,
      startMs: now,
      endMs: dep,
    },
    {
      name: 'Pinneberg',
      lat: 53.639,
      lng: 9.799,
      role: 'alight',
      line: 'RB61',
      vehicleStartMs: dep,
      startMs: dep,
      endMs: dep + 3 * 60_000,
    },
  ],
  nowMs: now,
  transport: 'walk',
  origin: { lat: 53.68, lng: 9.75 },
  liveDistanceM: 280,
  liveEtaMin: 4,
  destName: 'Briefkasten',
});

const walkLeg = out.find((r) => r.kind === 'nav_leg' && r.transport === 'walk');
assert(walkLeg != null, 'Fußbein');
const halt = out.find((r) => r.kind === 'stop' && /Prisdorf/i.test(r.title ?? ''));
assert(halt != null, 'Halt Prisdorf');
const arriveBy = dep - STATION_ARRIVE_BEFORE_MIN * 60_000;
assert(
  walkLeg!.plannedEndMs === arriveBy,
  `Fußweg endet 3 Min vor Abfahrt, nicht zur Abfahrt (${walkLeg!.plannedEndMs} vs ${arriveBy})`,
);
assert(
  halt!.plannedStartMs === arriveBy,
  'am Halt um 20:37 bei Abfahrt 20:40',
);

const hbfZob = buildLiveTourSchedule({
  upcoming: [
    {
      name: 'Lübeck Hbf',
      lat: 53.867,
      lng: 10.669,
      role: 'alight',
      line: 'RE8',
      headsign: 'Lübeck-Travemünde Strand',
      platform: '3',
      vehicleMode: 'RAIL',
      durationSec: 20 * 60,
      startMs: Date.parse('2026-08-20T13:32:00+02:00'),
      endMs: Date.parse('2026-08-20T13:52:00+02:00'),
    },
    {
      name: 'Lübeck ZOB/Hauptbahnhof',
      lat: 53.868,
      lng: 10.671,
      role: 'transfer',
      durationSec: 7 * 60,
      distanceM: 245,
      platform: 'B',
      vehicleMode: 'BUS',
      vehicleStartMs: Date.parse('2026-08-20T14:01:00+02:00'),
      startMs: Date.parse('2026-08-20T13:52:00+02:00'),
      endMs: Date.parse('2026-08-20T13:58:00+02:00'),
    },
  ],
  nowMs: Date.parse('2026-08-20T13:20:00+02:00'),
  transport: 'walk',
  origin: { lat: 53.8, lng: 10.4 },
  destName: 'Alsterhaus',
});
const hbfIdx = hbfZob.findIndex((r) => r.kind === 'stop' && /Hbf/i.test(r.title ?? ''));
const zobIdx = hbfZob.findIndex((r) => r.kind === 'stop' && /ZOB/i.test(r.title ?? ''));
assert(hbfIdx >= 0 && zobIdx > hbfIdx, 'Hbf vor ZOB');
const between = hbfZob.slice(hbfIdx + 1, zobIdx);
assert(
  between.some((r) => r.kind === 'nav_leg' && r.transport === 'walk'),
  'zu Fuß zwischen Hbf und ZOB, nicht vor dem Hbf',
);
assert(
  hbfZob[hbfIdx - 1]?.transport === 'transit',
  'RE8 kommt als Bahn am Hbf an',
);
assert(
  (hbfZob[hbfIdx - 1]?.badge || '').toLowerCase().includes('gleis'),
  'Gleis am Bahn-Bein',
);
assert(
  /gleis/i.test(hbfZob[zobIdx]?.badge || hbfZob[zobIdx - 1]?.badge || ''),
  'Gleis am ZOB, nicht Steig/Abfahrt-N',
);
const hbfNotes = hbfZob[hbfIdx]?.notes ?? '';
assert(
  /warten/i.test(hbfNotes) || /Min/i.test(hbfNotes),
  `Wartezeit am Bahnhof in den Notizen (${hbfNotes})`,
);

console.log('liveTourSchedule.smoke.test.ts OK');
